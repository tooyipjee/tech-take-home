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

export type ApprovalRule =
  | { mode: "never" }
  | { mode: "always" }
  | { mode: "above_amount"; amountCents: number };

/**
 * Where a write capability's effect lands, and what finite thing it draws down.
 *
 * This is the declaration the platform derives tenets from: given it, every rule
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
  /** Column holding the amount moved; must equal the audited amount. */
  amountColumn: string;
  /** Which rows count as live effects, e.g. `{ column: "status", equals: "issued" }`. */
  live?: { column: string; equals: string };
  /** The pool this effect draws down: refunds draw down their payment. */
  conserves?: {
    table: string;
    /** Column on the effect table naming the pool row. */
    via: string;
    /** Column on the pool table holding the total available. */
    amountColumn: string;
  };
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
  /** What the capability writes; the platform derives this capability's tenets from it. */
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
  /** A tenet guarding this capability is violated; writes are refused until cleared. */
  | "halted"
  /** The effect broke a tenet and was rolled back. */
  | "tenet_violation"
  | "error";

export interface InvokeResult<T = unknown> {
  outcome: Outcome;
  result?: T;
  approvalId?: string;
  message?: string;
}
