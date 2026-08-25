import type { AuditEntry, CapabilityDescriptor, InvokeResult, Outcome } from '@platform/sdk';
import type {
  Actor,
  ApproverScope,
  CapabilityInput,
  CapabilityName,
  CaseDetail,
  CaseEvent,
  KycApproval,
  KycWritePolicy,
} from '../contracts';
import { CAPABILITY_DESCRIPTORS } from '../contracts';
import type { KycPlatformClient } from '../client';
import { buildCases, unmaskedIdentity } from './fixtures';

/**
 * An in-browser implementation of the platform runtime, in the order the kernel runs it:
 * authorisation → validation → rate limit → approval → execute, with an audit row written for
 * every outcome including the refusals.
 *
 * It exists so the app can be run and demoed before the API host has KYC capabilities registered.
 * It implements the same `PlatformClient` the SDK returns, so switching to the real runtime is a
 * change of adapter and nothing else — any behavioural difference between the two is a bug here.
 */

let counter = 0;
const nextId = (prefix: string) => `${prefix}_${(++counter).toString().padStart(4, '0')}`;

/** Thrown by a handler; the runtime turns it into an outcome, an audit row and no state change. */
class Refusal extends Error {
  constructor(
    readonly outcome: Outcome,
    message: string,
  ) {
    super(message);
  }
}

const refuse = (outcome: Outcome, message: string): never => {
  throw new Refusal(outcome, message);
};

/**
 * Which scope a second human must hold, derived from the case rather than chosen by the caller.
 *
 * This is what the kernel's `ApprovalRule` cannot express yet: `never | always | above_amount` has
 * no way to say "depends on the screening hits", so the rule lives here until the registry grows a
 * data-derived mode.
 */
export function resolveApprover(capability: CapabilityName, target: CaseDetail): ApproverScope | null {
  if (capability === 'kyc.case.sar.file') return 'kyc:sar';
  if (capability !== 'kyc.case.approve' && capability !== 'kyc.case.reject') return null;
  const sanctions = target.screeningHits.some(
    (hit) => hit.resolution === 'unresolved' && ['OFAC_SDN', 'EU_CONSOLIDATED', 'UK_HMT'].includes(hit.list),
  );
  if (sanctions) return 'kyc:sar';
  if (target.riskBand === 'high' || target.unresolvedHits > 0) return 'kyc:decide';
  return null;
}

/** Why the runtime will hold this call, phrased from the case rather than from the button. */
export function approvalReason(capability: CapabilityName, target: CaseDetail): string | null {
  const approver = resolveApprover(capability, target);
  if (!approver) return null;
  if (capability === 'kyc.case.sar.file') {
    return 'Filing a SAR is irreversible: a holder of kyc:sar other than you must always approve it.';
  }
  if (approver === 'kyc:sar') {
    return 'Unresolved sanctions exposure: a holder of kyc:sar must approve before this takes effect.';
  }
  return target.riskBand === 'high'
    ? 'High-risk case: a second human holding kyc:decide must approve before this takes effect.'
    : 'Unresolved screening hit: a second human holding kyc:decide must approve before this takes effect.';
}

const RATE_WINDOW_MS = 3_600_000;

interface HeldApproval extends KycApproval {
  /** The invocation the runtime replays if this is approved. Apps never see it. */
  held: { capability: CapabilityName; input: unknown; idempotencyKey: string };
}

export class MockKernel implements KycPlatformClient {
  readonly kind = 'mock';
  private actor: Actor;
  private readonly directory: Actor[];
  private cases: CaseDetail[] = buildCases();
  private held: HeldApproval[] = [];
  private auditLog: AuditEntry[] = [];
  private invocations: { capability: CapabilityName; userId: string; at: number }[] = [];
  private idempotency = new Map<string, unknown>();
  private listeners = new Set<() => void>();

