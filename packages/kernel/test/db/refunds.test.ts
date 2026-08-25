/**
 * The refunds desk, attacked.
 *
 * A refund here never leaves the database, which is precisely why the database has to
 * be the thing that is right: the row is the instruction the payments team executes. So
 * each test takes one promise the declaration makes — the ceiling nobody can approve
 * past, the pool that cannot be overdrawn across several partial refunds, the
 * countersignature the requester cannot supply, the hourly rate, the attribution — and
 * tries to get around it by a different route: through the runtime, around the handler
 * with direct SQL, and by racing two refunds at the same payment concurrently.
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

/** $480 settled: small enough that an agent may refund all of it unaided. */
const SMALL_PAYMENT = "pay_5002";
/** $965 settled: a full refund needs a supervisor, a partial one may not. */
const MID_PAYMENT = "pay_5003";
/** $1,850 settled: above the threshold, still under the ceiling. */
const LARGE_PAYMENT = "pay_5005";
/** $3,410 settled: a full refund is over the ceiling and can never be signed through. */
const OVER_CEILING_PAYMENT = "pay_5006";

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

const refund = (
  paymentId: string,
  amountCents: number,
  principal: Principal,
  options: { reason?: string; idempotencyKey?: string } = {},
) =>
  invoke({
    capability: "refunds.issue",
    input: {
      paymentId,
      amountCents,
      reason: options.reason ?? "Customer was charged twice for the same order.",
    },
    principal,
    idempotencyKey: options.idempotencyKey ?? randomUUID(),
  });

async function violationsOf(invariantId: string) {
  const invariant = getInvariant(invariantId);
  assert.ok(invariant, `unknown invariant ${invariantId}`);
  return withClient((client) => checkInvariant(client, invariant));
}

const refundedTotal = async (paymentId: string): Promise<number> => {
  const { rows } = await withClient((client) =>
    client.query<{ total: string }>(
      "select coalesce(sum(amount_cents), 0) as total from refunds where payment_id = $1",
      [paymentId],
    ),
  );
  return Number(rows[0]?.total ?? 0);
};

/**
 * Writes an audit row by hand, the way a corrupted or hostile path would. The amount is
 * recorded truthfully so the attribution rule is satisfied and the test is attacking the
 * invariant it names rather than tripping over a different one.
 */
const forgeAudit = (client: PgClient, invocationId: string, amountCents: number, key?: string) =>
  client.query(
    `insert into audit_log (invocation_id, actor_id, actor_role, capability, kind, outcome,
                            input, amount_cents, idempotency_key, duration_ms)
     values ($1, 'u_agent', 'agent', 'refunds.issue', 'write', 'ok',
             jsonb_build_object('amountCents', $2::bigint), $2, $3, 1)`,
    [invocationId, amountCents, key ?? null],
  );

/** Inserts a refund row directly, bypassing the handler entirely. */
const forgeRefund = (client: PgClient, invocationId: string, paymentId: string, amount: number) =>
  client.query(
    `insert into refunds (id, payment_id, amount_cents, reason, status, requested_by,
                          invocation_id, capability)
     values ($1, $2, $3, 'written by hand', 'issued', 'u_agent', $4, 'refunds.issue')`,
    [`ref_${randomUUID().slice(0, 12)}`, paymentId, amount, invocationId],
  );

test("an agent can refund up to the threshold alone, and the row is a record of intent only", async () => {
  const result = await refund(SMALL_PAYMENT, 48_000, agent);
  assert.equal(result.outcome, "ok", "$480 is under the $500 threshold");

  const { rows } = await withClient((client) =>
    client.query(
      `select r.amount_cents, r.status, r.requested_by, a.actor_id, a.outcome, a.capability
         from refunds r join audit_log a on a.invocation_id = r.invocation_id`,
    ),
  );
  assert.equal(rows.length, 1, "one refund, one audited invocation, joined by invocation id");
  assert.equal(Number(rows[0].amount_cents), 48_000);
  assert.equal(rows[0].status, "issued", "issued means recorded for the payments team, not sent");
  assert.equal(rows[0].requested_by, "u_agent");
  assert.equal(rows[0].actor_id, "u_agent");
  assert.equal(rows[0].outcome, "ok");
  assert.deepEqual(await violationsOf("refunds.issue.effects_are_attributed"), []);
});

