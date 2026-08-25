import { defineRead, defineWrite, previewApproval } from "@rangka/kernel";
import type { ApprovalRule } from "@rangka/kernel";
import { z } from "zod";

/**
 * The KYC review queue's capabilities: the entire surface the app is allowed to reach.
 *
 * Read the policy blocks rather than the handlers. The handler describes what happens;
 * the policy is what the platform enforces around it, and it is the artefact a reviewer
 * actually has to be right about — scope, per-hour ceiling, who must countersign, and
 * where the effect lands so an invariant can be derived from it afterwards.
 */

const caseId = z.string().min(1);

/**
 * When a second person is required, expressed as SQL over the case row (`s`).
 *
 * Order matters: the first matching clause wins, so sanctions exposure outranks plain
 * high risk. The runtime asks this before the write and the derived invariant asks the
 * same question of committed rows, so "should have been approved" and "was approved"
 * are answered from one declaration.
 */
const DECISION_APPROVAL: ApprovalRule = {
  mode: "derived_from_subject",
  clauses: [
    {
      when: `exists (select 1 from kyc_screening_hits h
                      where h.case_id = s.id and h.resolution = 'unresolved'
                        and h.list in ('OFAC_SDN', 'EU_CONSOLIDATED', 'UK_HMT'))`,
      approverScope: "kyc:sar",
      because:
        "Unresolved sanctions exposure: a holder of kyc:sar must approve before this takes effect.",
    },
    {
      when: `s.risk_band = 'high'
             or exists (select 1 from kyc_screening_hits h
                         where h.case_id = s.id and h.resolution = 'unresolved')`,
      approverScope: "kyc:decide",
      because:
        "High risk or an unresolved screening hit: a second holder of kyc:decide must approve.",
    },
  ],
};

const CASE_SUBJECT = { table: "kyc_cases", idField: "caseId" } as const;

export const listCases = defineRead({
  name: "kyc.cases.list",
  summary: "List queue cases with masked identifiers.",
  input: z.object({
    status: z
      .enum([
        "all",
        "pending_review",
        "info_requested",
        "escalated",
        "awaiting_approval",
        "approved",
        "rejected",
      ])
      .optional(),
    riskBand: z.enum(["all", "low", "medium", "high"]).optional(),
    assignment: z.enum(["all", "mine", "unassigned"]).optional(),
    query: z.string().optional(),
    limit: z.number().int().positive().optional(),
  }),
  policy: { scope: "kyc:read", maxRows: 100 },
  handler: async (input, ctx) => ({
    cases: await ctx.data.listCases({
      ...input,
      actorId: ctx.principal.id,
      limit: input.limit ?? 100,
    }),
  }),
});

export const getCase = defineRead({
  name: "kyc.cases.get",
  summary: "Read one case, its documents, screening hits and timeline.",
  input: z.object({ caseId }),
  policy: { scope: "kyc:read", maxRows: 1 },
  // `decisionApproval` is the runtime answering "what would you demand of a decision on
  // this case?", so the app can warn the reviewer before they act without holding its own
  // copy of the rule — a copy that would be free to disagree with the one enforced.
  handler: async (input, ctx) => ({
    case: await ctx.data.getCase(input.caseId),
    decisionApproval: await previewApproval("kyc.case.approve", { caseId: input.caseId }),
  }),
});

/**
 * A disclosure is a write, not a read. Nothing about it changes the case, but the
 * platform only meters and rate-limits writes, and looking at someone's national id is
 * exactly the act that has to be metered, justified and countable per reviewer.
 */
export const revealPii = defineWrite({
  name: "kyc.case.pii.reveal",
  summary: "Unmask applicant identifiers. Requires a justification and is audited on its own.",
  input: z.object({
    caseId,
    justification: z.string().trim().min(10, "must contain at least 10 characters"),
  }),
  policy: {
    scope: "kyc:pii",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 20 },
    approval: { mode: "never" },
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_pii_disclosures", subjectColumn: "case_id" },
  },
  handler: async (input, ctx) => {
    const revealed = await ctx.data.revealIdentity({
      caseId: input.caseId,
      justification: input.justification,
      actorId: ctx.principal.id,
    });
    if (!revealed) throw new Error(`unknown case: ${input.caseId}`);
    return {
      identity: revealed.identity,
      revealsRemaining: Math.max(0, 20 - revealed.revealsInLastHour),
    };
  },
});

