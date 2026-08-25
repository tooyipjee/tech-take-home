/**
 * Capability contracts the KYC review queue is allowed to call.
 *
 * These mirror the Zod schemas registered in the platform capability registry. Identity, outcomes,
 * approvals and audit come from `@platform/sdk` — the only platform surface an app may import — so
 * this file describes what is KYC-specific and nothing else.
 */
import type { ApprovalSummary, CapabilityDescriptor, PlatformUser } from '@platform/sdk';

/** Identity is the platform's, not the app's: role → scopes is resolved by the kernel. */
export type Actor = PlatformUser;
export type Role = PlatformUser['role'];

export type Scope = 'kyc:read' | 'kyc:pii' | 'kyc:review' | 'kyc:decide' | 'kyc:sar';

/** What each platform role means in this app's language. */
export const ROLE_LABEL: Record<Role, string> = {
  agent: 'KYC reviewer',
  supervisor: 'KYC lead',
  admin: 'Compliance officer',
};

export type CaseStatus =
  | 'pending_review'
  | 'info_requested'
  | 'escalated'
  | 'approved'
  | 'rejected'
  | 'awaiting_approval';

export type RiskBand = 'low' | 'medium' | 'high';

/**
 * Who has to sign off, expressed the way the kernel expresses it — a scope the approver must hold,
 * never a role and never the requester themselves.
 */
export type ApproverScope = Extract<Scope, 'kyc:decide' | 'kyc:sar'>;

export type RejectReasonCode =
  | 'document_forgery'
  | 'identity_mismatch'
  | 'sanctions_confirmed'
  | 'unverifiable_source_of_funds'
  | 'applicant_unresponsive';

export interface MaskedIdentity {
  fullName: string;
  email: string;
  dateOfBirth: string;
  nationalId: string;
  address: string;
  masked: boolean;
}

export interface ScreeningHit {
  id: string;
  provider: string;
  list: 'OFAC_SDN' | 'EU_CONSOLIDATED' | 'UK_HMT' | 'PEP' | 'ADVERSE_MEDIA';
  matchedName: string;
  matchStrength: number;
  resolution: 'unresolved' | 'false_positive' | 'confirmed';
}

export interface CaseDocument {
  id: string;
  type: 'passport' | 'drivers_license' | 'proof_of_address' | 'source_of_funds';
  uploadedAt: string;
  verification: 'passed' | 'failed' | 'manual_review';
  note?: string;
}

export interface RiskSignal {
  label: string;
  points: number;
  detail: string;
}

export interface CaseEvent {
  id: string;
  at: string;
  actor: string;
  summary: string;
  capability?: CapabilityName;
  auditId?: string;
}

export interface CaseSummary {
  id: string;
  reference: string;
  applicantName: string;
  country: string;
  status: CaseStatus;
  riskBand: RiskBand;
  riskScore: number;
  submittedAt: string;
  slaDueAt: string;
  assignedTo: string | null;
  unresolvedHits: number;
  revision: number;
}

export interface CaseDetail extends CaseSummary {
  identity: MaskedIdentity;
  documents: CaseDocument[];
  screeningHits: ScreeningHit[];
  riskSignals: RiskSignal[];
  timeline: CaseEvent[];
  productTier: string;
  expectedMonthlyVolumeUsd: number;
}

/**
 * A platform approval with the case context this app needs to render it. The platform fields
 * (`requestedBy`, `status`, `createdAt`) keep the names the SDK uses so the same inbox works
 * against `platform.approvals()`.
 */
export interface KycApproval extends ApprovalSummary {
  approverScope: ApproverScope;
  caseId: string;
  caseReference: string;
  applicantName: string;
  summary: string;
}

export interface CapabilityMap {
  'kyc.cases.list': {
    input: {
      status?: CaseStatus | 'all';
      riskBand?: RiskBand | 'all';
      assignment?: 'all' | 'mine' | 'unassigned';
      query?: string;
    };
    output: { cases: CaseSummary[] };
  };
  'kyc.cases.get': {
    input: { caseId: string };
    output: { case: CaseDetail };
  };
  'kyc.case.pii.reveal': {
    input: { caseId: string; justification: string };
    output: { identity: MaskedIdentity; revealsRemaining: number };
  };
  'kyc.case.claim': {
    input: { caseId: string; revision: number };
    output: { case: CaseDetail };
  };
  'kyc.case.requestInfo': {
    input: { caseId: string; revision: number; items: string[]; note: string };
    output: { case: CaseDetail };
  };
  'kyc.case.escalate': {
    input: { caseId: string; revision: number; note: string };
    output: { case: CaseDetail };
  };
  'kyc.case.approve': {
    input: { caseId: string; revision: number; note: string };
    output: { case: CaseDetail };
  };
  'kyc.case.reject': {
    input: { caseId: string; revision: number; reasonCode: RejectReasonCode; note: string };
    output: { case: CaseDetail };
  };
  'kyc.case.sar.file': {
    input: { caseId: string; revision: number; narrative: string };
    output: { case: CaseDetail };
  };
}

