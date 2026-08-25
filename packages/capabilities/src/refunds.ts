import { defineRead, defineWrite, previewApproval } from "@rangka/kernel";
import { z } from "zod";

/**
 * The refunds desk's capabilities.
 *
 * A refund here is a record of intent for the payments team: nothing leaves the
 * database, no card network is called. That is exactly why the row has to be
 * attributable — it is the instruction someone downstream acts on.
 *
 * Everything a reviewer has to be right about is in the policy block of
 * `issueRefund`: who may ask, how much they may move alone, who has to countersign
 * above that, the amount no countersignature can get past, how often, and which pool
 * the effect draws down so the platform can prove afterwards that it never overdrew.
 */

const paymentId = z.string().min(1);

/** Above this, a second person holding `refunds:approve` must agree. */
const APPROVAL_THRESHOLD_CENTS = 50_000;

/**
 * A ceiling, not a threshold: the runtime refuses an amount above this before it ever
 * looks at approvals, so there is no approver who can let one through. Raising it is a
 * reviewed tier-2 change, and the database reads the number back out of the registry.
 */
const HARD_CEILING_CENTS = 200_000;

export const listPayments = defineRead({
  name: "refunds.payments.list",
  summary: "List settled payments with what has already been refunded against each.",
  input: z.object({
    query: z.string().optional(),
    customerId: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  policy: { scope: "refunds:read", maxRows: 100 },
  handler: async (input, ctx) => ({
    payments: await ctx.data.listPayments({ ...input, limit: input.limit ?? 100 }),
  }),
});

export const getPayment = defineRead({
  name: "refunds.payments.get",
  summary:
    "Read one payment, the refunds already issued against it, and the customer's other payments.",
  input: z.object({ paymentId, amountCents: z.number().int().positive().optional() }),
  policy: { scope: "refunds:read", maxRows: 1 },
  // `refundApproval` is the runtime answering "what would you demand of a refund of
  // this size?", so the agent is told a supervisor will have to sign before they press
  // the button — without the screen holding its own copy of the threshold, which would
  // be free to disagree with the one enforced.
  handler: async (input, ctx) => ({
    payment: await ctx.data.getPayment(input.paymentId),
    refundApproval:
      input.amountCents === undefined
        ? null
        : await previewApproval("refunds.issue", {
            paymentId: input.paymentId,
            amountCents: input.amountCents,
          }),
  }),
});

export const issueRefund = defineWrite({
  name: "refunds.issue",
  summary: "Record a full or partial refund against a payment for the payments team to execute.",
  input: z.object({
    paymentId,
    // Deliberately unbounded here: an amount over the ceiling is a refusal by the
    // declared limit, not a malformed request, and the two must not be confused in
    // the audit log.
    amountCents: z.number().int().positive(),
    reason: z.string().trim().min(10, "a refund reason must contain at least 10 characters"),
  }),
  policy: {
    scope: "refunds:issue",
    idempotent: true,
    limits: { maxAmountCents: HARD_CEILING_CENTS, maxPerHour: 10 },
    approval: { mode: "above_amount", amountCents: APPROVAL_THRESHOLD_CENTS },
    approverScope: "refunds:approve",
    amountField: "amountCents",
    subject: { table: "payments", idField: "paymentId" },
    effect: {
      table: "refunds",
      subjectColumn: "payment_id",
      amountColumn: "amount_cents",
      live: { column: "status", equals: "issued" },
      // The payment is the pool. Stated once, here: the runtime holds the row while it
      // writes, the database refuses the insert that would overdraw it, and the derived
      // invariant re-proves the sum over committed rows — including across several
      // partial refunds, which is the case a per-call check would miss.
      conserves: { table: "payments", via: "payment_id", amountColumn: "amount_cents" },
    },
  },
  handler: async (input, ctx) => ({
    payment: await ctx.data.issueRefund({
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      reason: input.reason,
      actorId: ctx.principal.id,
    }),
  }),
});
