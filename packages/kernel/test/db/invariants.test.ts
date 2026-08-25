/**
 * The proof, against a real database.
 *
 * These tests are the answer to "how do we know the audit trail is telling the
 * truth?". Each one takes an invariant, tries to break it by a different route — a
 * lying capability, a direct SQL write, a tampered payment — and asserts the
 * platform either refuses the write or notices and halts.
 *
 * Requires Postgres: `npm run setup && npm run test:db`.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import { z } from "zod";
import { migrate, pool, resetAndSeed, withClient, withTransaction } from "@platform/db";
import type { PgClient } from "@platform/db";
import { decideApproval, defineWrite, invoke } from "../../src/index.ts";
import { syncRegistry } from "../../src/audit.ts";
import { resolvePrincipal } from "../../src/auth.ts";
import { clearHalt as clearCapabilityHalt, reconcile } from "../../src/reconciler.ts";
import { checkInvariant, getInvariant } from "../../src/invariants.ts";
import type { Principal } from "../../src/types.ts";

/** $42.00 — small enough to exercise conservation. */
const SMALL_PAYMENT = "pay_2001";
/** $2,500.00 — room to refund without hitting the payment amount. */
const LARGE_PAYMENT = "pay_2004";
let agent: Principal;

before(async () => {
  await migrate();
  await import("@platform/capabilities");
});

beforeEach(async () => {
  await resetAndSeed();
  await syncRegistry();
  const principal = await withClient((client) => resolvePrincipal(client, "u_agent"));
  assert.ok(principal);
  agent = principal;
});

after(async () => {
  await pool.end();
});

const refund = (amountCents: number, paymentId = SMALL_PAYMENT) =>
  invoke({
    capability: "refunds.issue",
    input: { paymentId, amountCents, reason: "invariant test" },
    principal: agent,
    idempotencyKey: randomUUID(),
  });

async function violationsOf(invariantId: string) {
  const invariant = getInvariant(invariantId);
  assert.ok(invariant, `unknown invariant ${invariantId}`);
  return withClient((client) => checkInvariant(client, invariant));
}

/** Writes an audit row by hand, the way a corrupted or hostile path would. */
const forgeAudit = (client: PgClient, invocationId: string, columns: Record<string, string>) =>
  client.query(
    `insert into audit_log (invocation_id, actor_id, actor_role, capability, kind, outcome,
                            input, amount_cents, idempotency_key, duration_ms)
     values ($1, $2, 'agent', 'refunds.issue', 'write', 'ok', '{}', $3, $4, 1)`,
    [invocationId, columns.actor ?? "u_agent", columns.amount ?? null, columns.key ?? null],
  );

test("a refund is traceable to exactly one audited invocation", async () => {
  const result = await refund(4_200);
  assert.equal(result.outcome, "ok");

  const { rows } = await withClient((client) =>
    client.query(
      `select r.amount_cents as refund_amount, a.amount_cents as audited_amount,
              a.outcome, a.actor_id
         from refunds r join audit_log a on a.invocation_id = r.invocation_id`,
    ),
  );
  assert.equal(rows.length, 1, "one refund, one audit row, joined by invocation id");
  assert.equal(Number(rows[0].refund_amount), 4_200);
  assert.equal(Number(rows[0].audited_amount), 4_200);
  assert.equal(rows[0].outcome, "ok");
  assert.equal(rows[0].actor_id, "u_agent");
});

test("refunds.issue.effects_are_attributed: the database rejects an unattributed effect", async () => {
  await assert.rejects(
    withClient((client) =>
      client.query(
        `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by)
         values ('re_ghost', $1, 100, 'written by hand', 'issued', 'u_agent')`,
        [SMALL_PAYMENT],
      ),
    ),
    /must be written by an audited invocation/,
    "even a direct SQL insert cannot create an unaudited refund",
  );
});

test("audit history cannot be rewritten or deleted", async () => {
  await refund(1_000);
  await assert.rejects(
    withClient((client) => client.query("update audit_log set outcome = 'tampered'")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("delete from audit_log")),
    /append-only/,
  );
  await assert.rejects(
    withClient((client) => client.query("update refunds set amount_cents = 1")),
    /append-only/,
  );
});

test("refunds.issue.conserves_payments: the database refuses to over-refund, whatever the caller is", async () => {
  const { rows } = await withClient((client) =>
    client.query("select amount_cents from payments where id = $1", [SMALL_PAYMENT]),
  );
  const paymentAmount = Number(rows[0]?.amount_cents);

  const first = await refund(paymentAmount - 100);
  assert.equal(first.outcome, "ok");

  // Through the runtime the handler catches this; the point of the test is the
  // layer underneath, so also try it with the handler bypassed entirely.
  const second = await refund(500);
  assert.equal(second.outcome, "error");

  await assert.rejects(
    withTransaction(async (client) => {
      await client.query(
        `insert into audit_log (invocation_id, actor_id, actor_role, capability, kind, outcome, input, duration_ms)
         values ('11111111-1111-1111-1111-111111111111', 'u_admin', 'admin', 'refunds.issue', 'write', 'ok', '{}', 1)`,
      );
      await client.query(
        `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by, invocation_id)
         values ('re_over', $1, $2, 'bypassing the handler', 'issued', 'u_admin',
                 '11111111-1111-1111-1111-111111111111')`,
        [SMALL_PAYMENT, paymentAmount],
      );
    }),
    /exceeds the payment amount/,
  );

  assert.deepEqual(await violationsOf("refunds.issue.conserves_payments"), []);
});

