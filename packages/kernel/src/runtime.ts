import { randomUUID } from "node:crypto";
import { createDataSource, StaleRevisionError, withClient, withTransaction } from "@rangka/db";
import type { PgClient } from "@rangka/db";
import { resolvePrincipal } from "./auth.ts";
import { activeHalt } from "./reconciler.ts";
import { getCapability } from "./registry.ts";
import { assertPostconditions, describeViolations } from "./invariants.ts";
import type {
  Capability,
  CapabilityContext,
  InvokeResult,
  Outcome,
  Principal,
  WriteCapability,
} from "./types.ts";

export interface InvokeRequest {
  capability: string;
  input: unknown;
  principal: Principal;
  /** Required for every write capability. */
  idempotencyKey?: string;
  /**
   * Set only by {@link decideApproval}. An HTTP caller cannot supply this, so an
   * approval-gated capability cannot be executed by asserting it was approved.
   */
  approvalGrant?: { approvalId: string };
}

interface AuditRecord {
  invocationId: string;
  actorId: string;
  actorRole: string;
  capability: string;
  kind: string;
  outcome: Outcome;
  input: unknown;
  result?: unknown;
  amountCents?: number | null;
  approvalId?: string | null;
  idempotencyKey?: string | null;
  error?: string | null;
  durationMs: number;
}

const REDACTED_KEYS = new Set(["password", "token", "secret", "pan", "cvv"]);

function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) =>
        REDACTED_KEYS.has(key.toLowerCase()) ? [key, "[redacted]"] : [key, redact(inner)],
      ),
    );
  }
  return value;
}

