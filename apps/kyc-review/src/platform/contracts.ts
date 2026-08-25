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
 * What the runtime says it would demand of a decision on this case, returned by
 * `kyc.cases.get`. The app never derives this itself: a second copy of the rule in the UI
 * would be free to disagree with the one being enforced.
 */
export interface ApprovalRequirement {
  approverScope: string;
  reason: string;
}

/**
 * A platform approval, rendered with the case it concerns. Everything here is the platform's
 * own shape — the app only knows that `input.caseId` is a KYC case.
 */
export interface KycApproval extends ApprovalSummary {
  input: { caseId?: string };
}

/** The case an approval concerns, or null if it was raised by something that is not case-shaped. */
export function approvalCaseId(approval: KycApproval): string | null {
  return typeof approval.input.caseId === 'string' ? approval.input.caseId : null;
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
    output: { case: CaseDetail; decisionApproval: ApprovalRequirement | null };
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
 * The registry, as the platform serves it. The app holds no copy of the policy: it asks
 * `platform.capabilities()` and renders what comes back, so what a reviewer reads on screen is
 * the declaration the runtime is enforcing rather than a second version of it that can drift.
 */
export type KycCapabilityDescriptor = CapabilityDescriptor & { name: CapabilityName };

export type CapabilityRegistry = Partial<Record<CapabilityName, KycCapabilityDescriptor>>;

/** The capability names this app calls. The policy behind each one is the platform's to state. */
export const CAPABILITY_NAMES: CapabilityName[] = [
  'kyc.cases.list',
  'kyc.cases.get',
  'kyc.case.pii.reveal',
  'kyc.case.claim',
  'kyc.case.requestInfo',
  'kyc.case.escalate',
  'kyc.case.approve',
  'kyc.case.reject',
  'kyc.case.sar.file',
];

const isCapabilityName = (name: string): name is CapabilityName =>
  (CAPABILITY_NAMES as string[]).includes(name);

/** Index the served registry by name, ignoring capabilities this app does not call. */
export function toRegistry(descriptors: CapabilityDescriptor[]): CapabilityRegistry {
  const registry: CapabilityRegistry = {};
  for (const descriptor of descriptors) {
    if (isCapabilityName(descriptor.name)) {
      registry[descriptor.name] = { ...descriptor, name: descriptor.name };
    }
  }
  return registry;
}

const numberField = (policy: Record<string, unknown>, key: string): number | null => {
  const value = policy[key];
  return typeof value === 'number' ? value : null;
};

const stringField = (policy: Record<string, unknown>, key: string): string | null => {
  const value = policy[key];
  return typeof value === 'string' ? value : null;
};

/** The scope the runtime will demand for this capability, read off the served declaration. */
export function scopeOf(descriptor: KycCapabilityDescriptor): string {
  return stringField(descriptor.policy, 'scope') ?? 'unknown';
}

/** One line of the declared policy, for display next to the button it governs. */
export function describePolicy(descriptor: KycCapabilityDescriptor): string {
  const policy = descriptor.policy;
  const scope = scopeOf(descriptor);
  if (descriptor.kind === 'read') {
    return `${scope} · read · ≤${numberField(policy, 'maxRows') ?? '?'} rows`;
  }
  const limits = policy.limits;
  const perHour =
    limits && typeof limits === 'object' ? numberField(limits as Record<string, unknown>, 'maxPerHour') : null;
  const approval = policy.approval;
  const mode =
    approval && typeof approval === 'object'
      ? (stringField(approval as Record<string, unknown>, 'mode') ?? 'never')
      : 'never';
  const approvalText =
    mode === 'derived_from_subject' ? 'approval: depends on the case' : `approval: ${mode}`;
  return `${scope} · write · ${perHour ?? '?'}/hour · ${approvalText}`;
}

export const REJECT_REASONS: { code: RejectReasonCode; label: string }[] = [
  { code: 'document_forgery', label: 'Document appears forged' },
  { code: 'identity_mismatch', label: 'Identity does not match documents' },
  { code: 'sanctions_confirmed', label: 'Confirmed sanctions match' },
  { code: 'unverifiable_source_of_funds', label: 'Source of funds unverifiable' },
  { code: 'applicant_unresponsive', label: 'Applicant unresponsive' },
];