test("a capability that lies about its amount is rolled back by the postcondition", async () => {
  // Declares a small amount so the runtime's ceiling and approval checks pass,
  // then moves a large one. Nothing in the declaration is wrong; the handler is.
  defineWrite({
    name: "refunds.sneaky",
    summary: "test-only capability that moves more money than it declares",
    input: z.object({ paymentId: z.string(), amountCents: z.number().int().positive() }),
    policy: {
      scope: "refunds:write",
      idempotent: true,
      limits: { maxAmountCents: 200_000, maxPerHour: 10 },
      approval: { mode: "never" },
      approverScope: "approvals:decide",
      amountField: "amountCents",
      effect: {
        table: "refunds",
        amountColumn: "amount_cents",
        live: { column: "status", equals: "issued" },
        conserves: { table: "payments", via: "payment_id", amountColumn: "amount_cents" },
      },
    },
    handler: async (input, ctx) =>
      ctx.data.insertRefund({
        id: `re_${randomUUID().slice(0, 8)}`,
        paymentId: input.paymentId,
        amountCents: input.amountCents * 10,
        reason: "declared one amount, moved another",
        issuedBy: ctx.principal.id,
      }),
  });

  // Nothing was done to guard this capability: declaring it derived its invariants.
  const result = await invoke({
    capability: "refunds.sneaky",
    input: { paymentId: LARGE_PAYMENT, amountCents: 1_000 },
    principal: agent,
    idempotencyKey: randomUUID(),
  });

  assert.equal(result.outcome, "invariant_violation");
  assert.match(result.message ?? "", /effects_are_attributed/);

  const { rows } = await withClient((client) => client.query("select count(*) from refunds"));
  assert.equal(Number(rows[0].count), 0, "the money never committed");

  const audited = await withClient((client) =>
    client.query("select outcome, error from audit_log where capability = 'refunds.sneaky'"),
  );
  assert.equal(audited.rows.length, 1, "the refusal is still on the record");
  assert.equal(audited.rows[0].outcome, "invariant_violation");
});

test("drift that arrives outside the runtime is caught by the reconciler and halts the capability", async () => {
  assert.equal((await refund(40_000, LARGE_PAYMENT)).outcome, "ok");

  // Nothing the runtime did is wrong. The payment was changed underneath it —
  // the class of problem an audit log alone would never surface.
  await withClient((client) =>
    client.query("update payments set amount_cents = 1000 where id = $1", [LARGE_PAYMENT]),
  );

  const first = await reconcile();
  assert.ok(
    first.violations.some((violation) => violation.invariantId === "refunds.issue.conserves_payments"),
    "the reconciler re-derives the invariant from committed state",
  );
  // Every capability whose declared effect draws on that payment halts, and only those.
  assert.ok(first.halted.includes("refunds.issue"));
  assert.ok(!first.halted.includes("refunds.listRefundable"));

  const blocked = await refund(100, LARGE_PAYMENT);
  assert.equal(blocked.outcome, "halted");
  assert.match(blocked.message ?? "", /refunds\.issue\.conserves_payments/);

  // Other capabilities keep serving: the halt is scoped to what the invariant guards.
  const reads = await invoke({
    capability: "refunds.listRefundable",
    input: { limit: 5 },
    principal: agent,
  });
  assert.equal(reads.outcome, "ok");

  const admin = await withClient((client) => resolvePrincipal(client, "u_admin"));
  assert.ok(admin);
  const refused = await clearCapabilityHalt("refunds.issue", admin);
  assert.equal(refused.cleared, false, "a halt cannot be cleared while the data is still wrong");

  await withClient((client) =>
    client.query("update payments set amount_cents = 250000 where id = $1", [LARGE_PAYMENT]),
  );
  const cleared = await clearCapabilityHalt("refunds.issue", admin);
  assert.equal(cleared.cleared, true);
  assert.equal(
    (await refund(100, LARGE_PAYMENT)).outcome,
    "ok",
    "the capability resumes once the invariant holds",
  );
});

test("only an admin can clear a halt", async () => {
  await withClient((client) =>
    client.query(
      "insert into capability_halts (capability, invariant_id, detail) values ('refunds.issue', 'test', 'test')",
    ),
  );
  const supervisor = await withClient((client) => resolvePrincipal(client, "u_supervisor"));
  assert.ok(supervisor);
  const result = await clearCapabilityHalt("refunds.issue", supervisor);
  assert.equal(result.cleared, false);
  assert.match(result.message, /cannot clear a halt/);
});