async function writeAudit(client: PgClient, record: AuditRecord): Promise<void> {
  await client.query(
    `insert into audit_log
       (invocation_id, actor_id, actor_role, capability, kind, outcome, input, result, amount_cents,
        approval_id, idempotency_key, error, duration_ms)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      record.invocationId,
      record.actorId,
      record.actorRole,
      record.capability,
      record.kind,
      record.outcome,
      JSON.stringify(redact(record.input)),
      record.result === undefined ? null : JSON.stringify(redact(record.result)),
      record.amountCents ?? null,
      record.approvalId ?? null,
      record.idempotencyKey ?? null,
      record.error ?? null,
      record.durationMs,
    ],
  );
}

function amountFrom(input: unknown, path: string | undefined): number | null {
  if (!path) return null;
  let cursor: unknown = input;
  for (const segment of path.split(".")) {
    if (!cursor || typeof cursor !== "object") return null;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return typeof cursor === "number" ? cursor : null;
}

export interface ApprovalRequirement {
  approverScope: string;
  reason: string;
}

/**
 * What the runtime would demand of this call, without performing it.
 *
 * An app has to tell a reviewer "this will be held for compliance" before they press
 * the button. Asking the runtime is the only way to say that without a second copy of
 * the rule in the UI, which would be free to disagree with the one being enforced.
 */
export async function previewApproval(
  capabilityName: string,
  input: unknown,
): Promise<ApprovalRequirement | null> {
  const capability = getCapability(capabilityName);
  if (!capability || capability.kind !== "write") return null;
  const write = capability as WriteCapability;
  const amountCents = amountFrom(input, write.policy.amountField);
  return withClient((client) => approvalRequired(client, write, input, amountCents));
}

/**
 * Whether this call needs a second person, and which scope they must hold.
 *
 * For a data-derived rule the question is asked of the record, in SQL, from the
 * declaration — so an app cannot decide for itself that its case is low risk, and the
 * runtime and the after-the-fact invariant read the same clauses.
 */
async function approvalRequired(
  client: PgClient,
  capability: WriteCapability,
  input: unknown,
  amountCents: number | null,
): Promise<ApprovalRequirement | null> {
  const rule = capability.policy.approval;
  const declared = { approverScope: capability.policy.approverScope };

  if (rule.mode === "never") return null;
  if (rule.mode === "always") {
    return { ...declared, reason: `${capability.name} always requires approval` };
  }
  if (rule.mode === "above_amount") {
    return amountCents !== null && amountCents > rule.amountCents
      ? {
          ...declared,
          reason: `amount ${amountCents} is above the ${rule.amountCents} approval threshold`,
        }
      : null;
  }

  const subject = capability.policy.subject;
  if (!subject) return null;
  const subjectId = (input as Record<string, unknown>)[subject.idField];
  if (typeof subjectId !== "string") return null;

  const clauses = rule.clauses
    .map((clause, index) => `(${clause.when}) as clause_${index}`)
    .join(", ");
  const { rows } = await client.query<Record<string, boolean>>(
    `select ${clauses} from ${subject.table} s where s.id = $1`,
    [subjectId],
  );
  const row = rows[0];
  if (!row) return null;

  const matched = rule.clauses.findIndex((_clause, index) => row[`clause_${index}`] === true);
  const clause = rule.clauses[matched];
  return clause ? { approverScope: clause.approverScope, reason: clause.because } : null;
}

async function countRecentAccepted(
  client: PgClient,
  actorId: string,
  capability: string,
): Promise<number> {
  const { rows } = await client.query<{ count: string }>(
    `select count(*) from audit_log
      where actor_id = $1 and capability = $2
        and outcome in ('ok', 'pending_approval')
        and at > now() - interval '1 hour'`,
    [actorId, capability],
  );
  return Number(rows[0]?.count ?? 0);
}

/**
 * The single path through which application code reaches business data.
 *
 * The order below is the platform's contract: authorisation, validation, rate
 * limit, amount ceiling and approval are all decided before a handler runs, and
 * the audit record is written inside the same transaction as the handler's
 * effect. An app cannot perform an unlogged, unbounded or unauthorised action
 * because none of those checks live in code an app author writes.
 *
 * The last step of a write is an invariant postcondition (see ./invariants.ts): the
 * transaction only commits if the platform's invariants still hold afterwards.
 */
export async function invoke<T = unknown>(request: InvokeRequest): Promise<InvokeResult<T>> {
  const started = Date.now();
  const { principal } = request;
  const capability = getCapability(request.capability);
  const invocationId = randomUUID();

  const fail = async (outcome: Outcome, message: string, extra: Partial<AuditRecord> = {}) => {
    await withClient((client) =>
      writeAudit(client, {
        invocationId,
        actorId: principal.id,
        actorRole: principal.role,
        capability: request.capability,
        kind: capability?.kind ?? "unknown",
        outcome,
        input: request.input,
        idempotencyKey: request.idempotencyKey ?? null,
        durationMs: Date.now() - started,
        ...extra,
      }),
    );
    return { outcome, message } as InvokeResult<T>;
  };

  if (!capability) return fail("not_found", `unknown capability: ${request.capability}`);

  if (!principal.scopes.includes(capability.policy.scope)) {
    return fail(
      "denied_scope",
      `${principal.role} lacks scope ${capability.policy.scope} required by ${capability.name}`,
    );
  }

  const parsed = capability.input.safeParse(request.input);
  if (!parsed.success) {
    return fail("invalid_input", parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  const input = clampRows(capability, parsed.data);

  if (capability.kind === "read") {
    return execute<T>(capability, input, principal, started, null, null, null, invocationId);
  }

  const write = capability as WriteCapability;

  // A violated invariant stops the capability it guards, not the platform: reads
  // and unrelated writes keep serving while a human investigates.
  const halt = await withClient((client) => activeHalt(client, write.name));
  if (halt) {
    return fail(
      "halted",
      `${write.name} is halted since ${halt.haltedAt} by invariant ${halt.invariantId}: ${halt.detail}`,
    );
  }

  if (!request.idempotencyKey) {
    return fail("invalid_input", `${write.name} is a write capability and requires an idempotency key`);
  }

  const amountCents = amountFrom(input, write.policy.amountField);
  const ceiling = write.policy.limits.maxAmountCents;
  if (ceiling !== null && amountCents !== null && amountCents > ceiling) {
    return fail(
      "denied_limit",
      `amount ${amountCents} exceeds the ${ceiling} ceiling declared by ${write.name}`,
      { amountCents },
    );
  }

  const recent = await withClient((client) => countRecentAccepted(client, principal.id, write.name));
  if (recent >= write.policy.limits.maxPerHour) {
    return fail(
      "rate_limited",
      `${principal.name} reached the ${write.policy.limits.maxPerHour}/hour limit for ${write.name}`,
      { amountCents },
    );
  }

  const requirement = request.approvalGrant
    ? null
    : await withClient((client) => approvalRequired(client, write, input, amountCents));

  if (requirement) {
    const approvalId = `apr_${randomUUID().slice(0, 8)}`;
    await withClient(async (client) => {
      await client.query(
        `insert into approvals
           (id, capability, input, amount_cents, reason, requested_by, status, approver_scope, idempotency_key)
         values ($1, $2, $3, $4, $5, $6, 'pending', $7, $8)`,
        [
          approvalId,
          write.name,
          JSON.stringify(redact(input)),
          amountCents,
          requirement.reason,
          principal.id,
          requirement.approverScope,
          request.idempotencyKey,
        ],
      );
      await writeAudit(client, {
        invocationId,
        actorId: principal.id,
        actorRole: principal.role,
        capability: write.name,
        kind: "write",
        outcome: "pending_approval",
        input,
        amountCents,
        approvalId,
        idempotencyKey: request.idempotencyKey,
        durationMs: Date.now() - started,
      });
    });
    return {
      outcome: "pending_approval",
      approvalId,
      message: `held for approval by someone with ${requirement.approverScope}: ${requirement.reason}`,
    };
  }

  return execute<T>(
    write,
    input,
    principal,
    started,
    request.idempotencyKey,
    amountCents,
    request.approvalGrant?.approvalId ?? null,
    invocationId,
  );
}

function clampRows(capability: Capability, input: unknown): unknown {
  if (capability.kind !== "read") return input;
  if (!input || typeof input !== "object") return input;
  const record = input as Record<string, unknown>;
  if (typeof record.limit !== "number") return input;
  return { ...record, limit: Math.min(record.limit, capability.policy.maxRows) };
}

async function execute<T>(
  capability: Capability,
  input: unknown,
  principal: Principal,
  started: number,
  idempotencyKey: string | null,
  amountCents: number | null,
  approvalId: string | null,
  invocationId: string,
): Promise<InvokeResult<T>> {
  try {
    return await withTransaction(async (client) => {
      if (idempotencyKey) {
        const { rows } = await client.query<{ response: unknown }>(
          "select response from idempotency_keys where capability = $1 and key = $2",
          [capability.name, idempotencyKey],
        );
        if (rows[0]) {
          await writeAudit(client, {
            invocationId,
            actorId: principal.id,
            actorRole: principal.role,
            capability: capability.name,
            kind: capability.kind,
            outcome: "replayed",
            input,
            result: rows[0].response,
            amountCents,
            approvalId,
            idempotencyKey,
            durationMs: Date.now() - started,
          });
          return { outcome: "replayed", result: rows[0].response as T };
        }
      }

      const ctx: CapabilityContext = {
        principal,
        data: createDataSource(client, invocationId, capability.name),
        now: new Date(),
        invocationId,
        approvalId,
      };
      const result = (await capability.handler(input as never, ctx)) as T;

      if (idempotencyKey) {
        await client.query(
          `insert into idempotency_keys (capability, key, actor_id, response) values ($1, $2, $3, $4)`,
          [capability.name, idempotencyKey, principal.id, JSON.stringify(result ?? null)],
        );
      }

      await writeAudit(client, {
        invocationId,
        actorId: principal.id,
        actorRole: principal.role,
        capability: capability.name,
        kind: capability.kind,
        outcome: "ok",
        input,
        result: capability.kind === "write" ? result : summarise(result),
        amountCents,
        approvalId,
        idempotencyKey,
        durationMs: Date.now() - started,
      });

      // Postcondition, inside the transaction and after the audit row exists:
      // the invariants are re-derived from what this transaction is about to
      // commit. Throwing here rolls back the effect, the idempotency key and
      // this audit row together, so a broken invariant never reaches disk.
      const violations = await assertPostconditions(client, capability.name);
      if (violations.length > 0) {
        throw new InvariantViolationError(describeViolations(violations));
      }

      return { outcome: "ok", result };
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A stale revision or a case someone else owns is a refusal the caller can act on,
    // not a platform failure; it is audited either way.
    const outcome: Outcome =
      error instanceof InvariantViolationError
        ? "invariant_violation"
        : error instanceof StaleRevisionError
          ? "conflict"
          : "error";
    // The rollback took the audit row with it, so the failure is recorded again
    // outside the transaction, under the same invocation id. A refused effect is
    // as visible, and as traceable, as an accepted one.
    await withClient((client) =>
      writeAudit(client, {
        invocationId,
        actorId: principal.id,
        actorRole: principal.role,
        capability: capability.name,
        kind: capability.kind,
        outcome,
        input,
        amountCents,
        approvalId,
        idempotencyKey,
        error: message,
        durationMs: Date.now() - started,
      }),
    );
    return { outcome, message };
  }
}

class InvariantViolationError extends Error {}

/** Reads are audited by shape, not by payload, so the log stays useful and small. */
function summarise(result: unknown): unknown {
  if (Array.isArray(result)) return { rows: result.length };
  return result && typeof result === "object" ? { keys: Object.keys(result) } : result;
}

export interface ApprovalDecision {
  approvalId: string;
  decision: "approve" | "reject";
  approver: Principal;
}

export interface ApprovalRow {
  id: string;
  capability: string;
  input: unknown;
  amountCents: number | null;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  /** The scope the decider must hold, fixed when the request was raised. */
  approverScope: string;
  status: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export async function listApprovals(status?: string): Promise<ApprovalRow[]> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `select a.*, u.name as requested_by_name
         from approvals a join platform_users u on u.id = a.requested_by
        ${status ? "where a.status = $1" : ""}
        order by a.created_at desc
        limit 100`,
      status ? [status] : [],
    );
    return rows.map((row) => ({
      id: row.id,
      capability: row.capability,
      input: row.input,
      amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
      reason: row.reason,
      requestedBy: row.requested_by,
      requestedByName: row.requested_by_name,
      approverScope: row.approver_scope,
      status: row.status,
      decidedBy: row.decided_by,
      decidedAt: row.decided_at ? row.decided_at.toISOString() : null,
      createdAt: row.created_at.toISOString(),
    }));
  });
}

/**
 * Approving is itself an audited action. The approved invocation is replayed by
 * the runtime as the original requester, with an approval grant that only this
 * function can mint.
 */
export async function decideApproval(decision: ApprovalDecision): Promise<InvokeResult> {
  const started = Date.now();
  const { approver } = decision;

  const record = await withClient(async (client) => {
    const { rows } = await client.query(
      "select * from approvals where id = $1 for update",
      [decision.approvalId],
    );
    return rows[0];
  });

  const auditDecision = async (outcome: Outcome, message?: string) => {
    await withClient((client) =>
      writeAudit(client, {
        invocationId: randomUUID(),
        actorId: approver.id,
        actorRole: approver.role,
        capability: "approvals.decide",
        kind: "write",
        outcome,
        input: { approvalId: decision.approvalId, decision: decision.decision },
        approvalId: decision.approvalId,
        error: outcome === "ok" ? null : (message ?? null),
        durationMs: Date.now() - started,
      }),
    );
    return { outcome, message } as InvokeResult;
  };

  if (!approver.scopes.includes("approvals:decide")) {
    return auditDecision("denied_scope", `${approver.role} cannot decide approvals`);
  }
  if (!record) return auditDecision("not_found", `unknown approval: ${decision.approvalId}`);
  if (record.status !== "pending") {
    return auditDecision("error", `approval ${decision.approvalId} is already ${record.status}`);
  }
  if (record.requested_by === approver.id) {
    return auditDecision("denied_scope", "an approver may not approve their own request");
  }
  // `approvals:decide` says you may decide approvals; the capability's own approverScope says
  // which ones. Without this, holding the generic scope would let anyone clear the highest-risk
  // action in the registry.
  if (!approver.scopes.includes(record.approver_scope)) {
    return auditDecision(
      "denied_scope",
      `deciding ${record.capability} needs ${record.approver_scope}, which ${approver.role} does not hold`,
    );
  }

  if (decision.decision === "reject") {
    await withClient((client) =>
      client.query(
        "update approvals set status = 'rejected', decided_by = $2, decided_at = now() where id = $1",
        [decision.approvalId, approver.id],
      ),
    );
    return auditDecision("ok");
  }

  const requester = await withClient((client) => resolvePrincipal(client, record.requested_by));
  if (!requester) return auditDecision("error", "requester no longer exists");

  await withClient((client) =>
    client.query(
      "update approvals set status = 'approved', decided_by = $2, decided_at = now() where id = $1",
      [decision.approvalId, approver.id],
    ),
  );
  await auditDecision("ok");

  const result = await invoke({
    capability: record.capability,
    input: record.input,
    principal: requester,
    idempotencyKey: record.idempotency_key,
    approvalGrant: { approvalId: record.id },
  });

  await withClient((client) =>
    client.query("update approvals set status = $2 where id = $1", [
      decision.approvalId,
      result.outcome === "ok" || result.outcome === "replayed" ? "executed" : "failed",
    ]),
  );

  return result;
}
