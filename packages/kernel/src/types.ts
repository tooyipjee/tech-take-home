import type { z } from "zod";
import type { DataSource } from "@platform/db";

export type Role = "agent" | "supervisor" | "admin";

export interface Principal {
  id: string;
  email: string;
  name: string;
  role: Role;
  scopes: string[];
}

export type CapabilityKind = "read" | "write";

/** How much a single actor may do with one write capability, enforced by the runtime. */
export interface WriteLimits {
  /** Hard ceiling per invocation. `null` means the capability moves no money. */
  maxAmountCents: number | null;
  /** Sliding one-hour ceiling on accepted invocations per actor. */
  maxPerHour: number;
}

/**
 * One clause of a data-derived approval rule: when `when` holds of the record being
 * acted on, a second person holding `approverScope` must agree first.
 *
 * `when` is SQL over the subject row, aliased `s`. It is written once, by a reviewed
 * tier-2 change, and is used by both the runtime (before the fact, to decide whether
 * to hold the call) and the derived invariant (after the fact, over committed rows) —
 * so the rule the platform enforces and the rule it proves cannot drift apart.
 */
export interface SubjectApprovalClause {
  when: string;
  approverScope: string;
  /** How the requirement is explained to the person whose action was held. */
  because: string;
}

export type ApprovalRule =
  | { mode: "never" }
  | { mode: "always" }
  | { mode: "above_amount"; amountCents: number }
  /**
   * Whether approval is needed is a property of the record, not of the input: a
   * sanctions hit needs compliance, a high-risk case needs a second reviewer, a clean
   * one needs nobody. Clauses are evaluated in order and the first match wins, so the
   * strictest belongs first.
   */
  | { mode: "derived_from_subject"; clauses: SubjectApprovalClause[] };

/**
 * Where a write capability's effect lands, and what finite thing it draws down.
 *
 * This is the declaration the platform derives invariants from: given it, every rule
 * that can be proved about the capability — attribution, conservation, ceiling,
 * approval, rate, idempotency — is generated from the policy above rather than
 * hand-written per capability. A money-moving capability that does not declare
 * one cannot be proved correct after the fact, so the registry refuses it.
 *
 * Identifiers are database identifiers, validated at registration.
 */
export interface EffectDeclaration {
  /** One row per accepted invocation lands here. */
  table: string;
  /** Column naming the subject row this effect acted on. */
  subjectColumn: string;
  /** Column holding the amount moved, for a capability that moves money. */
  amountColumn?: string;
  /** Which rows count as live effects, e.g. `{ column: "status", equals: "issued" }`. */
  live?: { column: string; equals: string };
  /** The pool this effect draws down, for an effect that consumes a finite balance. */
  conserves?: {
    table: string;
    /** Column on the effect table naming the pool row. */
    via: string;
    /** Column on the pool table holding the total available. */
    amountColumn: string;
  };
  /**
   * At most one live effect per subject, for an act that can only happen once:
   * a case is onboarded or declined once, a SAR is filed once.
   */
  oncePerSubject?: boolean;
}

export interface WritePolicy {
  scope: string;
  /**
   * Declared, not implemented: the runtime supplies the idempotency store.
   * Every write capability must opt in, which is why the type has one value.
   */
  idempotent: true;
  limits: WriteLimits;
  approval: ApprovalRule;
  /** Approvers need this scope; a requester may never approve their own request. */
  approverScope: string;
  /** Dot path into the validated input holding the money amount, if any. */
  amountField?: string;
  /**
   * The record this capability acts on: which table it lives in and which input
   * field names it. Required for a data-derived approval rule, because that rule is
   * a question asked of this row.
   */
  subject?: { table: string; idField: string };
  /** What the capability writes; the platform derives this capability's invariants from it. */
  effect?: EffectDeclaration;
}

export interface ReadPolicy {
  scope: string;
  /** Result-set ceiling; the runtime clamps `limit`-style inputs to it. */
  maxRows: number;
}

/**
 * Everything a capability handler is allowed to touch. There is deliberately no
 * pool, no HTTP client and no vendor SDK here.
 */
export interface CapabilityContext {
  principal: Principal;
  data: DataSource;
  now: Date;
  /** Correlates handler logs with the audit record for this invocation. */
  invocationId: string;
  /**
   * Set when this invocation is the replay of an approved request, so a handler can
   * tell a first attempt from the execution that follows a countersignature. It cannot
   * be set by a caller: only {@link decideApproval} produces one.
   */
  approvalId: string | null;
}

export interface ReadCapability<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  kind: "read";
  summary: string;
  input: I;
  policy: ReadPolicy;
  handler: (input: z.infer<I>, ctx: CapabilityContext) => Promise<O>;
}

export interface WriteCapability<I extends z.ZodTypeAny = z.ZodTypeAny, O = unknown> {
  name: string;
  kind: "write";
  summary: string;
  input: I;
  policy: WritePolicy;
  handler: (input: z.infer<I>, ctx: CapabilityContext) => Promise<O>;
}

export type Capability = ReadCapability | WriteCapability;

export type Outcome =
  | "ok"
  | "replayed"
  | "pending_approval"
  | "denied_scope"
  | "denied_limit"
  | "rate_limited"
  | "invalid_input"
  | "not_found"
  /** The record moved under the caller; nothing was written. */
  | "conflict"
  /** An invariant guarding this capability is violated; writes are refused until cleared. */
  | "halted"
  /** The effect broke an invariant and was rolled back. */
  | "invariant_violation"
  | "error";

export interface InvokeResult<T = unknown> {
  outcome: Outcome;
  result?: T;
  approvalId?: string;
  message?: string;
}
