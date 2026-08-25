import { defineRead, defineWrite } from "@platform/kernel";
import { z } from "zod";

export const listFlags = defineRead({
  name: "flags.list",
  summary: "All feature flags and their rollout state",
  input: z.object({}),
  policy: { scope: "flags:read", maxRows: 200 },
  handler: async (_input, ctx) => ctx.data.listFlags(),
});

export const setFlag = defineWrite({
  name: "flags.set",
  summary: "Enable, disable or re-target a feature flag",
  input: z.object({
    key: z.string().min(1),
    enabled: z.boolean(),
    rolloutPct: z.number().int().min(0).max(100),
  }),
  policy: {
    scope: "flags:write",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 30 },
    approval: { mode: "never" },
    approverScope: "approvals:decide",
  },
  handler: async (input, ctx) =>
    ctx.data.setFlag({ ...input, updatedBy: ctx.principal.id }),
});
