# 0003 — Approvals are suspended invocations

**Status:** accepted

## Context

The common implementation is an approvals table the app writes to, and an app screen that, on
approve, performs the action. That leaves the actual effect in app code, and leaves a second path
to the effect that skips the approval entirely.

## Decision

When an approval rule fires, the runtime persists the validated invocation and returns
`pending_approval` **before the handler runs**. `decideApproval()` is the only minter of an
approval grant, and grants cannot be supplied over HTTP. On approval the runtime replays the
invocation itself, as the original requester.

## Consequences

- There is exactly one path to the effect, and it is inside the runtime.
- Attribution stays honest: the refund is the agent's, the decision is the supervisor's, and both
  are in the audit log linked by approval id.
- Self-approval is refused by the runtime, not by a UI that hides the button.
- A ceiling is not a threshold. Approval cannot lift `maxAmountCents`; over the ceiling is refused
  outright and requires a reviewed code change.
- Deferred: approval expiry, multi-party approval, and re-validating a stale input at execution
  time. All three are runtime changes, not app changes.
