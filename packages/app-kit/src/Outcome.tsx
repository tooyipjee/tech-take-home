import type { InvokeResult } from "@rangka/sdk";

const TONE: Record<string, string> = {
  ok: "ok",
  replayed: "ok",
  pending_approval: "warn",
  denied_scope: "bad",
  denied_limit: "bad",
  rate_limited: "bad",
  invalid_input: "bad",
  not_found: "bad",
  conflict: "warn",
  halted: "bad",
  invariant_violation: "bad",
  error: "bad",
};

const EXPLAIN: Record<string, string> = {
  ok: "Executed and audited by the runtime.",
  replayed: "Idempotency key already used — the stored response was returned, no second effect.",
  pending_approval: "Held by the runtime. The handler has not run yet.",
  denied_scope: "Blocked before validation: the principal lacks the declared scope.",
  denied_limit: "Blocked by the amount ceiling declared on the capability.",
  rate_limited: "Blocked by the per-hour ceiling declared on the capability.",
  invalid_input: "Rejected by the capability's input schema.",
  not_found: "No such capability in the registry.",
  conflict: "The record moved since it was read, so nothing was written.",
  halted: "An invariant guarding this capability is violated, so it is refusing writes until an admin clears it.",
  invariant_violation:
    "The effect broke a platform invariant and was rolled back inside the transaction — nothing committed.",
  error: "The handler threw; the transaction rolled back and the failure was audited.",
};

export function OutcomeBanner({ result }: { result: InvokeResult<unknown> | null }) {
  if (!result) return null;
  return (
    <div className={`outcome-banner ${TONE[result.outcome] ?? ""}`}>
      <strong>{result.outcome}</strong>
      {result.approvalId ? <code> · {result.approvalId}</code> : null}
      <div>
        <code>{result.message ?? EXPLAIN[result.outcome]}</code>
      </div>
    </div>
  );
}

export function OutcomeBadge({ outcome }: { outcome: string }) {
  return <span className={`badge ${TONE[outcome] ?? ""}`}>{outcome}</span>;
}
