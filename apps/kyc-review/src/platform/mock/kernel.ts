import type {
  Actor,
  ApprovalRequest,
  ApprovalTier,
  AuditEntry,
  CapabilityInput,
  CapabilityName,
  CaseDetail,
  CaseEvent,
} from '../contracts';
import { CAPABILITY_POLICIES } from '../contracts';
import type { CapabilityClient, CapabilityResult, DenialCode, InvokeOptions } from '../client';
import { buildCases, unmaskedIdentity } from './fixtures';

/**
 * An in-browser implementation of the platform kernel's middleware chain:
 * authz → limits → idempotency → approval → execute → audit.
 *
 * It exists so the app can run and be demoed before the API host is up, and so policy behaviour is
 * exercised without Postgres. The HTTP adapter is the production path; both satisfy CapabilityClient,
 * and any divergence between them is a bug in this file.
 */

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString().padStart(4, '0')}`;

interface Denial {
  code: DenialCode;
  message: string;
  policy: string;
}

class DenialError extends Error {
  constructor(readonly denial: Denial) {
    super(denial.message);
  }
}

const deny = (code: DenialCode, policy: string, message: string): never => {
  throw new DenialError({ code, policy, message });
};

/** Approval tier is derived from the case, so a reviewer cannot pick a cheaper path. */
export function resolveTier(capability: CapabilityName, target: CaseDetail): ApprovalTier {
  if (capability === 'kyc.case.sar.file') return 'dual_compliance';
  if (capability !== 'kyc.case.approve' && capability !== 'kyc.case.reject') return 'none';
  const sanctions = target.screeningHits.some(
    (hit) => hit.resolution === 'unresolved' && ['OFAC_SDN', 'EU_CONSOLIDATED', 'UK_HMT'].includes(hit.list),
  );
  if (sanctions) return 'dual_compliance';
  if (target.riskBand === 'high' || target.unresolvedHits > 0) return 'dual_lead';
  return 'none';
}

/** Why the runtime will hold this call, phrased from the case rather than from the button. */
export function approvalReason(capability: CapabilityName, target: CaseDetail): string | null {
  const tier = resolveTier(capability, target);
  if (tier === 'none') return null;
  if (capability === 'kyc.case.sar.file') {
    return 'Filing a SAR is irreversible: a compliance officer other than you must always approve it.';
  }
  if (tier === 'dual_compliance') {
    return 'Unresolved sanctions exposure: a compliance officer must approve before this takes effect.';
  }
  return target.riskBand === 'high'
    ? 'High-risk case: a second reviewer holding kyc_lead must approve before this takes effect.'
    : 'Unresolved screening hit: a second reviewer holding kyc_lead must approve before this takes effect.';
}

const RATE_WINDOW_MS = 3_600_000;

export class MockKernel implements CapabilityClient {
  readonly kind = 'mock';
  private actor: Actor;
  private cases: CaseDetail[] = buildCases();
  private approvals: ApprovalRequest[] = [];
  private audit: AuditEntry[] = [];
  private invocations: { capability: CapabilityName; userId: string; at: number }[] = [];
  private idempotency = new Map<string, unknown>();
  private listeners = new Set<() => void>();

  constructor(actor: Actor) {
    this.actor = actor;
  }

  setActor(actor: Actor): void {
    this.actor = actor;
    this.emit();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    this.listeners.forEach((listener) => listener());
  }

  async invoke<N extends CapabilityName>(
    capability: N,
    input: CapabilityInput<N>,
    options?: InvokeOptions,
  ): Promise<CapabilityResult<N>> {
    const policy = CAPABILITY_POLICIES[capability];
    try {
      // 1. authz
      if (!this.actor.scopes.includes(policy.scope)) {
        deny(
          'forbidden_scope',
          `scope ${policy.scope}`,
          `${this.actor.role} does not hold ${policy.scope}; ${capability} refused before execution.`,
        );
      }

      // 2. limits
      this.enforceLimit(capability);

      // 3. idempotency
      const key = options?.idempotencyKey;
      if (key && this.idempotency.has(key)) {
        const cached = this.idempotency.get(key) as CapabilityResult<N>;
        this.record(capability, 'executed', 'info', 'idempotent replay', this.targetOf(input), 'Replayed cached result.');
        return cached;
      }

      // 4. approval + 5. execute
      const result = this.execute(capability, input);

      if (key) this.idempotency.set(key, result);
      this.emit();
      return result as CapabilityResult<N>;
    } catch (error) {
      if (error instanceof DenialError) {
        const auditId = this.record(
          capability,
          'denied',
          'notice',
          error.denial.policy,
          this.targetOf(input),
          error.denial.message,
        );
        this.emit();
        return { status: 'denied', auditId, code: error.denial.code, message: error.denial.message };
      }
      throw error;
    }
  }

  private targetOf(input: unknown): string {
    if (input && typeof input === 'object' && 'caseId' in input) {
      const caseId = (input as { caseId: string }).caseId;
      return this.cases.find((item) => item.id === caseId)?.reference ?? caseId;
    }
    return '—';
  }

  private enforceLimit(capability: CapabilityName) {
    const at = Date.now();
    this.invocations = this.invocations.filter((entry) => at - entry.at < RATE_WINDOW_MS);
    if (capability === 'kyc.case.pii.reveal') {
      const used = this.invocations.filter(
        (entry) => entry.capability === capability && entry.userId === this.actor.userId,
      ).length;
      if (used >= 20) {
        deny('limit_exceeded', '20/hour/user', 'PII reveal budget exhausted for this hour.');
      }
    }
    this.invocations.push({ capability, userId: this.actor.userId, at });
  }

  private requireCase(caseId: string): CaseDetail {
    const found = this.cases.find((item) => item.id === caseId);
    if (!found) deny('not_found', 'existence', `Case ${caseId} does not exist.`);
    return found as CaseDetail;
  }

  private requireFreshCase(caseId: string, revision: number): CaseDetail {
    const target = this.requireCase(caseId);
    if (target.revision !== revision) {
      deny(
        'stale_revision',
        'optimistic concurrency',
        `Case moved on (you saw r${revision}, current is r${target.revision}). Reload before deciding.`,
      );
    }
    return target;
  }

  private appendEvent(target: CaseDetail, event: Omit<CaseEvent, 'id' | 'at'>) {
    target.timeline = [
      ...target.timeline,
      { id: nextId('ev'), at: new Date().toISOString(), ...event },
    ];
  }

  private record(
    capability: CapabilityName,
    outcome: AuditEntry['outcome'],
    severity: AuditEntry['severity'],
    policy: string,
    target: string,
    detail: string,
  ): string {
    const entry: AuditEntry = {
      id: nextId('aud'),
      at: new Date().toISOString(),
      actor: this.actor.displayName,
      role: this.actor.role,
      capability,
      outcome,
      severity,
      policy,
      target,
      detail,
    };
    this.audit = [entry, ...this.audit];
    return entry.id;
  }

  private requestApproval(
    capability: CapabilityName,
    target: CaseDetail,
    tier: Exclude<ApprovalTier, 'none'>,
    reason: string,
    summary: string,
  ): CapabilityResult<CapabilityName> {
    const request: ApprovalRequest = {
      id: nextId('apr'),
      capability,
      caseId: target.id,
      caseReference: target.reference,
      applicantName: target.applicantName,
      requestedBy: this.actor.displayName,
      requestedById: this.actor.userId,
      requestedAt: new Date().toISOString(),
      tier,
      reason,
      summary,
      status: 'pending',
    };
    this.approvals = [request, ...this.approvals];
    target.status = 'awaiting_approval';
    target.revision += 1;
    const auditId = this.record(capability, 'pending_approval', 'high', `approval:${tier}`, target.reference, summary);
    this.appendEvent(target, {
      actor: this.actor.displayName,
      summary: `${summary} — held for ${tier === 'dual_compliance' ? 'compliance officer' : 'lead'} approval.`,

      capability,
      auditId,
    });
    return {
      status: 'pending_approval',
      auditId,
      approvalRequestId: request.id,
      message: approvalReason(capability, target) ?? 'Held for a second human.',
    };
  }

  private execute(capability: CapabilityName, rawInput: unknown): CapabilityResult<CapabilityName> {
    switch (capability) {
      case 'kyc.cases.list': {
        const input = rawInput as CapabilityInput<'kyc.cases.list'>;
        const query = input.query?.trim().toLowerCase() ?? '';
        const cases = this.cases.filter((item) => {
          if (input.status && input.status !== 'all' && item.status !== input.status) return false;
          if (input.riskBand && input.riskBand !== 'all' && item.riskBand !== input.riskBand) return false;
          if (input.assignment === 'mine' && item.assignedTo !== this.actor.userId) return false;
          if (input.assignment === 'unassigned' && item.assignedTo !== null) return false;
          if (query && !`${item.reference} ${item.applicantName} ${item.country}`.toLowerCase().includes(query)) {
            return false;
          }
          return true;
        });
        const auditId = this.record(capability, 'executed', 'info', 'read', '—', `Listed ${cases.length} cases.`);
        return { status: 'ok', auditId, output: { cases: cases.map(summarize) } };
      }

      case 'kyc.cases.get': {
        const input = rawInput as CapabilityInput<'kyc.cases.get'>;
        const target = this.requireCase(input.caseId);
        const auditId = this.record(capability, 'executed', 'info', 'read', target.reference, 'Opened case.');
        return { status: 'ok', auditId, output: { case: clone(target) } };
      }

      case 'kyc.case.pii.reveal': {
        const input = rawInput as CapabilityInput<'kyc.case.pii.reveal'>;
        if (input.justification.trim().length < 10) {
          deny('invalid_input', 'justification required', 'Provide at least 10 characters of justification.');
        }
        const target = this.requireCase(input.caseId);
        const identity = unmaskedIdentity(target.id);
        const used = this.invocations.filter(
          (entry) => entry.capability === capability && entry.userId === this.actor.userId,
        ).length;
        const auditId = this.record(
          capability,
          'executed',
          'high',
          '20/hour/user',
          target.reference,
          `Unmasked applicant PII. Justification: "${input.justification.trim()}"`,
        );
        this.appendEvent(target, {
          actor: this.actor.displayName,
          summary: 'Revealed applicant PII.',
          capability,
          auditId,
        });
        return { status: 'ok', auditId, output: { identity, revealsRemaining: Math.max(0, 20 - used) } };
      }

      case 'kyc.case.claim': {
        const input = rawInput as CapabilityInput<'kyc.case.claim'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        if (target.assignedTo && target.assignedTo !== this.actor.userId) {
          deny('limit_exceeded', '1 open claim per case', 'Another reviewer already owns this case.');
        }
        target.assignedTo = this.actor.userId;
        target.revision += 1;
        const auditId = this.record(capability, 'executed', 'info', 'write', target.reference, 'Claimed case.');
        this.appendEvent(target, { actor: this.actor.displayName, summary: 'Claimed the case.', capability, auditId });
        return { status: 'ok', auditId, output: { case: clone(target) } };
      }

      case 'kyc.case.requestInfo': {
        const input = rawInput as CapabilityInput<'kyc.case.requestInfo'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        if (input.items.length === 0) deny('invalid_input', 'schema', 'Select at least one item to request.');
        const priorRequests = target.timeline.filter((event) => event.capability === 'kyc.case.requestInfo').length;
        if (priorRequests >= 3) {
          deny('limit_exceeded', '3 per case', 'Information has already been requested three times on this case.');
        }
        target.status = 'info_requested';
        target.revision += 1;
        const auditId = this.record(
          capability,
          'executed',
          'info',
          'write',
          target.reference,
          `Requested: ${input.items.join(', ')}`,
        );
        this.appendEvent(target, {
          actor: this.actor.displayName,
          summary: `Requested more information: ${input.items.join(', ')}.`,
          capability,
          auditId,
        });
        return { status: 'ok', auditId, output: { case: clone(target) } };
      }

      case 'kyc.case.escalate': {
        const input = rawInput as CapabilityInput<'kyc.case.escalate'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        target.status = 'escalated';
        target.revision += 1;
        const auditId = this.record(capability, 'executed', 'notice', 'write', target.reference, input.note);
        this.appendEvent(target, {
          actor: this.actor.displayName,
          summary: `Escalated to enhanced due diligence: ${input.note}`,
          capability,
          auditId,
        });
        return { status: 'ok', auditId, output: { case: clone(target) } };
      }

      case 'kyc.case.approve':
      case 'kyc.case.reject': {
        const input = rawInput as CapabilityInput<'kyc.case.reject'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        if (input.note.trim().length < 20) {
          deny('invalid_input', 'note ≥ 20 chars', 'Decisions need a written rationale of at least 20 characters.');
        }
        const verb = capability === 'kyc.case.approve' ? 'Approve' : 'Reject';
        const summary =
          capability === 'kyc.case.approve'
            ? `Approve onboarding for ${target.applicantName}`
            : `Reject ${target.applicantName} (${input.reasonCode})`;
        const tier = resolveTier(capability, target);
        if (tier !== 'none') {
          return this.requestApproval(capability, target, tier, input.note.trim(), summary);
        }
        target.status = capability === 'kyc.case.approve' ? 'approved' : 'rejected';
        target.revision += 1;
        const auditId = this.record(capability, 'executed', 'high', 'approval:none', target.reference, input.note.trim());
        this.appendEvent(target, {
          actor: this.actor.displayName,
          summary: `${verb}d: ${input.note.trim()}`,
          capability,
          auditId,
        });
        return { status: 'ok', auditId, output: { case: clone(target) } };
      }

      case 'kyc.case.sar.file': {
        const input = rawInput as CapabilityInput<'kyc.case.sar.file'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        if (input.narrative.trim().length < 40) {
          deny('invalid_input', 'narrative ≥ 40 chars', 'A SAR narrative must be at least 40 characters.');
        }
        return this.requestApproval(
          capability,
          target,
          'dual_compliance',
          input.narrative.trim(),
          `File SAR for ${target.applicantName}`,
        );
      }

      case 'kyc.approvals.list': {
        const auditId = this.record(capability, 'executed', 'info', 'read', '—', 'Listed approval requests.');
        return { status: 'ok', auditId, output: { requests: this.approvals.map((item) => ({ ...item })) } };
      }

      case 'kyc.approvals.decide': {
        const input = rawInput as CapabilityInput<'kyc.approvals.decide'>;
        const request = this.approvals.find((item) => item.id === input.requestId);
        if (!request) deny('not_found', 'existence', 'Approval request not found.');
        const found = request as ApprovalRequest;
        if (found.status !== 'pending') deny('invalid_input', 'state', 'This request was already decided.');
        if (found.requestedById === this.actor.userId) {
          deny('self_approval', 'four-eyes', 'You cannot approve a request you raised.');
        }
        if (found.tier === 'dual_compliance' && this.actor.role !== 'compliance_officer') {
          deny(
            'forbidden_scope',
            'approval:dual_compliance',
            'Sanctions and SAR approvals require a compliance officer.',
          );
        }
        found.status = input.decision === 'approve' ? 'approved' : 'denied';
        found.decidedBy = this.actor.displayName;
        found.decidedAt = new Date().toISOString();
        const target = this.requireCase(found.caseId);
        if (input.decision === 'approve') {
          if (found.capability === 'kyc.case.approve') target.status = 'approved';
          else if (found.capability === 'kyc.case.reject') target.status = 'rejected';
          else target.status = 'escalated';
        } else {
          target.status = 'pending_review';
        }
        target.revision += 1;
        const auditId = this.record(
          found.capability,
          input.decision === 'approve' ? 'executed' : 'denied',
          'high',
          `approval:${found.tier}`,
          target.reference,
          `${input.decision === 'approve' ? 'Approved' : 'Denied'} request from ${found.requestedBy}: ${input.note}`,
        );
        this.appendEvent(target, {
          actor: this.actor.displayName,
          summary: `${input.decision === 'approve' ? 'Approved' : 'Denied'} ${found.summary}. ${input.note}`,
          capability: found.capability,
          auditId,
        });
        return { status: 'ok', auditId, output: { request: { ...found } } };
      }

      case 'kyc.audit.list': {
        const input = rawInput as CapabilityInput<'kyc.audit.list'>;
        return {
          status: 'ok',
          auditId: 'aud_read',
          output: { entries: this.audit.slice(0, input.limit ?? 100) },
        };
      }

      default:
        return deny('not_found', 'registry', `Capability ${capability} is not registered.`);
    }
  }
}

function summarize(detail: CaseDetail) {
  const {
    identity: _identity,
    documents: _documents,
    screeningHits: _hits,
    riskSignals: _signals,
    timeline: _timeline,
    productTier: _tier,
    expectedMonthlyVolumeUsd: _volume,
    ...summary
  } = detail;
  return summary;
}

function clone(detail: CaseDetail): CaseDetail {
  return JSON.parse(JSON.stringify(detail)) as CaseDetail;
}