export type CapabilityName = keyof CapabilityMap;

export type CapabilityInput<N extends CapabilityName> = CapabilityMap[N]['input'];
export type CapabilityOutput<N extends CapabilityName> = CapabilityMap[N]['output'];

/**
 * The registry entries these capabilities are declared with, in the kernel's own policy shape:
 * reads carry a row ceiling, writes carry an idempotency requirement, a per-hour ceiling, an
 * approval rule and the scope an approver must hold. `platform.capabilities()` returns exactly
 * this for the deployed registry; the app renders it so a reviewer sees the rule, not just a button.
 */
export type KycReadPolicy = {
  scope: Scope;
  maxRows: number;
};

export type KycWritePolicy = {
  scope: Scope;
  idempotent: true;
  limits: { maxAmountCents: null; maxPerHour: number };
  approval: { mode: 'never' } | { mode: 'always' };
  approverScope: string;
  /**
   * KYC's approval requirement depends on the case, not on the input: an unresolved sanctions hit
   * needs a compliance officer, high risk needs a lead, a clean low-risk case needs nobody. The
   * kernel's ApprovalRule cannot express that yet, so this describes what the KYC runtime derives
   * on top of `approval.mode`. Closing that gap is the one framework change this app still needs.
   */
  derivedApproval?: string;
};

export interface KycCapabilityDescriptor extends CapabilityDescriptor {
  name: CapabilityName;
  policy: KycReadPolicy | KycWritePolicy;
}

export const CAPABILITY_DESCRIPTORS: Record<CapabilityName, KycCapabilityDescriptor> = {
  'kyc.cases.list': {
    name: 'kyc.cases.list',
    kind: 'read',
    summary: 'List queue cases with masked identifiers.',
    policy: { scope: 'kyc:read', maxRows: 100 },
  },
  'kyc.cases.get': {
    name: 'kyc.cases.get',
    kind: 'read',
    summary: 'Read one case, its documents, screening hits and timeline.',
    policy: { scope: 'kyc:read', maxRows: 1 },
  },
  'kyc.case.pii.reveal': {
    name: 'kyc.case.pii.reveal',
    kind: 'write',
    summary: 'Unmask applicant identifiers. Requires a justification and is audited on its own.',
    // A disclosure is an effect: it is a write so that the runtime rate-limits and records it,
    // because the kernel only meters writes.
    policy: {
      scope: 'kyc:pii',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 20 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
    },
  },
  'kyc.case.claim': {
    name: 'kyc.case.claim',
    kind: 'write',
    summary: 'Take ownership of a case so two reviewers cannot work it at once.',
    policy: {
      scope: 'kyc:review',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 120 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
    },
  },
  'kyc.case.requestInfo': {
    name: 'kyc.case.requestInfo',
    kind: 'write',
    summary: 'Ask the applicant for additional documents or clarification.',
    policy: {
      scope: 'kyc:review',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 60 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
    },
  },
  'kyc.case.escalate': {
    name: 'kyc.case.escalate',
    kind: 'write',
    summary: 'Move the case to the enhanced due diligence queue.',
    policy: {
      scope: 'kyc:review',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 20 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
    },
  },
  'kyc.case.approve': {
    name: 'kyc.case.approve',
    kind: 'write',
    summary: 'Onboard the applicant.',
    policy: {
      scope: 'kyc:decide',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 50 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
      derivedApproval:
        'kyc:sar when an unresolved sanctions hit is present, kyc:decide when the case is high risk or has any unresolved hit',
    },
  },
  'kyc.case.reject': {
    name: 'kyc.case.reject',
    kind: 'write',
    summary: 'Decline the applicant with a reason code.',
    policy: {
      scope: 'kyc:decide',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 50 },
      approval: { mode: 'never' },
      approverScope: 'kyc:decide',
      derivedApproval:
        'kyc:sar when an unresolved sanctions hit is present, kyc:decide when the case is high risk or has any unresolved hit',
    },
  },
  'kyc.case.sar.file': {
    name: 'kyc.case.sar.file',
    kind: 'write',
    summary: 'File a suspicious activity report. Irreversible.',
    policy: {
      scope: 'kyc:sar',
      idempotent: true,
      limits: { maxAmountCents: null, maxPerHour: 5 },
      approval: { mode: 'always' },
      approverScope: 'kyc:sar',
    },
  },
};

export const REJECT_REASONS: { code: RejectReasonCode; label: string }[] = [
  { code: 'document_forgery', label: 'Document appears forged' },
  { code: 'identity_mismatch', label: 'Identity does not match documents' },
  { code: 'sanctions_confirmed', label: 'Confirmed sanctions match' },
  { code: 'unverifiable_source_of_funds', label: 'Source of funds unverifiable' },
  { code: 'applicant_unresponsive', label: 'Applicant unresponsive' },
];