test("effects_are_attributed: the database rejects a refund no invocation is responsible for", async () => {
  await assert.rejects(
    withClient((client) =>
      client.query(
        `insert into refunds (id, payment_id, amount_cents, reason, status, requested_by)
         values ('ref_ghost', $1, 1000, 'written by hand', 'issued', 'u_admin')`,
        [SMALL_PAYMENT],
      ),
    ),
    /must be written by an audited invocation/,
    "money cannot be promised back without a name attached to the request",
  );
});

test("a refund cannot be rewritten or deleted once issued", async () => {
  assert.equal((await refund(SMALL_PAYMENT, 10_000, agent)).outcome, "ok");
  await assert.rejects(
    withClient((client) => client.query("update refunds set amount_cents = 1")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("delete from refunds")),
    /append-only/,
  );
});

test("respects_declared_ceiling: above the ceiling is refused outright, and no approver can override it", async () => {
  const asAgent = await refund(OVER_CEILING_PAYMENT, 250_000, agent);
  assert.equal(asAgent.outcome, "denied_limit");
  assert.match(asAgent.message ?? "", /ceiling/);

  // The distinction that matters: this never became an approval request, so there is
  // nothing for anyone to sign. A supervisor, who could have countersigned it, gets the
  // same answer as the agent.
  const asSupervisor = await refund(OVER_CEILING_PAYMENT, 250_000, supervisor);
  assert.equal(asSupervisor.outcome, "denied_limit");
  const approvals = await withClient((client) => client.query("select id from approvals"));
  assert.deepEqual(approvals.rows, [], "a ceiling is not a threshold: it raises no request");
  assert.equal(await refundedTotal(OVER_CEILING_PAYMENT), 0);

  // The refusals are on the record with who asked for what.
  const audited = await withClient((client) =>
    client.query<{ outcome: string; actor_id: string }>(
      "select outcome, actor_id from audit_log where capability = 'refunds.issue' order by at",
    ),
  );
  assert.deepEqual(
    audited.rows.map((row) => [row.actor_id, row.outcome]),
    [
      ["u_agent", "denied_limit"],
      ["u_supervisor", "denied_limit"],
    ],
  );

  // And around the handler, the database refuses the same amount.
  await assert.rejects(
    withTransaction(async (client) => {
      const invocationId = randomUUID();
      await forgeAudit(client, invocationId, 250_000);
      await forgeRefund(client, invocationId, OVER_CEILING_PAYMENT, 250_000);
    }),
    /ceiling/,
  );
  assert.deepEqual(await violationsOf("refunds.issue.respects_declared_ceiling"), []);
});

test("conserves_payments: several partial refunds cannot together exceed the payment", async () => {
  assert.equal((await refund(SMALL_PAYMENT, 30_000, agent)).outcome, "ok");
  assert.equal((await refund(SMALL_PAYMENT, 15_000, agent)).outcome, "ok");

  const overdraw = await refund(SMALL_PAYMENT, 5_000, agent);
  assert.equal(overdraw.outcome, "conflict", "$450 of $480 is already promised back");
  assert.match(overdraw.message ?? "", /\$30\.00 of PAY-5002 is left/);

  // Exactly the remainder is allowed: the limit is the payment, not a margin under it.
  assert.equal((await refund(SMALL_PAYMENT, 3_000, agent)).outcome, "ok");
  assert.equal(await refundedTotal(SMALL_PAYMENT), 48_000);

  // With the handler bypassed, the trigger still refuses the cent that overdraws it.
  await assert.rejects(
    withTransaction(async (client) => {
      const invocationId = randomUUID();
      await forgeAudit(client, invocationId, 1);
      await forgeRefund(client, invocationId, SMALL_PAYMENT, 1);
    }),
    /above the payment amount/,
  );
  assert.equal(await refundedTotal(SMALL_PAYMENT), 48_000);
  assert.deepEqual(await violationsOf("refunds.issue.conserves_payments"), []);
});

test("conserves_payments: two refunds racing at the same payment cannot both win", async () => {
  // Each is fine on its own and they overdraw together, which is the case a check
  // outside a lock reads as safe twice.
  const [first, second] = await Promise.all([
    refund(SMALL_PAYMENT, 40_000, agent),
    refund(SMALL_PAYMENT, 40_000, supervisor),
  ]);
  const outcomes = [first.outcome, second.outcome].sort();
  assert.deepEqual(outcomes, ["conflict", "ok"], "one lands, one is told what is left");
  assert.equal(await refundedTotal(SMALL_PAYMENT), 40_000);
  assert.deepEqual(await violationsOf("refunds.issue.conserves_payments"), []);
});

