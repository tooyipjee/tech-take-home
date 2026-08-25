/**
 * Capability contracts the KYC review queue is allowed to call.
 *
 * These mirror the Zod schemas registered in the platform capability registry. The app depends on
 * this file and never on a database, a vendor SDK, or an HTTP route directly.
 */

export type Role = 'kyc_reviewer' | 'kyc_lead' | 'compliance_officer';

export type Scope = 'kyc:read' | 'kyc:pii' | 'kyc:review' | 'kyc:decide' | 'kyc:sar';

export type CaseStatus =
  | 'pending_review'
  | 'info_requested'
  | 'escalated'
  | 'approved'
  | 'rejected'
  | 'awaiting_approval';

export type RiskBand = 'low' | 'medium' | 'high';

export type ApprovalTier = 'none' | 'dual_lead' | 'dual_compliance';

export type RejectReasonCode =
  | 'document_forgery'
  | 'identity_mismatch'
  | 'sanctions_confirmed'
  | 'unverifiable_source_of_funds'
  | 'applicant_unresponsive';

export interface Actor {
  userId: string;
  displayName: string;
  role: Role;
  scopes: Scope[];
}

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

export interface ApprovalRequest {
  id: string;
  capability: CapabilityName;
  caseId: string;
  caseReference: string;
  applicantName: string;
  requestedBy: string;
  requestedById: string;
  requestedAt: string;
  tier: Exclude<ApprovalTier, 'none'>;
  reason: string;
  summary: string;
  status: 'pending' | 'approved' | 'denied';
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actor: string;
  role: Role;
  capability: CapabilityName;
  outcome: 'executed' | 'pending_approval' | 'denied';
  severity: 'info' | 'notice' | 'high';
  policy: string;
  target: string;
  detail: string;
}

/** Policy metadata the runtime enforces; surfaced in the UI so reviewers see the rules, not just buttons. */
export interface CapabilityPolicy {
  scope: Scope;
  effect: 'read' | 'write';
  approval: 'none' | 'tiered' | 'always_dual';
  limit: string;
  idempotency: string | null;
  description: string;
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
  'kyc.approvals.list': {
    input: Record<string, never>;
    output: { requests: ApprovalRequest[] };
  };
  'kyc.approvals.decide': {
    input: { requestId: string; decision: 'approve' | 'deny'; note: string };
    output: { request: ApprovalRequest };
  };
  'kyc.audit.list': {
    input: { limit?: number };
    output: { entries: AuditEntry[] };
  };
}

export type CapabilityName = keyof CapabilityMap;

export type CapabilityInput<N extends CapabilityName> = CapabilityMap[N]['input'];
export type CapabilityOutput<N extends CapabilityName> = CapabilityMap[N]['output'];

export const CAPABILITY_POLICIES: Record<CapabilityName, CapabilityPolicy> = {
  'kyc.cases.list': {
    scope: 'kyc:read',
    effect: 'read',
    approval: 'none',
    limit: '120/min/user',
    idempotency: null,
    description: 'List queue cases with masked identifiers.',
  },
  'kyc.cases.get': {
    scope: 'kyc:read',
    effect: 'read',
    approval: 'none',
    limit: '300/min/user',
    idempotency: null,
    description: 'Read one case, its documents, screening hits and timeline.',
  },
  'kyc.case.pii.reveal': {
    scope: 'kyc:pii',
    effect: 'read',
    approval: 'none',
    limit: '20/hour/user',
    idempotency: null,
    description: 'Unmask applicant identifiers. Requires justification, audited at high severity.',
  },
  'kyc.case.claim': {
    scope: 'kyc:review',
    effect: 'write',
    approval: 'none',
    limit: '1 open claim per case',
    idempotency: 'caseId + userId',
    description: 'Take ownership of a case so two reviewers cannot work it at once.',
  },
  'kyc.case.requestInfo': {
    scope: 'kyc:review',
    effect: 'write',
    approval: 'none',
    limit: '3 per case',
    idempotency: 'caseId + revision',
    description: 'Ask the applicant for additional documents or clarification.',
  },
  'kyc.case.escalate': {
    scope: 'kyc:review',
    effect: 'write',
    approval: 'none',
    limit: '20/day/user',
    idempotency: 'caseId + revision',
    description: 'Move the case to the enhanced due diligence queue.',
  },
  'kyc.case.approve': {
    scope: 'kyc:decide',
    effect: 'write',
    approval: 'tiered',
    limit: '50/day/user',
    idempotency: 'caseId + revision',
    description: 'Onboard the applicant. High risk or unresolved hits require a second human.',
  },
  'kyc.case.reject': {
    scope: 'kyc:decide',
    effect: 'write',
    approval: 'tiered',
    limit: '50/day/user',
    idempotency: 'caseId + revision',
    description: 'Decline the applicant with a reason code. High risk requires a second human.',
  },
  'kyc.case.sar.file': {
    scope: 'kyc:sar',
    effect: 'write',
    approval: 'always_dual',
    limit: '5/day/org',
    idempotency: 'caseId',
    description: 'File a suspicious activity report. Irreversible; compliance officer approval always required.',
  },
  'kyc.approvals.list': {
    scope: 'kyc:read',
    effect: 'read',
    approval: 'none',
    limit: '120/min/user',
    idempotency: null,
    description: 'List requests awaiting a second human.',
  },
  'kyc.approvals.decide': {
    scope: 'kyc:decide',
    effect: 'write',
    approval: 'none',
    limit: '100/day/user',
    idempotency: 'requestId',
    description: 'Approve or deny a pending request. Requesters may never approve their own.',
  },
  'kyc.audit.list': {
    scope: 'kyc:read',
    effect: 'read',
    approval: 'none',
    limit: '60/min/user',
    idempotency: null,
    description: 'Read the audit trail of capability invocations.',
  },
};

export const ROLE_SCOPES: Record<Role, Scope[]> = {
  kyc_reviewer: ['kyc:read', 'kyc:pii', 'kyc:review'],
  kyc_lead: ['kyc:read', 'kyc:pii', 'kyc:review', 'kyc:decide'],
  compliance_officer: ['kyc:read', 'kyc:pii', 'kyc:review', 'kyc:decide', 'kyc:sar'],
};

export const REJECT_REASONS: { code: RejectReasonCode; label: string }[] = [
  { code: 'document_forgery', label: 'Document appears forged' },
  { code: 'identity_mismatch', label: 'Identity does not match documents' },
  { code: 'sanctions_confirmed', label: 'Confirmed sanctions match' },
  { code: 'unverifiable_source_of_funds', label: 'Source of funds unverifiable' },
  { code: 'applicant_unresponsive', label: 'Applicant unresponsive' },
];
