/**
 * The proof, against a real database.
 *
 * These tests are the answer to "how do we know the audit trail is telling the truth?".
 * Each one takes an invariant, tries to break it by a different route — a direct SQL
 * write, a decision nobody countersigned, data that changed under a decision already
 * made — and asserts the platform either refuses the write or notices and halts.
 *
 * Requires Postgres: `npm run setup && npm run test:db`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { migrate, pool, resetAndSeed, withClient, withTransaction } from "@rangka/db";
import type { PgClient } from "@rangka/db";
import { decideApproval, invoke } from "../../src/index.ts";
import { syncRegistry } from "../../src/audit.ts";
import { resolvePrincipal } from "../../src/auth.ts";
import { clearHalt as clearCapabilityHalt, reconcile } from "../../src/reconciler.ts";
import { checkInvariant, getInvariant } from "../../src/invariants.ts";
import type { Principal } from "../../src/types.ts";
import { releaseDatabase, takeDatabase } from "./exclusive.ts";

/** Clean, low risk, no screening hits: nobody else needs to agree. */
const CLEAN_CASE = "case_1041";
/** Unresolved PEP hit and high risk: a second holder of `kyc:decide`. */
const HIGH_RISK_CASE = "case_1043";
/** Unresolved OFAC and EU hits: only compliance may let this through. */
const SANCTIONED_CASE = "case_1045";

let agent: Principal;
let supervisor: Principal;
let admin: Principal;

before(async () => {
  await migrate();
  await import("@rangka/capabilities");
});

beforeEach(async () => {
  // These tests count every row of a kind, so they cannot share the database with
  // another test file the runner decided to start at the same time.
  await takeDatabase();
  await resetAndSeed();
  await syncRegistry();
  const principals = await withClient(async (client) => ({
    agent: await resolvePrincipal(client, "u_agent"),
    supervisor: await resolvePrincipal(client, "u_supervisor"),
    admin: await resolvePrincipal(client, "u_admin"),
  }));
  assert.ok(principals.agent && principals.supervisor && principals.admin);
  agent = principals.agent;
  supervisor = principals.supervisor;
  admin = principals.admin;
});

afterEach(async () => {
  await releaseDatabase();
});

after(async () => {
  await pool.end();
});

const revisionOf = async (caseId: string): Promise<number> => {
  const { rows } = await withClient((client) =>
    client.query<{ revision: number }>("select revision from kyc_cases where id = $1", [caseId]),
  );
  assert.ok(rows[0]);
  return rows[0].revision;
};

const approve = async (caseId: string, principal: Principal) =>
  invoke({
    capability: "kyc.case.approve",
    input: {
      caseId,
      revision: await revisionOf(caseId),
      note: "Documents verified and identity confirmed against the register.",
    },
    principal,
    idempotencyKey: randomUUID(),
  });

async function violationsOf(invariantId: string) {
  const invariant = getInvariant(invariantId);
  assert.ok(invariant, `unknown invariant ${invariantId}`);
  return withClient((client) => checkInvariant(client, invariant));
}

/** Writes an audit row by hand, the way a corrupted or hostile path would. */
const forgeAudit = (client: PgClient, invocationId: string, capability: string, key?: string) =>
  client.query(
    `insert into audit_log (invocation_id, actor_id, actor_role, capability, kind, outcome,
                            input, idempotency_key, duration_ms)
     values ($1, 'u_agent', 'agent', $2, 'write', 'ok', '{}', $3, 1)`,
    [invocationId, capability, key ?? null],
  );

test("a decision is traceable to exactly one audited invocation", async () => {
  const result = await approve(CLEAN_CASE, supervisor);
  assert.equal(result.outcome, "ok");

  const { rows } = await withClient((client) =>
    client.query(
      `select d.decision, d.decided_by, a.outcome, a.actor_id, a.capability
         from kyc_case_decisions d join audit_log a on a.invocation_id = d.invocation_id`,
    ),
  );
  assert.equal(rows.length, 1, "one decision, one audit row, joined by invocation id");
  assert.equal(rows[0].decision, "approved");
  assert.equal(rows[0].decided_by, "u_supervisor");
  assert.equal(rows[0].actor_id, "u_supervisor");
  assert.equal(rows[0].capability, "kyc.case.approve");
  assert.equal(rows[0].outcome, "ok");
});

