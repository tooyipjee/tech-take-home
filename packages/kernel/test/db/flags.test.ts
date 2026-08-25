/**
 * The proof for feature flags, against a real database.
 *
 * A flag is different from everything else here: it is a state that effects *move*
 * rather than a record effects accumulate against, so the interesting attacks are on
 * the relationship between the switch and its history — flip it by hand, forge a
 * history that does not join up, flip a money-adjacent one without a second signature.
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
import { reconcile } from "../../src/reconciler.ts";
import { checkInvariant, getInvariant } from "../../src/invariants.ts";
import type { Principal } from "../../src/types.ts";

/** Ordinary switches: nobody else has to agree. */
const BULK_CLAIM = "flag_bulk_claim";
const DARK_MODE = "flag_dark_mode";
/** Protected: it gates a customer-facing money flow, so a second admin must sign. */
const INSTANT_PAYOUTS = "flag_instant_payouts";

let agent: Principal;
let supervisor: Principal;
let admin: Principal;
let secondAdmin: Principal;

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
    secondAdmin: await resolvePrincipal(client, "u_admin_2"),
  }));
  assert.ok(
    principals.agent && principals.supervisor && principals.admin && principals.secondAdmin,
  );
  agent = principals.agent;
  supervisor = principals.supervisor;
  admin = principals.admin;
  secondAdmin = principals.secondAdmin;
});

after(async () => {
  await pool.end();
});

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
     values ($1, 'u_admin', 'admin', $2, 'write', 'ok', '{}', $3, 1)`,
    [invocationId, capability, key ?? null],
  );

/**
 * Removes the database's own guard on flag state, so the tests below can prove the
 * *other* two mechanisms notice on their own. Nothing in the runtime can do this; it
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

  const decided = await decideApproval({ approvalId, decision: "approve", approver: secondAdmin });
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

  const held = await flip(INSTANT_PAYOUTS, true, secondAdmin);
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
  const requested = await flip(INSTANT_PAYOUTS, true, secondAdmin);
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