  constructor(directory: Actor[]) {
    this.directory = directory;
    this.actor = directory[0] as Actor;
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

  async users(): Promise<Actor[]> {
    return this.directory.map((actor) => ({ ...actor }));
  }

  async capabilities(): Promise<CapabilityDescriptor[]> {
    return Object.values(CAPABILITY_DESCRIPTORS).map((descriptor) => ({ ...descriptor }));
  }

  async approvals(status?: string): Promise<KycApproval[]> {
    // The API host answers 403 here, so the mock refuses the same way: a reviewer without
    // `approvals:read` must not see an empty inbox and conclude there is nothing pending.
    this.requirePlatformScope('approvals:read');
    return this.held
      .filter((approval) => !status || approval.status === status)
      .map(({ held: _held, ...approval }) => approval);
  }

  async audit(limit = 100): Promise<AuditEntry[]> {
    this.requirePlatformScope('audit:read');
    return this.auditLog.slice(0, limit).map((entry) => ({ ...entry }));
  }

  private requirePlatformScope(scope: string): void {
    if (!this.actor.scopes.includes(scope)) {
      throw new Error(`${this.actor.role} lacks scope ${scope}`);
    }
  }

  // ---------------------------------------------------------------- invoke

  async invoke<T>(capability: string, input: unknown = {}, idempotencyKey?: string): Promise<InvokeResult<T>> {
    const started = Date.now();
    const name = capability as CapabilityName;
    const descriptor = CAPABILITY_DESCRIPTORS[name];

    if (!descriptor) {
      return this.fail(name, 'unknown', 'not_found', `unknown capability: ${capability}`, input, started);
    }

    if (!this.actor.scopes.includes(descriptor.policy.scope)) {
      return this.fail(
        name,
        descriptor.kind,
        'denied_scope',
        `${this.actor.role} lacks scope ${descriptor.policy.scope} required by ${name}`,
        input,
        started,
      );
    }

    if (descriptor.kind === 'write') {
      if (!idempotencyKey) {
        return this.fail(
          name,
          'write',
          'invalid_input',
          `${name} is a write capability and requires an idempotency key`,
          input,
          started,
        );
      }
      const limit = (descriptor.policy as KycWritePolicy).limits.maxPerHour;
      if (this.recentCount(name) >= limit) {
        return this.fail(
          name,
          'write',
          'rate_limited',
          `${this.actor.name} reached the ${limit}/hour limit for ${name}`,
          input,
          started,
        );
      }
    }

    try {
      const result = await this.run<T>(name, input, idempotencyKey, started);
      this.emit();
      return result;
    } catch (error) {
      if (error instanceof Refusal) {
        const result = this.fail<T>(name, descriptor.kind, error.outcome, error.message, input, started);
        this.emit();
        return result;
      }
      throw error;
    }
  }

  private async run<T>(
    name: CapabilityName,
    input: unknown,
    idempotencyKey: string | undefined,
    started: number,
  ): Promise<InvokeResult<T>> {
    const descriptor = CAPABILITY_DESCRIPTORS[name];
    this.invocations.push({ capability: name, userId: this.actor.id, at: Date.now() });

    if (idempotencyKey && this.idempotency.has(idempotencyKey)) {
      const stored = this.idempotency.get(idempotencyKey);
      this.record(name, descriptor.kind, 'replayed', input, started, { error: null });
      return { outcome: 'replayed', result: stored as T };
    }

    if (this.isCaseInput(input)) {
      const target = this.requireCase(input.caseId);
      this.validate(name, input);
      const approver = resolveApprover(name, target);
      if (approver) return this.hold<T>(name, input, target, approver, idempotencyKey ?? nextId('idem'), started);
    }

    const result = this.execute(name, input);
    if (idempotencyKey) this.idempotency.set(idempotencyKey, result);
    return { outcome: 'ok', result: result as T };
  }

  /** Executes a held invocation as its requester, the way `decideApproval` replays one. */
  private replay(approval: HeldApproval): InvokeResult<unknown> {
    const requester = this.directory.find((actor) => actor.id === approval.requestedBy);
    const acting = this.actor;
    if (requester) this.actor = requester;
    try {
      const result = this.execute(approval.held.capability, approval.held.input, approval.id);
      this.idempotency.set(approval.held.idempotencyKey, result);
      return { outcome: 'ok', result };
    } catch (error) {
      if (error instanceof Refusal) return { outcome: error.outcome, message: error.message };
      throw error;
    } finally {
      this.actor = acting;
    }
  }

  // ------------------------------------------------------------- approvals

  async decide(approvalId: string, decision: 'approve' | 'reject'): Promise<InvokeResult<unknown>> {
    const started = Date.now();
    const approval = this.held.find((item) => item.id === approvalId);

    const auditDecision = (outcome: Outcome, message?: string) => {
      this.record('approvals.decide', 'write', outcome, { approvalId, decision }, started, {
        error: outcome === 'ok' ? null : (message ?? null),
        approvalId,
      });
      this.emit();
      return { outcome, message } as InvokeResult<unknown>;
    };

    if (!this.actor.scopes.includes('approvals:decide')) {
      return auditDecision('denied_scope', `${this.actor.role} cannot decide approvals`);
    }
    if (!approval) return auditDecision('not_found', `unknown approval: ${approvalId}`);
    if (approval.status !== 'pending') {
      return auditDecision('error', `approval ${approvalId} is already ${approval.status}`);
    }
    if (approval.requestedBy === this.actor.id) {
      return auditDecision('denied_scope', 'an approver may not approve their own request');
    }
    if (!this.actor.scopes.includes(approval.approverScope)) {
      return auditDecision(
        'denied_scope',
        `deciding ${approval.capability} needs ${approval.approverScope}, which ${this.actor.role} does not hold`,
      );
    }

    approval.decidedBy = this.actor.id;
    approval.decidedAt = new Date().toISOString();

    if (decision === 'reject') {
      approval.status = 'rejected';
      const target = this.requireCase(approval.caseId);
      target.status = 'pending_review';
      target.revision += 1;
      this.appendEvent(target, {
        actor: this.actor.name,
        summary: `Rejected the request to ${approval.summary.toLowerCase()}.`,
        capability: approval.capability as CapabilityName,
      });
      return auditDecision('ok');
    }

    approval.status = 'approved';
    auditDecision('ok');
    const result = this.replay(approval);
    approval.status = result.outcome === 'ok' || result.outcome === 'replayed' ? 'executed' : 'failed';
    this.emit();
    return result;
  }

  // ------------------------------------------------------------- internals

  private hold<T>(
    name: CapabilityName,
    input: { caseId: string },
    target: CaseDetail,
    approverScope: ApproverScope,
    idempotencyKey: string,
    started: number,
  ): InvokeResult<T> {
    const approvalId = nextId('apr');
    const summary =
      name === 'kyc.case.approve'
        ? `Approve onboarding for ${target.applicantName}`
        : name === 'kyc.case.reject'
          ? `Reject ${target.applicantName}`
          : `File SAR for ${target.applicantName}`;

    this.held = [
      {
        id: approvalId,
        capability: name,
        input: input as Record<string, unknown>,
        amountCents: null,
        reason: approvalReason(name, target) ?? 'held for a second human',
        requestedBy: this.actor.id,
        requestedByName: this.actor.name,
        status: 'pending',
        decidedBy: null,
        decidedAt: null,
        createdAt: new Date().toISOString(),
        approverScope,
        caseId: target.id,
        caseReference: target.reference,
        applicantName: target.applicantName,
        summary,
        held: { capability: name, input, idempotencyKey },
      },
      ...this.held,
    ];

    target.status = 'awaiting_approval';
    target.revision += 1;
    this.record(name, 'write', 'pending_approval', input, started, { approvalId, error: null });
    this.appendEvent(target, {
      actor: this.actor.name,
      summary: `${summary} — held for a holder of ${approverScope}.`,
      capability: name,
    });

    return {
      outcome: 'pending_approval',
      approvalId,
      message: `held for approval by someone with ${approverScope}`,
    };
  }

  private recentCount(name: CapabilityName): number {
    const at = Date.now();
    this.invocations = this.invocations.filter((entry) => at - entry.at < RATE_WINDOW_MS);
    return this.invocations.filter((entry) => entry.capability === name && entry.userId === this.actor.id).length;
  }

  private isCaseInput(input: unknown): input is { caseId: string } {
    return Boolean(input && typeof input === 'object' && 'caseId' in input);
  }

  private requireCase(caseId: string): CaseDetail {
    const found = this.cases.find((item) => item.id === caseId);
    if (!found) refuse('not_found', `unknown case: ${caseId}`);
    return found as CaseDetail;
  }

  private requireFreshCase(caseId: string, revision: number): CaseDetail {
    const target = this.requireCase(caseId);
    if (target.revision !== revision) {
      refuse(
        'error',
        `case moved on (you saw r${revision}, current is r${target.revision}); reload before deciding`,
      );
    }
    return target;
  }

  /** The schema half of the kernel's validation step, hand-written until the Zod registry has KYC. */
  private validate(name: CapabilityName, input: unknown): void {
    if (name === 'kyc.case.pii.reveal') {
      const { justification } = input as CapabilityInput<'kyc.case.pii.reveal'>;
      if (justification.trim().length < 10) {
        refuse('invalid_input', 'justification: must contain at least 10 characters');
      }
    }
    if (name === 'kyc.case.approve' || name === 'kyc.case.reject') {
      const { note } = input as CapabilityInput<'kyc.case.reject'>;
      if (note.trim().length < 20) {
        refuse('invalid_input', 'note: a decision rationale must contain at least 20 characters');
      }
    }
    if (name === 'kyc.case.sar.file') {
      const { narrative } = input as CapabilityInput<'kyc.case.sar.file'>;
      if (narrative.trim().length < 40) {
        refuse('invalid_input', 'narrative: a SAR narrative must contain at least 40 characters');
      }
    }
    if (name === 'kyc.case.requestInfo') {
      const { items } = input as CapabilityInput<'kyc.case.requestInfo'>;
      if (items.length === 0) refuse('invalid_input', 'items: select at least one item to request');
    }
  }

  private appendEvent(target: CaseDetail, event: Omit<CaseEvent, 'id' | 'at'>) {
    target.timeline = [...target.timeline, { id: nextId('ev'), at: new Date().toISOString(), ...event }];
  }

  private fail<T>(
    name: string,
    kind: string,
    outcome: Outcome,
    message: string,
    input: unknown,
    started: number,
  ): InvokeResult<T> {
    this.record(name, kind, outcome, input, started, { error: message });
    return { outcome, message };
  }

  private record(
    capability: string,
    kind: string,
    outcome: Outcome,
    input: unknown,
    started: number,
    extra: { error?: string | null; approvalId?: string } = {},
  ): void {
    this.auditLog = [
      {
        id: ++counter,
        at: new Date().toISOString(),
        actorId: this.actor.id,
        actorRole: this.actor.role,
        capability,
        kind,
        outcome,
        amountCents: null,
        approvalId: extra.approvalId ?? null,
        error: extra.error ?? null,
        durationMs: Math.max(1, Date.now() - started),
        input,
      },
      ...this.auditLog,
    ];
  }

  // -------------------------------------------------------------- handlers

  private execute(name: CapabilityName, rawInput: unknown, approvalId?: string): unknown {
    const started = Date.now();
    const kind = CAPABILITY_DESCRIPTORS[name].kind;
    const done = (result: unknown) => {
      this.record(name, kind, 'ok', rawInput, started, { approvalId, error: null });
      return result;
    };

    switch (name) {
      case 'kyc.cases.list': {
        const input = rawInput as CapabilityInput<'kyc.cases.list'>;
        const query = input.query?.trim().toLowerCase() ?? '';
        const cases = this.cases.filter((item) => {
          if (input.status && input.status !== 'all' && item.status !== input.status) return false;
          if (input.riskBand && input.riskBand !== 'all' && item.riskBand !== input.riskBand) return false;
          if (input.assignment === 'mine' && item.assignedTo !== this.actor.id) return false;
          if (input.assignment === 'unassigned' && item.assignedTo !== null) return false;
          if (query && !`${item.reference} ${item.applicantName} ${item.country}`.toLowerCase().includes(query)) {
            return false;
          }
          return true;
        });
        return done({ cases: cases.map(summarize) });
      }

      case 'kyc.cases.get': {
        const input = rawInput as CapabilityInput<'kyc.cases.get'>;
        return done({ case: clone(this.requireCase(input.caseId)) });
      }

      case 'kyc.case.pii.reveal': {
        const input = rawInput as CapabilityInput<'kyc.case.pii.reveal'>;
        const target = this.requireCase(input.caseId);
        const identity = unmaskedIdentity(target.id);
        const used = this.recentCount(name);
        const result = done({ identity, revealsRemaining: Math.max(0, 20 - used) });
        this.appendEvent(target, {
          actor: this.actor.name,
          summary: `Revealed applicant PII. Justification: "${input.justification.trim()}"`,
          capability: name,
        });
        return result;
      }

      case 'kyc.case.claim': {
        const input = rawInput as CapabilityInput<'kyc.case.claim'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        if (target.assignedTo && target.assignedTo !== this.actor.id) {
          refuse('error', 'another reviewer already owns this case');
        }
        target.assignedTo = this.actor.id;
        target.revision += 1;
        this.appendEvent(target, { actor: this.actor.name, summary: 'Claimed the case.', capability: name });
        return done({ case: clone(target) });
      }

      case 'kyc.case.requestInfo': {
        const input = rawInput as CapabilityInput<'kyc.case.requestInfo'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        const priorRequests = target.timeline.filter((event) => event.capability === name).length;
        if (priorRequests >= 3) {
          refuse('rate_limited', 'information has already been requested three times on this case');
        }
        target.status = 'info_requested';
        target.revision += 1;
        this.appendEvent(target, {
          actor: this.actor.name,
          summary: `Requested more information: ${input.items.join(', ')}.`,
          capability: name,
        });
        return done({ case: clone(target) });
      }

      case 'kyc.case.escalate': {
        const input = rawInput as CapabilityInput<'kyc.case.escalate'>;
        const target = this.requireFreshCase(input.caseId, input.revision);
        target.status = 'escalated';
        target.revision += 1;
        this.appendEvent(target, {
          actor: this.actor.name,
          summary: `Escalated to enhanced due diligence: ${input.note}`,
          capability: name,
        });
        return done({ case: clone(target) });
      }

      case 'kyc.case.approve':
      case 'kyc.case.reject': {
        const input = rawInput as CapabilityInput<'kyc.case.reject'>;
        const target = approvalId
          ? this.requireCase(input.caseId)
          : this.requireFreshCase(input.caseId, input.revision);
        target.status = name === 'kyc.case.approve' ? 'approved' : 'rejected';
        target.revision += 1;
        this.appendEvent(target, {
          actor: this.actor.name,
          summary: `${name === 'kyc.case.approve' ? 'Approved' : 'Rejected'}: ${input.note.trim()}`,
          capability: name,
        });
        return done({ case: clone(target) });
      }

      case 'kyc.case.sar.file': {
        const input = rawInput as CapabilityInput<'kyc.case.sar.file'>;
        const target = approvalId
          ? this.requireCase(input.caseId)
          : this.requireFreshCase(input.caseId, input.revision);
        target.status = 'escalated';
        target.revision += 1;
        this.appendEvent(target, {
          actor: this.actor.name,
          summary: `Filed a suspicious activity report: ${input.narrative.trim()}`,
          capability: name,
        });
        return done({ case: clone(target) });
      }

      default:
        return refuse('not_found', `unknown capability: ${name}`);
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