test("carries_the_declared_approval: above the threshold waits for a second person, who cannot be the requester", async () => {
  const requested = await refund(LARGE_PAYMENT, 90_000, agent);
  assert.equal(requested.outcome, "pending_approval");
  assert.match(requested.message ?? "", /refunds:approve/);
  const approvalId = requested.approvalId;
  assert.ok(approvalId);
  assert.equal(await refundedTotal(LARGE_PAYMENT), 0, "nothing is promised while it waits");

  const { rows } = await withClient((client) =>
    client.query<{ approver_scope: string; amount_cents: string; requested_by: string }>(
      "select approver_scope, amount_cents, requested_by from approvals where id = $1",
      [approvalId],
    ),
  );
  assert.equal(rows[0]?.approver_scope, "refunds:approve", "the scope is fixed when it is raised");
  assert.equal(Number(rows[0]?.amount_cents), 90_000, "so is the amount being signed for");
  assert.equal(rows[0]?.requested_by, "u_agent");

  const decided = await decideApproval({ approvalId, decision: "approve", approver: supervisor });
  assert.equal(decided.outcome, "ok");
  assert.equal(await refundedTotal(LARGE_PAYMENT), 90_000);

  const effect = await withClient((client) =>
    client.query<{ requested_by: string }>("select requested_by from refunds where payment_id = $1", [
      LARGE_PAYMENT,
    ]),
  );
  assert.equal(
    effect.rows[0]?.requested_by,
    "u_agent",
    "the refund stays the agent's, countersigned by the supervisor",
  );
  assert.deepEqual(await violationsOf("refunds.issue.carries_the_declared_approval"), []);
  assert.deepEqual(await violationsOf("approvals.decided_by_a_second_person"), []);
});

test("a supervisor's own large refund still needs someone else to sign it", async () => {
  const requested = await refund(MID_PAYMENT, 96_500, supervisor);
  assert.equal(requested.outcome, "pending_approval", "holding the scope is not signing");
  const approvalId = requested.approvalId;
  assert.ok(approvalId);

  const self = await decideApproval({ approvalId, decision: "approve", approver: supervisor });
  assert.equal(self.outcome, "denied_scope");
  assert.match(self.message ?? "", /own request/);

  const withoutScope = await withClient((client) => resolvePrincipal(client, "u_agent"));
  assert.ok(withoutScope);
  const refused = await decideApproval({ approvalId, decision: "approve", approver: withoutScope });
  assert.equal(refused.outcome, "denied_scope", "an agent cannot sign off what an agent asks for");
  assert.equal(await refundedTotal(MID_PAYMENT), 0);

  const granted = await decideApproval({ approvalId, decision: "approve", approver: admin });
  assert.equal(granted.outcome, "ok");
  assert.equal(await refundedTotal(MID_PAYMENT), 96_500);
});

test("a rejected refund request never becomes a refund, and says who refused it", async () => {
  const requested = await refund(LARGE_PAYMENT, 120_000, agent);
  assert.equal(requested.outcome, "pending_approval");
  assert.ok(requested.approvalId);

  const rejected = await decideApproval({
    approvalId: requested.approvalId,
    decision: "reject",
    approver: secondAdmin,
  });
  assert.equal(rejected.outcome, "ok", "refusing is a decision the platform accepts");
  assert.equal(await refundedTotal(LARGE_PAYMENT), 0, "and nothing is owed as a result of it");

  const { rows } = await withClient((client) =>
    client.query<{ status: string; decided_by: string; requested_by: string }>(
      "select status, decided_by, requested_by from approvals",
    ),
  );
  assert.equal(rows[0]?.status, "rejected");
  assert.equal(rows[0]?.decided_by, "u_admin_2");
  assert.equal(rows[0]?.requested_by, "u_agent");
});

test("carries_the_declared_approval: a large refund nobody countersigned is caught after the fact", async () => {
  await withTransaction(async (client) => {
    const invocationId = randomUUID();
    await forgeAudit(client, invocationId, 150_000);
    await forgeRefund(client, invocationId, LARGE_PAYMENT, 150_000);
  });

  const [violation, ...rest] = await violationsOf("refunds.issue.carries_the_declared_approval");
  assert.deepEqual(rest, []);
  assert.match(violation?.detail ?? "", /no approval for an effect that required refunds:approve/);

  const halted = await reconcile();
  assert.ok(halted.halted.includes("refunds.issue"), "the desk stops until it is explained");
  const blocked = await refund(SMALL_PAYMENT, 1_000, agent);
  assert.equal(blocked.outcome, "halted");
  assert.match(blocked.message ?? "", /refunds\.issue\.carries_the_declared_approval/);
});

