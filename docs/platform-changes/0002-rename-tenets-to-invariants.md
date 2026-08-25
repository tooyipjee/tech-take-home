# Platform change: "tenet" is now "invariant"

Tier: 2 (touches the kernel, a migration and the API surface)

## What changed

A rename, nothing else. `tenet` → `invariant` throughout: `packages/kernel/src/invariants.ts`,
the `invariant_runs` table and `0003_invariants.sql`, the `/api/invariants` routes, the
`invariants:clear` scope, the `Invariants` console tab, and the docs.

"Invariant" is the term the rest of the industry uses for a property a database is required to
keep true, and it does not collide with "business rule" — a refund threshold is also a rule, and
that is exactly the thing an invariant is *derived from* rather than a synonym for.

## Invariants affected

None. Same statements, same derivation, same three enforcement points; only the names moved.
The set is still `approvals.decided_by_a_second_person` plus the six derived from
`refunds.issue`.

## How it was verified

`npm run lint`, `npm run typecheck`, `npm test` (10), `npm run test:db` (12 against a database
recreated from the migrations), `npm run reconcile` (all invariants held), and the console
driven by hand.

## Rollback

Revert the commit. Anyone running an older database drops it and re-runs `npm run setup`:
`0003_invariants.sql` is a rename of `0003_tenets.sql`, not an additional migration, so an
existing volume must be recreated rather than migrated forward.
