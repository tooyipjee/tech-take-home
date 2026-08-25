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
import { after, before, beforeEach, test } from "node:test";
import { migrate, pool, resetAndSeed, withClient, withTransaction } from "@rangka/db";
import type { PgClient } from "@rangka/db";
import { decideApproval, invoke } from "../../src/index.ts";
import { syncRegistry } from "../../src/audit.ts";
import { resolvePrincipal } from "../../src/auth.ts";
import { clearHalt as clearCapabilityHalt, reconcile } from "../../src/reconciler.ts";
import { checkInvariant, getInvariant } from "../../src/invariants.ts";
import type { Principal } from "../../src/types.ts";

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

/*
 * ---------------------------------------------------------------------------
 * Feature flags: an effect that moves a state rather than accumulating a record.
 *
 * These live in the same file as the rest of the database proof on purpose: each
 * test resets and reseeds the one database, so a second file would race this one.
 * ---------------------------------------------------------------------------
 */

/** Ordinary switches: nobody else has to agree. */
const BULK_CLAIM = "flag_bulk_claim";
const DARK_MODE = "flag_dark_mode";
/** Protected: it gates a customer-facing money flow, so a second admin must sign. */
const INSTANT_PAYOUTS = "flag_instant_payouts";

interface FlagRow {
  enabled: boolean;
  revision: number;
}

const flagRow = async (flagId: string): Promise<FlagRow> => {
  const { rows } = await withClient((client) =>
    client.query<FlagRow>("select enabled, revision from feature_flags where id = $1", [flagId]),
  );
  assert.ok(rows[0]);
  return rows[0];
};

const flip = async (
  flagId: string,
  enabled: boolean,
  principal: Principal,
  options: { revision?: number; idempotencyKey?: string } = {},
) =>
  invoke({
    capability: "flags.flip",
    input: {
      flagId,
      revision: options.revision ?? (await flagRow(flagId)).revision,
      enabled,
      note: enabled ? "Enabling for the pilot cohort." : "Disabling while we investigate.",
    },
    principal,
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  });

const admin2 = async (): Promise<Principal> => {
  const principal = await withClient((client) => resolvePrincipal(client, "u_admin_2"));
  assert.ok(principal);
  return principal;
};

/**
 * Removes the database's own guard on flag state, so the tests below can prove the
 * other two mechanisms notice on their own. Nothing in the runtime can do this; it
 * takes ownership of the table, which is the point.
 */
const withoutTheDatabaseGuard = async (work: () => Promise<void>) => {
  await withClient((client) =>
    client.query("alter table feature_flags disable trigger feature_flags_state_is_audited"),
  );
  try {
    await work();
  } finally {
    await withClient((client) =>
      client.query("alter table feature_flags enable trigger feature_flags_state_is_audited"),
    );
  }
};

test("an ordinary flag flips immediately and the flip is attributable", async () => {
  const flipped = await flip(BULK_CLAIM, true, admin);
  assert.equal(flipped.outcome, "ok");
  assert.equal((await flagRow(BULK_CLAIM)).enabled, true);

  const { rows } = await withClient((client) =>
    client.query(
      `select c.from_enabled, c.to_enabled, c.flipped_by, c.at, a.actor_id, a.outcome, a.capability
         from feature_flag_changes c join audit_log a on a.invocation_id = c.invocation_id
        where c.flag_id = $1`,
      [BULK_CLAIM],
    ),
  );
  assert.equal(rows.length, 1, "one flip, one audit row, joined by invocation id");
  assert.equal(rows[0].from_enabled, false);
  assert.equal(rows[0].to_enabled, true);
  assert.equal(rows[0].flipped_by, "u_admin");
  assert.equal(rows[0].actor_id, "u_admin");
  assert.equal(rows[0].capability, "flags.flip");
  assert.ok(rows[0].at instanceof Date, "when it happened is recorded, not inferred");
});

test("only an admin may flip; everyone else reads", async () => {
  for (const principal of [agent, supervisor]) {
    const refused = await flip(DARK_MODE, true, principal);
    assert.equal(refused.outcome, "denied_scope");
    assert.match(refused.message ?? "", /flags:write/);
  }
  assert.equal((await flagRow(DARK_MODE)).enabled, false, "a refusal writes nothing");

  const read = await invoke<{ flags: { key: string; protected: boolean }[] }>({
    capability: "flags.list",
    input: {},
    principal: agent,
  });
  assert.equal(read.outcome, "ok", "the list is readable by every role");
  assert.ok((read.result?.flags ?? []).length > 0);

  const audited = await withClient((client) =>
    client.query<{ outcome: string }>(
      "select outcome from audit_log where capability = 'flags.flip' order by id",
    ),
  );
  assert.deepEqual(
    audited.rows.map((row) => row.outcome),
    ["denied_scope", "denied_scope"],
    "the refusals are on the record too",
  );
});

