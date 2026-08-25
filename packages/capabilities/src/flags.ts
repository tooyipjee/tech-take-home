import { defineRead, defineWrite, previewApproval } from "@rangka/kernel";
import type { ApprovalRule } from "@rangka/kernel";
import { z } from "zod";

/**
 * Feature flags: the two verbs a flag administrator gets, and nothing else.
 *
 * There is no capability that creates a flag, deletes one, or marks one protected.
 * Which switches exist, and which of them gate money, is a decision made by a
 * reviewed change to the platform — not something the flag screen can do on a
 * Tuesday afternoon. The only verb is "move this switch", and what that costs in
 * signatures is a property of the switch.
 */

/**
 * Protection is a property of the flag row, so the requirement is asked of the row.
 *
 * The runtime asks it before holding the call and the derived invariant asks the same
 * clause of committed rows, so "needed a second administrator" and "had one" are
 * answered from one declaration. Ordinary flags match no clause and flip immediately.
 */
const PROTECTED_FLAG_APPROVAL: ApprovalRule = {
  mode: "derived_from_subject",
  clauses: [
    {
      when: "s.protected = true",
      approverScope: "flags:write",
      because:
        "This flag gates payments, limits or a customer-facing money flow: a second administrator must sign off before it takes effect.",
    },
  ],
};

const FLAG_SUBJECT = { table: "feature_flags", idField: "flagId" } as const;

export const listFlags = defineRead({
  name: "flags.list",
  summary: "List product feature flags with their state and recent changes.",
  input: z.object({
    limit: z.number().int().positive().optional(),
    changesPerFlag: z.number().int().positive().max(20).optional(),
  }),
  policy: { scope: "flags:read", maxRows: 200 },
  // `flipApproval` is the runtime answering "what would you demand of a flip of this
  // flag?", per flag, so the screen can mark the ones that need a countersignature
  // without keeping its own copy of the rule — a copy free to disagree with the one
  // enforced.
  handler: async (input, ctx) => {
    const flags = await ctx.data.listFeatureFlags({
      limit: input.limit ?? 200,
      changesPerFlag: input.changesPerFlag ?? 5,
    });
    return {
      flags: await Promise.all(
        flags.map(async (flag) => ({
          ...flag,
          flipApproval: await previewApproval("flags.flip", { flagId: flag.id }),
        })),
      ),
    };
  },
});

export const flipFlag = defineWrite({
  name: "flags.flip",
  summary: "Turn a product feature on or off.",
  input: z.object({
    flagId: z.string().min(1),
    revision: z.number().int().positive(),
    enabled: z.boolean(),
    note: z.string().trim().max(280).optional(),
  }),
  policy: {
    scope: "flags:write",
    idempotent: true,
    // No amount: flipping a switch moves no money, even when the feature behind it
    // does. The per-hour ceiling is the whole limit here, and it is per administrator.
    limits: { maxAmountCents: null, maxPerHour: 30 },
    approval: PROTECTED_FLAG_APPROVAL,
    approverScope: "flags:write",
    subject: FLAG_SUBJECT,
    // The change row is the account of how the flag got to its current state, which is
    // what `tracksState` declares: the flag is a projection of its recorded flips.
    effect: {
      table: "feature_flag_changes",
      subjectColumn: "flag_id",
      tracksState: { column: "enabled", fromColumn: "from_enabled", toColumn: "to_enabled" },
    },
  },
  handler: async (input, ctx) => ({
    flag: await ctx.data.flipFeatureFlag({
      flagId: input.flagId,
      revision: input.revision,
      enabled: input.enabled,
      note: input.note ?? "",
      actorId: ctx.principal.id,
      // On the replay that follows a countersignature the revision was already checked
      // when the request was raised, so it is not checked against the row again.
      enforceRevision: ctx.approvalId === null,
    }),
  }),
});
