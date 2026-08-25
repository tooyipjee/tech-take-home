/**
 * The entire surface an application is allowed to use. Apps do not import the
 * kernel, the data layer or a vendor client; they invoke named capabilities and
 * handle the outcomes the platform can return.
 */
export type Outcome =
  | "ok"
  | "replayed"
  | "pending_approval"
  | "denied_scope"
  | "denied_limit"
  | "rate_limited"
  | "invalid_input"
  | "not_found"
  /** An invariant guarding this capability is violated; it is refusing writes. */
  | "halted"
  /** The effect would have broken a platform invariant and was rolled back. */
  | "invariant_violation"
  | "error";

export interface InvokeResult<T> {
  outcome: Outcome;
  result?: T;
  approvalId?: string;
  message?: string;
}

export interface PlatformUser {
  id: string;
  email: string;
  name: string;
  role: "agent" | "supervisor" | "admin";
  scopes: string[];
}

export interface CapabilityDescriptor {
  name: string;
  kind: "read" | "write";
  summary: string;
  policy: Record<string, unknown>;
}

export interface PlatformClient {
  /** Reads never need an idempotency key; writes always get one. */
  invoke<T>(capability: string, input?: unknown): Promise<InvokeResult<T>>;
  users(): Promise<PlatformUser[]>;
  capabilities(): Promise<CapabilityDescriptor[]>;
  approvals(status?: string): Promise<ApprovalSummary[]>;
  decide(approvalId: string, decision: "approve" | "reject"): Promise<InvokeResult<unknown>>;
  audit(limit?: number): Promise<AuditEntry[]>;
  invariants(): Promise<InvariantReport>;
  runInvariants(): Promise<ReconciliationResult>;
  clearHalt(capability: string): Promise<{ cleared: boolean; message: string }>;
}

export interface InvariantStatus {
  id: string;
  statement: string;
  /** The axiom or policy field this invariant was derived from. */
  derivedFrom: string;
  halts: string[];
  postconditionFor: string[];
  lastRunAt: string | null;
  violations: number;
  detail: string | null;
}

export interface Halt {
  id: number;
  capability: string;
  invariantId: string;
  detail: string;
  haltedAt: string;
}

export interface InvariantReport {
  invariants: InvariantStatus[];
  halts: Halt[];
}

export interface ReconciliationResult {
  checkedAt: string;
  violations: { invariantId: string; subject: string; detail: string }[];
  halted: string[];
}

export interface ApprovalSummary {
  id: string;
  capability: string;
  input: Record<string, unknown>;
  amountCents: number | null;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  status: string;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  capability: string;
  kind: string;
  outcome: string;
  amountCents: number | null;
  approvalId: string | null;
  error: string | null;
  durationMs: number;
  input: unknown;
}

export function createClient(getUserId: () => string, baseUrl = "/api"): PlatformClient {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        "x-platform-user": getUserId(),
        ...(init?.headers ?? {}),
      },
    });
    const body = (await response.json()) as T;
    if (!response.ok && !isInvokeResult(body)) {
      throw new Error((body as { message?: string })?.message ?? `request failed: ${response.status}`);
    }
    return body;
  }

  function isInvokeResult(body: unknown): boolean {
    return Boolean(body && typeof body === "object" && "outcome" in body);
  }

  return {
    invoke: (capability, input = {}) =>
      call(`/capabilities/${capability}/invoke`, {
        method: "POST",
        body: JSON.stringify({ input, idempotencyKey: crypto.randomUUID() }),
      }),
    users: () => call("/users"),
    capabilities: () => call("/capabilities"),
    approvals: (status) => call(`/approvals${status ? `?status=${status}` : ""}`),
    decide: (approvalId, decision) =>
      call(`/approvals/${approvalId}/decide`, {
        method: "POST",
        body: JSON.stringify({ decision }),
      }),
    audit: (limit = 100) => call(`/audit?limit=${limit}`),
    invariants: () => call("/invariants"),
    runInvariants: () => call("/invariants/run", { method: "POST" }),
    clearHalt: (capability) =>
      call<{ cleared: boolean; message: string }>(`/invariants/halts/${capability}/clear`, {
        method: "POST",
      }).catch((error: Error) => ({
        cleared: false,
        message: error.message,
      })),
  };
}
