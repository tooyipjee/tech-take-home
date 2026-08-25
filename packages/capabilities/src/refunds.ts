import { randomUUID } from "node:crypto";
import { defineRead, defineWrite } from "@platform/kernel";
import { z } from "zod";

export const listRefundablePayments = defineRead({
  name: "refunds.listRefundable",
  summary: "Settled payments with refundable balance remaining",
  input: z.object({ limit: z.number().int().positive().default(25) }),
  policy: { scope: "refunds:read", maxRows: 100 },
  handler: async (input, ctx) => {
    const payments = await ctx.data.listPayments(input.limit);
    return payments
      .filter((payment) => payment.refundedCents < payment.amountCents)
      .map((payment) => ({
        ...payment,
        refundableCents: payment.amountCents - payment.refundedCents,
      }));
  },
});

export const issueRefund = defineWrite({
  name: "refunds.issue",
  summary: "Refund part or all of a settled payment",
  input: z.object({
    paymentId: z.string().min(1),
    amountCents: z.number().int().positive(),
    reason: z.string().min(3).max(280),
  }),
  policy: {
    scope: "refunds:write",
    idempotent: true,
    limits: { maxAmountCents: 200_000, maxPerHour: 10 },
    approval: { mode: "above_amount", amountCents: 50_000 },
    approverScope: "approvals:decide",
    amountField: "amountCents",
  },
  handler: async (input, ctx) => {
    const payment = await ctx.data.getPayment(input.paymentId);
    if (!payment) throw new Error(`unknown payment: ${input.paymentId}`);

    const refundable = payment.amountCents - payment.refundedCents;
    if (input.amountCents > refundable) {
      throw new Error(`refundable balance is ${refundable}, requested ${input.amountCents}`);
    }

    return ctx.data.insertRefund({
      id: `re_${randomUUID().slice(0, 8)}`,
      paymentId: input.paymentId,
      amountCents: input.amountCents,
      reason: input.reason,
      issuedBy: ctx.principal.id,
    });
  },
});
