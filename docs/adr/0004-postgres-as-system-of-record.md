# 0004 — One Postgres holds platform state and business data

**Status:** accepted, with a known cost

## Context

An internal-tool platform can hold only platform state (identity, audit, approvals, flags) and
call core services for business data, or it can own business tables directly. For a fintech, an
internal tool quietly becoming the source of truth for money-adjacent state is a classic path to
an unauditable second ledger.

## Decision

For now, one Postgres holds both: platform state (`platform_users`, `capability_registry`,
`approvals`, `idempotency_keys`, `audit_log`) and business data — today the KYC schema
(`kyc_cases` and its documents, screening hits, risk signals, decisions, disclosures and SARs;
originally `payments`/`refunds`, replaced when KYC became the only domain).

## Consequences

- The property that makes the audit log trustworthy is available: an effect and its audit record
  commit in the same transaction. Across a service boundary that becomes a dual-write problem, and
  the honest answer there is an outbox — deliberately not built yet.
- Demo apps work end-to-end with no external dependencies.
- The risk is real, and it did not go away with refunds: `kyc_cases` here is the record a regulator
  would ask about, not a copy of one held elsewhere. Before a real KYC vendor or core system exists,
  `DataSource` must gain a driver boundary and the write methods become calls to it. Handlers are
  already the only code that touches `ctx.data`, so that change does not reach app code — but the
  atomic effect-plus-audit property is exactly what a service boundary costs, and the honest answer
  there is an outbox.