test("respects_declared_rate: an agent is held to the declared refunds per hour", async () => {
  // Ten $1 refunds spread across payments: each is trivially allowed on its own.
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await refund(SMALL_PAYMENT, 100, agent)).outcome, "ok", `refund ${i + 1} of 10`);
  }

  const eleventh = await refund(SMALL_PAYMENT, 100, agent);
  assert.equal(eleventh.outcome, "rate_limited");
  assert.match(eleventh.message ?? "", /10/);

  // The limit is per actor, not per desk.
  assert.equal((await refund(MID_PAYMENT, 100, supervisor)).outcome, "ok");
  assert.deepEqual(await violationsOf("refunds.issue.respects_declared_rate"), []);

  // And an acceptance the runtime never granted is still detectable afterwards.
  await withClient(async (client) => {
    await forgeAudit(client, randomUUID(), 100);
  });
  const [violation] = await violationsOf("refunds.issue.respects_declared_rate");
  assert.ok(violation, "11 accepted refunds in an hour breaks the declared rate of 10");
  assert.match(violation.detail, /above the declared 10/);
});

test("is_idempotent: a resubmitted refund is replayed, not refunded twice", async () => {
  const key = randomUUID();
  const first = await refund(SMALL_PAYMENT, 20_000, agent, { idempotencyKey: key });
  assert.equal(first.outcome, "ok");

  const again = await refund(SMALL_PAYMENT, 20_000, agent, { idempotencyKey: key });
  assert.equal(again.outcome, "replayed", "the agent double-clicked; the customer is owed once");
  assert.equal(await refundedTotal(SMALL_PAYMENT), 20_000);

  // Forged: one key, two effects.
  await withTransaction(async (client) => {
    const invocationId = randomUUID();
    await forgeAudit(client, invocationId, 1_000, "replayed-key");
    await forgeRefund(client, invocationId, MID_PAYMENT, 1_000);
    await forgeRefund(client, invocationId, MID_PAYMENT, 1_000);
  });
  assert.deepEqual(
    (await violationsOf("refunds.issue.is_idempotent")).map((violation) => violation.subject),
    ["replayed-key"],
  );
});

test("an unreasoned or malformed refund is a refusal, not a bad row", async () => {
  const noReason = await refund(SMALL_PAYMENT, 1_000, agent, { reason: "typo" });
  assert.equal(noReason.outcome, "invalid_input");

  const negative = await refund(SMALL_PAYMENT, -1_000, agent);
  assert.equal(negative.outcome, "invalid_input");

  const missing = await refund("pay_does_not_exist", 1_000, agent);
  assert.equal(missing.outcome, "not_found");
  assert.equal(await refundedTotal(SMALL_PAYMENT), 0);
});

test("asking and signing are separate scopes, and a compliance officer only signs", async () => {
  const read = await invoke({
    capability: "refunds.payments.list",
    input: {},
    principal: admin,
  });
  assert.equal(read.outcome, "ok", "an officer can read what they are being asked to sign");

  // An officer countersigns refunds; they do not raise them. Their attempt is refused
  // and recorded, so "who asked" can never be someone who was also entitled to sign.
  const raised = await refund(SMALL_PAYMENT, 1_000, admin);
  assert.equal(raised.outcome, "denied_scope");
  assert.match(raised.message ?? "", /refunds:issue/);
  assert.equal(await refundedTotal(SMALL_PAYMENT), 0);

  const audited = await withClient((client) =>
    client.query<{ outcome: string }>(
      "select outcome from audit_log where actor_id = 'u_admin' and capability = 'refunds.issue'",
    ),
  );
  assert.deepEqual(
    audited.rows.map((row) => row.outcome),
    ["denied_scope"],
    "a refused attempt is as attributable as an accepted one",
  );

  assert.ok(agent.scopes.includes("refunds:issue"));
  assert.ok(!agent.scopes.includes("refunds:approve"), "an agent cannot sign their own kind of work");
  assert.ok(supervisor.scopes.includes("refunds:approve"));
  assert.ok(!admin.scopes.includes("refunds:issue"));
});

test("the seeded refunds desk satisfies every invariant it declares", async () => {
  assert.equal((await refund(SMALL_PAYMENT, 12_000, agent)).outcome, "ok");
  const requested = await refund(LARGE_PAYMENT, 80_000, agent);
  assert.ok(requested.approvalId);
  await decideApproval({
    approvalId: requested.approvalId,
    decision: "approve",
    approver: supervisor,
  });

  const clean = await reconcile();
  assert.deepEqual(clean.violations, []);
  assert.deepEqual(clean.halted, []);
});