test("effects_are_attributed: the database rejects an effect no invocation is responsible for", async () => {
  await assert.rejects(
    withClient((client) =>
      client.query(
        `insert into kyc_case_decisions (id, case_id, decision, note, decided_by)
         values ('dec_ghost', $1, 'approved', 'written by hand', 'u_admin')`,
        [CLEAN_CASE],
      ),
    ),
    /must be written by an audited invocation/,
    "even a direct SQL insert cannot decide a case unaudited",
  );

  await assert.rejects(
    withClient((client) =>
      client.query(
        `insert into kyc_pii_disclosures (id, case_id, justification, actor_id)
         values ('pii_ghost', $1, 'just looking', 'u_admin')`,
        [CLEAN_CASE],
      ),
    ),
    /must be written by an audited invocation/,
    "nor read the applicant's identifiers without leaving a record",
  );
});

test("history cannot be rewritten or deleted", async () => {
  await approve(CLEAN_CASE, supervisor);
  await assert.rejects(
    withClient((client) => client.query("update audit_log set outcome = 'tampered'")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("delete from audit_log")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("update kyc_case_decisions set decision = 'rejected'")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("delete from kyc_case_decisions")),
    /append-only/,
  );
});

test("a case reaches a terminal state once, whatever the caller is", async () => {
  assert.equal((await approve(CLEAN_CASE, supervisor)).outcome, "ok");

  const second = await approve(CLEAN_CASE, supervisor);
  assert.equal(second.outcome, "conflict", "the runtime refuses a case that already moved");
  assert.match(second.message ?? "", /already approved/);

  // With the handler bypassed entirely, the database still refuses.
  const invocationId = randomUUID();
  await assert.rejects(
    withTransaction(async (client) => {
      await forgeAudit(client, invocationId, "kyc.case.approve");
      await client.query(
        `insert into kyc_case_decisions
           (id, case_id, decision, note, decided_by, invocation_id, capability)
         values ('dec_second', $1, 'rejected', 'bypassing the handler', 'u_admin', $2,
                 'kyc.case.approve')`,
        [CLEAN_CASE, invocationId],
      );
    }),
    /already has a terminal decision|duplicate key/,
  );

  assert.deepEqual(await violationsOf("kyc.case.approve.happens_at_most_once_per_subject"), []);
});

test("who must countersign is derived from the case, not from the caller", async () => {
  // Clean case: nobody. High risk: a second reviewer. Sanctions exposure: compliance.
  assert.equal((await approve(CLEAN_CASE, supervisor)).outcome, "ok");

  const highRisk = await approve(HIGH_RISK_CASE, supervisor);
  assert.equal(highRisk.outcome, "pending_approval");
  assert.match(highRisk.message ?? "", /kyc:decide/);

  const sanctioned = await approve(SANCTIONED_CASE, supervisor);
  assert.equal(sanctioned.outcome, "pending_approval");
  assert.match(sanctioned.message ?? "", /kyc:sar/);

  const { rows } = await withClient((client) =>
    client.query<{ id: string; approver_scope: string }>(
      "select id, approver_scope from approvals order by created_at",
    ),
  );
  assert.deepEqual(
    rows.map((row) => row.approver_scope),
    ["kyc:decide", "kyc:sar"],
    "the scope each request demands is fixed when it is raised",
  );
});

test("a sanctions case cannot be approved by someone without kyc:sar, and holding it is not enough to self-approve", async () => {
  const requested = await approve(SANCTIONED_CASE, admin);
  assert.equal(requested.outcome, "pending_approval");
  const approvalId = requested.approvalId;
  assert.ok(approvalId);

  const selfApproved = await decideApproval({ approvalId, decision: "approve", approver: admin });
  assert.equal(selfApproved.outcome, "denied_scope");
  assert.match(selfApproved.message ?? "", /own request/);

  // The supervisor may decide approvals in general, but not this one.
  assert.ok(supervisor.scopes.includes("approvals:decide"));
  assert.ok(!supervisor.scopes.includes("kyc:sar"));
  const refused = await decideApproval({ approvalId, decision: "approve", approver: supervisor });
  assert.equal(refused.outcome, "denied_scope");
  assert.match(refused.message ?? "", /needs kyc:sar/);

  const secondAdmin = await withClient((client) => resolvePrincipal(client, "u_admin_2"));
  assert.ok(secondAdmin);
  const decided = await decideApproval({
    approvalId,
    decision: "approve",
    approver: secondAdmin,
  });
  assert.equal(decided.outcome, "ok", "a second holder of kyc:sar can let it through");

  assert.deepEqual(await violationsOf("kyc.case.approve.carries_the_declared_approval"), []);
  assert.deepEqual(await violationsOf("approvals.decided_by_a_second_person"), []);
  assert.deepEqual(
    await violationsOf("approvals.decided_by_a_holder_of_the_required_scope"),
    [],
  );

  const decisions = await withClient((client) =>
    client.query("select decided_by from kyc_case_decisions where case_id = $1", [
      SANCTIONED_CASE,
    ]),
  );
  assert.equal(
    decisions.rows[0]?.decided_by,
    "u_admin",
    "the effect is recorded as the requester's, not the approver's",
  );
});

