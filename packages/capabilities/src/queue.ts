import { defineRead, defineWrite } from "@platform/kernel";
import { z } from "zod";

export const listOpenReviews = defineRead({
  name: "queue.listOpen",
  summary: "Open items in the customer review queue",
  input: z.object({ limit: z.number().int().positive().default(25) }),
  policy: { scope: "queue:read", maxRows: 100 },
  handler: async (input, ctx) => ctx.data.listReviewQueue("open", input.limit),
});

export const resolveReview = defineWrite({
  name: "queue.resolve",
  summary: "Mark a review queue item as resolved",
  input: z.object({ id: z.string().min(1), note: z.string().max(280).optional() }),
  policy: {
    scope: "queue:write",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 200 },
    approval: { mode: "never" },
    approverScope: "approvals:decide",
  },
  handler: async (input, ctx) => {
    const item = await ctx.data.resolveReviewItem(input.id);
    if (!item) throw new Error(`unknown review item: ${input.id}`);
    return item;
  },
});