export const claimCase = defineWrite({
  name: "kyc.case.claim",
  summary: "Take ownership of a case so two reviewers cannot work it at once.",
  input: z.object({ caseId, revision: z.number().int().positive() }),
  policy: {
    scope: "kyc:review",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 120 },
    approval: { mode: "never" },
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_case_events", subjectColumn: "case_id" },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.claimCase({ ...input, actorId: ctx.principal.id }),
  }),
});

export const requestInfo = defineWrite({
  name: "kyc.case.requestInfo",
  summary: "Ask the applicant for additional documents or clarification.",
  input: z.object({
    caseId,
    revision: z.number().int().positive(),
    items: z.array(z.string().min(1)).min(1, "select at least one item to request"),
    note: z.string().trim(),
  }),
  policy: {
    scope: "kyc:review",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 60 },
    approval: { mode: "never" },
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_case_events", subjectColumn: "case_id" },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.requestInfo({ ...input, actorId: ctx.principal.id }),
  }),
});

export const escalateCase = defineWrite({
  name: "kyc.case.escalate",
  summary: "Move the case to the enhanced due diligence queue.",
  input: z.object({
    caseId,
    revision: z.number().int().positive(),
    note: z.string().trim().min(1),
  }),
  policy: {
    scope: "kyc:review",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 20 },
    approval: { mode: "never" },
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_case_events", subjectColumn: "case_id" },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.escalateCase({ ...input, actorId: ctx.principal.id }),
  }),
});

export const approveCase = defineWrite({
  name: "kyc.case.approve",
  summary: "Onboard the applicant.",
  input: z.object({
    caseId,
    revision: z.number().int().positive(),
    note: z.string().trim().min(20, "a decision rationale must contain at least 20 characters"),
  }),
  policy: {
    scope: "kyc:decide",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 50 },
    approval: DECISION_APPROVAL,
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_case_decisions", subjectColumn: "case_id", oncePerSubject: true },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.decideCase({
      ...input,
      decision: "approved",
      reasonCode: null,
      actorId: ctx.principal.id,
      enforceRevision: ctx.approvalId === null,
    }),
  }),
});

export const rejectCase = defineWrite({
  name: "kyc.case.reject",
  summary: "Decline the applicant with a reason code.",
  input: z.object({
    caseId,
    revision: z.number().int().positive(),
    reasonCode: z.enum([
      "document_forgery",
      "identity_mismatch",
      "sanctions_confirmed",
      "unverifiable_source_of_funds",
      "applicant_unresponsive",
    ]),
    note: z.string().trim().min(20, "a decision rationale must contain at least 20 characters"),
  }),
  policy: {
    scope: "kyc:decide",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 50 },
    approval: DECISION_APPROVAL,
    approverScope: "kyc:decide",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_case_decisions", subjectColumn: "case_id", oncePerSubject: true },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.decideCase({
      ...input,
      decision: "rejected",
      actorId: ctx.principal.id,
      enforceRevision: ctx.approvalId === null,
    }),
  }),
});

/**
 * Filing is irreversible and visible to a regulator, so it is the one capability that
 * always waits for a second holder of `kyc:sar` — never derived, never skippable.
 */
export const fileSar = defineWrite({
  name: "kyc.case.sar.file",
  summary: "File a suspicious activity report. Irreversible.",
  input: z.object({
    caseId,
    revision: z.number().int().positive(),
    narrative: z.string().trim().min(40, "a SAR narrative must contain at least 40 characters"),
  }),
  policy: {
    scope: "kyc:sar",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 5 },
    approval: { mode: "always" },
    approverScope: "kyc:sar",
    subject: CASE_SUBJECT,
    effect: { table: "kyc_sars", subjectColumn: "case_id", oncePerSubject: true },
  },
  handler: async (input, ctx) => ({
    case: await ctx.data.fileSar({
      ...input,
      actorId: ctx.principal.id,
      enforceRevision: ctx.approvalId === null,
    }),
  }),
});
