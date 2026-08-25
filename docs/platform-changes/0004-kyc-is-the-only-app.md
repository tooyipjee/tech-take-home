# Platform change: KYC is the product, and approval can depend on the record

Tier: 2 (extends the framework)

## What changed

The repository had one real product idea and three demo verticals. Refunds, the generic
review queue and the feature-flag surface are gone — capabilities, tables, seed data, apps
and tests — and the KYC review queue is the only app. It used to run on a 595-line in-app
mock kernel, which meant the guarantees it demonstrated were its own rather than the
platform's; it now runs on real `kyc.*` capabilities over Postgres and the mock is deleted.

- `packages/db/migrations/0002_business.sql` — the payments/refunds/queue/flags schema is
  replaced by the KYC schema: `kyc_cases` with its `kyc_documents`, `kyc_screening_hits` and
  `kyc_risk_signals`, and the effect tables `kyc_case_decisions`, `kyc_pii_disclosures`,
  `kyc_sars` and `kyc_case_events`. Decisions and SARs carry a one-per-case unique index, so
  "onboarded once" is a database fact.
- `packages/db/src/datasource.ts` — refund/queue methods replaced by KYC methods. Identity is
  masked in the projection by default; unmasking is a separate call that writes a disclosure
  row. Revision-sensitive mutations lock the case and raise `StaleRevisionError`, which the
  runtime reports as `conflict` rather than as a platform error, including for a case that is
  already terminal.
- `packages/capabilities/src/kyc.ts` — the nine `kyc.*` capabilities with their declared
  policy; `packages/capabilities/src/refunds.ts` and the queue/flags declarations are deleted.
- `packages/kernel/src/runtime.ts` — a new approval mode, `derived_from_subject`. Its clauses
  are SQL predicates over the subject row (`s`), evaluated before the write; the first match
  wins and fixes the `approverScope` **on the approval row**, so a later edit to the
  declaration cannot lower the bar on a request already waiting. `previewApproval()` answers
  the same question without performing the call, and `kyc.cases.get` returns it, so the app
  can warn a reviewer without holding a second copy of the rule.
- `packages/kernel/src/auth.ts`, `packages/db/src/seed.ts` — scopes are KYC-only; six seeded
  cases replace the payments fixtures.
- `apps/kyc-review` — the mock kernel and fixtures are deleted, the `?adapter=api` switch is
  gone, the identity directory and the capability registry are fetched from the platform
  rather than hard-coded, and the policy chips render the served declaration.
- `apps/console/src/Launcher.tsx`, root `package.json`, README, architecture, knowledge note
  and the testing skill follow the same cut.

## Invariants affected

The set is derived, so removing refunds removed its invariants and declaring KYC derived new
ones. Nothing was weakened by hand.

- **Removed** (their capability no longer exists): `refunds.issue.*`, including
  `conserves_payments` and `respects_declared_ceiling`. `EffectDeclaration.conserves` and
  `amountColumn` remain in the kernel — conservation is still expressible, there is simply
  nothing in this repository that moves money.
- **Added**, derived from the KYC declarations: `carries_the_declared_approval`,
  `respects_declared_rate`, `is_idempotent` and `effects_are_attributed` for each of the seven
  writes, plus `happens_at_most_once_per_subject` for `kyc.case.approve`, `kyc.case.reject`
  and `kyc.case.sar.file`.
- **Strengthened**: `carries_the_declared_approval` now reads the derived clauses, so it can
  say "this case should have been approved by a `kyc:sar` holder and was not" of committed
  data — a claim the previous amount-threshold form could not make.
- **Unchanged**: the two axioms, `approvals.decided_by_a_second_person` and
  `approvals.decided_by_a_holder_of_the_required_scope`.
- **New database protection**: `EffectDeclaration.oncePerSubject` is backed by a unique index
  as well as by the derived invariant, so a duplicate decision fails in the database even if
  the runtime is bypassed.

## How it was verified

- `npm test` — the derivation suite, rewritten for KYC: that `kyc.case.approve` derives exactly
  its five rules, that every write is guarded and only writes are, that thresholds inside the
  generated SQL come from the registry rather than a second copy, that the approval statement
  references the declared clauses, that a write with no `effect` refuses to register, and that
  no kind of invariant is in force without a database test attacking it.
- `npm run test:db` — fifteen tests against a real Postgres, all adversarial: a decision
  inserted by raw SQL with no invocation behind it, forged audit rows to fake a rate limit and
  an idempotency replay, `UPDATE`/`DELETE` on history, a second terminal decision, approving
  one's own request, a supervisor approving a sanctions case, a decision missing its approval,
  a reveal without justification, a stale revision, and a reconciliation that halts only the
  affected capability and refuses to clear until the data is repaired.
- `npm run reconcile` on seeded data, migrations applied to an empty database, `npm run lint`,
  `npm run typecheck`, `npm run build:apps`.

## Rollback

Revert the commit. The migration is destructive — `0002_business.sql` now creates the KYC
schema where it used to create payments and refunds — so rolling back requires recreating the
database (`npm run db:down && npm run setup`) rather than a down-migration. Nothing outside
this repository depends on either schema; there is no production data to preserve.