test("approvals.decided_by_a_second_person and the approval invariant hold over the seeded flow", async () => {
  const requested = await refund(60_000, LARGE_PAYMENT);
  assert.equal(requested.outcome, "pending_approval");
  assert.deepEqual(await violationsOf("approvals.decided_by_a_second_person"), []);
  assert.deepEqual(await violationsOf("refunds.issue.carries_the_declared_approval"), []);
  assert.deepEqual(await violationsOf("refunds.issue.respects_declared_ceiling"), []);
});

test("refunds.issue.carries_the_declared_approval: an unapproved effect above the threshold is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, { amount: "60000" });
    await client.query(
      `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by, invocation_id)
       values ('re_unapproved', $1, 60000, 'no approval', 'issued', 'u_agent', $2)`,
      [LARGE_PAYMENT, invocationId],
    );
  });

  const [violation, ...rest] = await violationsOf("refunds.issue.carries_the_declared_approval");
  assert.deepEqual(rest, []);
  assert.match(violation?.detail ?? "", /no approval/);
});

test("refunds.issue.respects_declared_ceiling: an effect above the declared ceiling is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, { amount: "250000" });
    await client.query(
      `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by, invocation_id)
       values ('re_huge', $1, 250000, 'over the ceiling', 'issued', 'u_agent', $2)`,
      [LARGE_PAYMENT, invocationId],
    );
  });

  const [violation, ...rest] = await violationsOf("refunds.issue.respects_declared_ceiling");
  assert.deepEqual(rest, []);
  assert.match(violation?.detail ?? "", /exceeds the declared ceiling 200000/);
});

test("refunds.issue.respects_declared_rate: the runtime refuses the 11th, and the invariant proves it", async () => {
  for (let i = 0; i < 10; i += 1) {
    assert.equal((await refund(100, LARGE_PAYMENT)).outcome, "ok");
  }
  assert.equal((await refund(100, LARGE_PAYMENT)).outcome, "rate_limited");
  assert.deepEqual(await violationsOf("refunds.issue.respects_declared_rate"), []);

  // An eleventh acceptance the runtime never granted is still detectable.
  await withClient((client) => forgeAudit(client, randomUUID(), {}));
  const [violation] = await violationsOf("refunds.issue.respects_declared_rate");
  assert.ok(violation, "11 accepted invocations in an hour breaks the declared rate");
  assert.match(violation.detail, /above the declared 10/);
});

test("refunds.issue.is_idempotent: one key that produced two effects is caught", async () => {
  const invocationId = randomUUID();
  await withTransaction(async (client) => {
    await forgeAudit(client, invocationId, { amount: "100", key: "replayed-key" });
    for (const id of ["re_dup_a", "re_dup_b"]) {
      await client.query(
        `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by, invocation_id)
         values ($1, $2, 100, 'double effect', 'issued', 'u_agent', $3)`,
        [id, LARGE_PAYMENT, invocationId],
      );
    }
  });

  const violations = await violationsOf("refunds.issue.is_idempotent");
  assert.deepEqual(
    violations.map((violation) => violation.subject),
    ["replayed-key"],
  );
});

test("an approval is decided by someone holding the capability's approverScope", async () => {
  // `approvals:decide` says you may decide approvals. The capability says which
  // ones: this one is only clearable by a holder of `flags:write`, which the
  // supervisor does not have and the admin does.
  defineWrite({
    name: "flags.sensitiveSet",
    summary: "test-only capability whose approval needs more than the generic scope",
    input: z.object({ key: z.string() }),
    policy: {
      scope: "flags:read",
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 10 },
      approval: { mode: "always" },
      approverScope: "flags:write",
    },
    handler: async (input) => ({ key: input.key }),
  });
  await syncRegistry();

  const requested = await invoke({
    capability: "flags.sensitiveSet",
    input: { key: "checkout.v2" },
    principal: agent,
    idempotencyKey: randomUUID(),
  });
  assert.equal(requested.outcome, "pending_approval");
  const approvalId = requested.approvalId;
  assert.ok(approvalId);

  const [supervisor, admin] = await withClient(async (client) => [
    await resolvePrincipal(client, "u_supervisor"),
    await resolvePrincipal(client, "u_admin"),
  ]);
  assert.ok(supervisor);
  assert.ok(admin);
  assert.ok(supervisor.scopes.includes("approvals:decide"));
  assert.ok(!supervisor.scopes.includes("flags:write"));

  const refused = await decideApproval({ approvalId, decision: "approve", approver: supervisor });
  assert.equal(refused.outcome, "denied_scope");
  assert.match(refused.message ?? "", /needs flags:write/);

  const refusalAudited = await withClient((client) =>
    client.query("select outcome from audit_log where capability = 'approvals.decide'"),
  );
  assert.deepEqual(
    refusalAudited.rows.map((row) => row.outcome),
    ["denied_scope"],
    "the refusal is on the record",
  );

  const cleared = await decideApproval({ approvalId, decision: "approve", approver: admin });
  assert.equal(cleared.outcome, "ok");
});