test("a protected flag waits for a second admin, and the requester cannot be the one who signs", async () => {
  const requested = await flip(INSTANT_PAYOUTS, true, admin);
  assert.equal(requested.outcome, "pending_approval");
  assert.match(requested.message ?? "", /flags:write/);
  assert.equal(
    (await flagRow(INSTANT_PAYOUTS)).enabled,
    false,
    "nothing takes effect until it is signed",
  );

  const approvalId = requested.approvalId;
  assert.ok(approvalId);

  const self = await decideApproval({ approvalId, decision: "approve", approver: admin });
  assert.equal(self.outcome, "denied_scope");
  assert.match(self.message ?? "", /own request/);

  // A supervisor decides approvals in general, but not this one: the scope the request
  // recorded when it was raised is the scope its decider must hold.
  const wrongScope = await decideApproval({ approvalId, decision: "approve", approver: supervisor });
  assert.equal(wrongScope.outcome, "denied_scope");
  assert.match(wrongScope.message ?? "", /flags:write/);
  assert.equal((await flagRow(INSTANT_PAYOUTS)).enabled, false);

  const decided = await decideApproval({ approvalId, decision: "approve", approver: (await admin2()) });
  assert.equal(decided.outcome, "ok");
  assert.equal((await flagRow(INSTANT_PAYOUTS)).enabled, true, "it takes effect when signed");

  const { rows } = await withClient((client) =>
    client.query<{ flipped_by: string; approver_scope: string; decided_by: string }>(
      `select c.flipped_by, ap.approver_scope, ap.decided_by
         from feature_flag_changes c
         join audit_log a on a.invocation_id = c.invocation_id
         join approvals ap on ap.id = a.approval_id
        where c.flag_id = $1`,
      [INSTANT_PAYOUTS],
    ),
  );
  assert.equal(rows[0]?.flipped_by, "u_admin", "the flip is the requester's, not the approver's");
  assert.equal(rows[0]?.approver_scope, "flags:write");
  assert.equal(rows[0]?.decided_by, "u_admin_2");

  assert.deepEqual(await violationsOf("flags.flip.carries_the_declared_approval"), []);
  assert.deepEqual(await violationsOf("approvals.decided_by_a_second_person"), []);
});

test("an ordinary flag is not held, and protection is read off the flag rather than the caller", async () => {
  assert.equal((await flip(DARK_MODE, true, admin)).outcome, "ok");
  const pending = await withClient((client) =>
    client.query("select id from approvals where status = 'pending'"),
  );
  assert.equal(pending.rows.length, 0, "an ordinary flip asks nobody");

  const held = await flip(INSTANT_PAYOUTS, true, (await admin2()));
  assert.equal(held.outcome, "pending_approval", "the same caller, a protected flag, and it waits");
});

test("flags.flip.carries_the_declared_approval: a protected flip nobody signed is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, "flags.flip");
    await client.query(
      `insert into feature_flag_changes
         (id, flag_id, from_enabled, to_enabled, note, flipped_by, invocation_id, capability)
       values ('flg_unsigned', $1, false, true, 'nobody countersigned', 'u_admin', $2,
               'flags.flip')`,
      [INSTANT_PAYOUTS, invocationId],
    );
  });

  const [violation, ...rest] = await violationsOf("flags.flip.carries_the_declared_approval");
  assert.deepEqual(rest, []);
  assert.match(violation?.detail ?? "", /no approval for an effect that required flags:write/);
});

test("effects_are_attributed: the database rejects a flip no invocation is responsible for", async () => {
  await assert.rejects(
    withClient((client) =>
      client.query(
        `insert into feature_flag_changes (id, flag_id, from_enabled, to_enabled, flipped_by)
         values ('flg_ghost', $1, false, true, 'u_admin')`,
        [DARK_MODE],
      ),
    ),
    /must be written by an audited invocation/,
  );
});

test("flip history cannot be rewritten or deleted", async () => {
  assert.equal((await flip(BULK_CLAIM, true, admin)).outcome, "ok");
  await assert.rejects(
    withClient((client) => client.query("update feature_flag_changes set to_enabled = false")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("delete from feature_flag_changes")),
    /append-only/,
  );
});

test("state_matches_the_last_recorded_change: the database refuses a flip by hand, and the reconciler catches one anyway", async () => {
  await assert.rejects(
    withClient((client) =>
      client.query("update feature_flags set enabled = true where id = $1", [DARK_MODE]),
    ),
    /changed state with no recorded flip/,
    "reaching the database directly does not get you an unrecorded flip",
  );

  // With that guard removed, the switch and its history disagree — and the invariant
  // that says they may not is what notices, without being told where to look.
  assert.equal((await flip(DARK_MODE, true, admin)).outcome, "ok");
  await withoutTheDatabaseGuard(async () => {
    await withClient((client) =>
      client.query("update feature_flags set enabled = false where id = $1", [DARK_MODE]),
    );
  });

  const [violation, ...rest] = await violationsOf("flags.flip.state_matches_the_last_recorded_change");
  assert.deepEqual(rest, []);
  assert.equal(violation?.subject, DARK_MODE);
  assert.match(violation?.detail ?? "", /is false but the last recorded change left it true/);

  const run = await reconcile();
  assert.ok(run.halted.includes("flags.flip"), "flipping stops until the drift is explained");
  const blocked = await flip(BULK_CLAIM, true, admin);
  assert.equal(blocked.outcome, "halted");
  assert.match(blocked.message ?? "", /state_matches_the_last_recorded_change/);
});

