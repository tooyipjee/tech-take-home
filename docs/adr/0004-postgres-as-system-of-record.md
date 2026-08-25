# 0004 — One Postgres holds platform state and business data

**Status:** accepted, with a known cost

## Context

An internal-tool platform can hold only platform state (identity, audit, approvals, flags) and
call core services for business data, or it can own business tables directly. For a fintech, an
internal tool quietly becoming the source of truth for money-adjacent state is a classic path to
an unauditable second ledger.

## Decision

For now, one Postgres holds both: platform state (`platform_users`, `capability_registry`,
`approvals`, `idempotency_keys`, `audit_log`) and business data (`customers`, `payments`,
`refunds`, `feature_flags`, `review_queue_items`).

## Consequences

- The property that makes the audit log trustworthy is available: an effect and its audit record
  commit in the same transaction. Across a service boundary that becomes a dual-write problem, and
  the honest answer there is an outbox — deliberately not built yet.
- Demo apps work end-to-end with no external dependencies.
- The risk is real: `refunds` here is a record of intent, not a ledger. Before this platform issues
  a refund anyone reconciles against, `insertRefund` must become a call to the payments service and
  `DataSource` gains a driver boundary. Handlers are already the only code that touches
  `ctx.data`, so that change does not reach app code.
