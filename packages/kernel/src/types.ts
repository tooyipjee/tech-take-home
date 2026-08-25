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
  | "error";

export interface InvokeResult<T = unknown> {
  outcome: Outcome;
  result?: T;
  approvalId?: string;
  message?: string;
}