test("records_every_state_change: a history that does not join up is caught, and the runtime will not write into one", async () => {
  assert.equal((await flip(BULK_CLAIM, true, admin)).outcome, "ok");

  // The switch was moved outside the runtime and moved back, so the current state
  // agrees with the last recorded change and only the chain shows the gap.
  await withoutTheDatabaseGuard(async () => {
    await withClient(async (client) => {
      await client.query("update feature_flags set enabled = false where id = $1", [BULK_CLAIM]);
      await client.query("update feature_flags set enabled = true where id = $1", [BULK_CLAIM]);
    });
  });
  assert.deepEqual(await violationsOf("flags.flip.state_matches_the_last_recorded_change"), []);

  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, "flags.flip");
    await client.query(
      `insert into feature_flag_changes
         (id, flag_id, from_enabled, to_enabled, note, flipped_by, invocation_id, capability)
       values ('flg_forged', $1, false, true, 'continues a state nothing left', 'u_admin', $2,
               'flags.flip')`,
      [BULK_CLAIM, invocationId],
    );
  });

  const [violation, ...rest] = await violationsOf("flags.flip.records_every_state_change");
  assert.deepEqual(rest, []);
  assert.equal(violation?.subject, BULK_CLAIM);
  assert.match(violation?.detail ?? "", /recorded a move from false after the previous one left it true/);

  // And the postcondition means the runtime will not add to a broken history: the
  // flip is refused inside its own transaction rather than papering over the gap.
  const refused = await flip(BULK_CLAIM, false, admin);
  assert.equal(refused.outcome, "invariant_violation");
  assert.match(refused.message ?? "", /records_every_state_change/);
  assert.equal((await flagRow(BULK_CLAIM)).enabled, true, "nothing committed");
});

test("flags.flip.respects_declared_rate: more flips in an hour than the declaration allows is detectable", async () => {
  assert.deepEqual(await violationsOf("flags.flip.respects_declared_rate"), []);

  await withClient(async (client) => {
    for (let i = 0; i < 31; i += 1) {
      await forgeAudit(client, randomUUID(), "flags.flip");
    }
  });

  const [violation] = await violationsOf("flags.flip.respects_declared_rate");
  assert.ok(violation, "31 accepted flips in an hour breaks the declared rate of 30");
  assert.match(violation.detail, /above the declared 30/);
});

test("is_idempotent: a repeated flip replays instead of flipping twice", async () => {
  const key = `flags.flip:${BULK_CLAIM}:1`;
  const first = await flip(BULK_CLAIM, true, admin, { idempotencyKey: key });
  assert.equal(first.outcome, "ok");
  const second = await flip(BULK_CLAIM, true, admin, { revision: 1, idempotencyKey: key });
  assert.equal(second.outcome, "replayed");

  const changes = await withClient((client) =>
    client.query("select id from feature_flag_changes where flag_id = $1", [BULK_CLAIM]),
  );
  assert.equal(changes.rows.length, 1, "one key, one flip");
  assert.deepEqual(await violationsOf("flags.flip.is_idempotent"), []);
});

test("a flag that has moved on, or is already where you want it, is a refusal on the record", async () => {
  const stale = (await flagRow(DARK_MODE)).revision;
  assert.equal((await flip(DARK_MODE, true, admin)).outcome, "ok");

  const moved = await flip(DARK_MODE, false, admin, { revision: stale });
  assert.equal(moved.outcome, "conflict");
  assert.match(moved.message ?? "", /reload before flipping/);

  const already = await flip(DARK_MODE, true, admin);
  assert.equal(already.outcome, "conflict");
  assert.match(already.message ?? "", /already on/);

  const audited = await withClient((client) =>
    client.query<{ outcome: string }>(
      "select outcome from audit_log where capability = 'flags.flip' order by id",
    ),
  );
  assert.deepEqual(
    audited.rows.map((row) => row.outcome),
    ["ok", "conflict", "conflict"],
  );
});

test("the flag surface leaves every invariant satisfied after a signed protected flip", async () => {
  assert.equal((await flip(BULK_CLAIM, true, admin)).outcome, "ok");
  const requested = await flip(INSTANT_PAYOUTS, true, (await admin2()));
  assert.ok(requested.approvalId);
  assert.equal(
    (await decideApproval({ approvalId: requested.approvalId, decision: "approve", approver: admin }))
      .outcome,
    "ok",
  );

  const clean = await reconcile();
  assert.deepEqual(clean.violations, []);
  assert.deepEqual(clean.halted, []);
});