test("kyc.case.approve.carries_the_declared_approval: an unapproved decision on a risky case is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, "kyc.case.approve");
    await client.query(
      `insert into kyc_case_decisions
         (id, case_id, decision, note, decided_by, invocation_id, capability)
       values ('dec_unapproved', $1, 'approved', 'nobody countersigned', 'u_agent', $2,
               'kyc.case.approve')`,
      [SANCTIONED_CASE, invocationId],
    );
  });

  const [violation, ...rest] = await violationsOf(
    "kyc.case.approve.carries_the_declared_approval",
  );
  assert.deepEqual(rest, []);
  assert.match(violation?.detail ?? "", /no approval for an effect that required kyc:sar/);
});

test("drift that arrives outside the runtime is caught by the reconciler and halts the capability", async () => {
  assert.equal((await approve(CLEAN_CASE, supervisor)).outcome, "ok");

  // Nothing the runtime did was wrong: the case was clean when it was decided. A
  // screening hit landed afterwards, which is exactly the class of problem an audit
  // log alone would never surface — the decision no longer satisfies today's rule.
  await withClient((client) =>
    client.query(
      `insert into kyc_screening_hits
         (id, case_id, provider, list, matched_name, match_strength, resolution)
       values ('hit_late', $1, 'Refinitiv', 'OFAC_SDN', 'M. Delgado', 0.91, 'unresolved')`,
      [CLEAN_CASE],
    ),
  );

  const first = await reconcile();
  assert.ok(
    first.violations.some(
      (violation) => violation.invariantId === "kyc.case.approve.carries_the_declared_approval",
    ),
    "the reconciler re-derives the invariant from committed state",
  );
  assert.ok(first.halted.includes("kyc.case.approve"));
  assert.ok(!first.halted.includes("kyc.case.claim"), "the halt is scoped to what the rule guards");

  const blocked = await approve(HIGH_RISK_CASE, supervisor);
  assert.equal(blocked.outcome, "halted");
  assert.match(blocked.message ?? "", /kyc\.case\.approve\.carries_the_declared_approval/);

  // Unrelated work keeps serving.
  const claimed = await invoke({
    capability: "kyc.case.claim",
    input: { caseId: HIGH_RISK_CASE, revision: await revisionOf(HIGH_RISK_CASE) },
    principal: agent,
    idempotencyKey: randomUUID(),
  });
  assert.equal(claimed.outcome, "ok");

  const refused = await clearCapabilityHalt("kyc.case.approve", admin);
  assert.equal(refused.cleared, false, "a halt cannot be cleared while the data is still wrong");

  await withClient((client) =>
    client.query("update kyc_screening_hits set resolution = 'false_positive' where id = 'hit_late'"),
  );
  const cleared = await clearCapabilityHalt("kyc.case.approve", admin);
  assert.equal(cleared.cleared, true);
  assert.equal(
    (await approve(HIGH_RISK_CASE, supervisor)).outcome,
    "pending_approval",
    "the capability resumes once the invariant holds",
  );
});

test("only an admin can clear a halt", async () => {
  await withClient((client) =>
    client.query(
      `insert into capability_halts (capability, invariant_id, detail)
       values ('kyc.case.approve', 'test', 'test')`,
    ),
  );
  const result = await clearCapabilityHalt("kyc.case.approve", supervisor);
  assert.equal(result.cleared, false);
  assert.match(result.message, /cannot clear a halt/);
});

test("revealing PII is metered, justified and countable per reviewer", async () => {
  const before = await invoke<{ case: { identity: { masked: boolean; nationalId: string } } }>({
    capability: "kyc.cases.get",
    input: { caseId: CLEAN_CASE },
    principal: agent,
  });
  assert.equal(before.outcome, "ok");
  assert.equal(before.result?.case.identity.masked, true, "reads are masked by default");

  const revealed = await invoke<{ identity: { nationalId: string }; revealsRemaining: number }>({
    capability: "kyc.case.pii.reveal",
    input: { caseId: CLEAN_CASE, justification: "Verifying the national id against the document." },
    principal: agent,
    idempotencyKey: randomUUID(),
  });
  assert.equal(revealed.outcome, "ok");
  assert.equal(revealed.result?.identity.nationalId, "431-88-4821");
  assert.equal(revealed.result?.revealsRemaining, 19);

  const { rows } = await withClient((client) =>
    client.query(
      `select d.justification, d.actor_id, a.outcome
         from kyc_pii_disclosures d join audit_log a on a.invocation_id = d.invocation_id`,
    ),
  );
  assert.equal(rows.length, 1, "the disclosure is an effect in its own right");
  assert.equal(rows[0].actor_id, "u_agent");
  assert.match(rows[0].justification, /Verifying the national id/);

  const unjustified = await invoke({
    capability: "kyc.case.pii.reveal",
    input: { caseId: CLEAN_CASE, justification: "why not" },
    principal: agent,
    idempotencyKey: randomUUID(),
  });
  assert.equal(unjustified.outcome, "invalid_input");
});

test("a reviewer cannot decide, and a decider cannot file a SAR", async () => {
  const decided = await approve(CLEAN_CASE, agent);
  assert.equal(decided.outcome, "denied_scope");
  assert.match(decided.message ?? "", /kyc:decide/);

  const filed = await invoke({
    capability: "kyc.case.sar.file",
    input: {
      caseId: SANCTIONED_CASE,
      revision: await revisionOf(SANCTIONED_CASE),
      narrative: "Strong sanctions match on an inbound corridor with no source of funds evidence.",
    },
    principal: supervisor,
    idempotencyKey: randomUUID(),
  });
  assert.equal(filed.outcome, "denied_scope");
  assert.match(filed.message ?? "", /kyc:sar/);
});

test("a stale revision is refused, and the refusal is on the record", async () => {
  const revision = await revisionOf(HIGH_RISK_CASE);
  const claimed = await invoke({
    capability: "kyc.case.claim",
    input: { caseId: HIGH_RISK_CASE, revision },
    principal: agent,
    idempotencyKey: randomUUID(),
  });
  assert.equal(claimed.outcome, "ok");

  // Someone else was looking at the case before that claim landed.
  const stale = await invoke({
    capability: "kyc.case.escalate",
    input: { caseId: HIGH_RISK_CASE, revision, note: "acting on a view that has moved on" },
    principal: supervisor,
    idempotencyKey: randomUUID(),
  });
  assert.equal(stale.outcome, "conflict");
  assert.match(stale.message ?? "", /reload before deciding/);

  const audited = await withClient((client) =>
    client.query("select outcome from audit_log where capability = 'kyc.case.escalate'"),
  );
  assert.deepEqual(
    audited.rows.map((row) => row.outcome),
    ["conflict"],
  );
});

test("kyc.case.sar.file.respects_declared_rate: an acceptance the runtime never granted is still detectable", async () => {
  assert.deepEqual(await violationsOf("kyc.case.sar.file.respects_declared_rate"), []);

  await withClient(async (client) => {
    for (let i = 0; i < 6; i += 1) {
      await forgeAudit(client, randomUUID(), "kyc.case.sar.file");
    }
  });

  const [violation] = await violationsOf("kyc.case.sar.file.respects_declared_rate");
  assert.ok(violation, "6 accepted filings in an hour breaks the declared rate of 5");
  assert.match(violation.detail, /above the declared 5/);
});

test("kyc.case.claim.is_idempotent: one key that produced two effects is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, "kyc.case.claim", "replayed-key");
    for (const summary of ["claimed once", "claimed twice"]) {
      await client.query(
        `insert into kyc_case_events (case_id, actor_id, summary, invocation_id, capability)
         values ($1, 'u_agent', $2, $3, 'kyc.case.claim')`,
        [CLEAN_CASE, summary, invocationId],
      );
    }
  });

  const violations = await violationsOf("kyc.case.claim.is_idempotent");
  assert.deepEqual(
    violations.map((violation) => violation.subject),
    ["replayed-key"],
  );
});

test("the seeded platform satisfies every invariant it declares", async () => {
  const clean = await reconcile();
  assert.deepEqual(clean.violations, []);
  assert.deepEqual(clean.halted, []);
});
