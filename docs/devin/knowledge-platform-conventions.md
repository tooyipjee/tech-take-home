# Knowledge note — Rangka conventions

Draft body for a knowledge note scoped to this repository.

**The trust boundary is the whole design.** Apps are generated and therefore untrusted. Apps call
capabilities through `@rangka/sdk`; capabilities declare policy and the runtime enforces it.
Authorisation, amount ceilings, rate limits, idempotency, approvals and audit are runtime
concerns. Code that re-implements any of them in an app or a handler is wrong even when it works.

**Layout.** `packages/kernel` runtime and registry · `packages/capabilities` the reviewed verb
surface · `packages/db` migrations, seed and `DataSource` · `packages/sdk` the only platform import
an app may use, alongside `packages/app-kit` (bound client, identity switcher, outcome banner,
stylesheet) · `apps/api` Fastify host · `apps/console` the platform's own screens plus a launcher.
An app is a folder under `apps/` with its own Vite config, port, `tsconfig.json` and `app.json` —
today `apps/kyc-review` (the review queue), `apps/sar-desk` (filing SARs, countersigned) and
`apps/feature-flags` (turning product features on and off, protected ones countersigned).

**A new app is a new folder, and nothing else.** Nothing lists the apps: `npm run dev`,
`npm run build:apps`, `npm run typecheck`, the boundary check (`scripts/apps.mjs`) and the console
launcher (`import.meta.glob("../../*/app.json")`) all discover every folder under `apps/` that has
a `vite.config.ts`. Never add an app to a script or edit `apps/console/src/Launcher.tsx`. The
manifest is the contract: `id`, `name`, `description`, `folder` (must equal `apps/<name>`), `url`
(must name the port the Vite config pins), `scopes`, `requiredScopes` (a subset of `scopes`, and
what the launcher uses to offer or lock the tile). `npm run lint` checks all of that, including
that every scope named is one some role actually holds — a scope nobody can be granted means a
permanently locked tile, and is a tier-2 escalation rather than a manifest edit.

**One playbook, three tiers of work, and every PR carries the label.** `docs/devin/playbook.md`
triages the request — does an app already do this, can an existing app be extended, and which tier
is it — then builds and escalates itself. Building an app on top of the existing
capabilities and invariants is tier 1, `tier-1: app`. Changing the kernel, the invariants, a migration, the
capability set, the SDK or the check scripts is tier 2, `tier-2: platform`: more tests, a change record under
`docs/platform-changes/`, and an explicit human review. Changing CI, the API host, the console
shell and launcher, the build tooling or the root configs is tier 3, `tier-3: infrastructure` —
elevated work owned by the platform team, and the playbook stops rather than doing it; split it
out of an app or capability PR, or agree it with a platform owner first.

`npm run lint` enforces the tier-2 boundary (a platform edit with no change record fails), prints
the tier it detected and the label to apply, and `node scripts/check-tier.mjs --label` prints the
label alone. `.github/workflows/tier-label.yml` applies it to the pull request, creating the
labels on first use. The highest tier the diff reaches wins, so a PR touching CI and an app is an
infrastructure PR. Tier 3 is labelled, not blocked: a script cannot tell who you are, and
pretending otherwise would make a social boundary look mechanical.

**Triage before tier.** First ask whether an existing app already does the job, or is one panel
away from doing it — extending `apps/kyc-review` or `apps/sar-desk` beats a second tile over the
same verbs. Only then classify. Only existing verbs, new UI → tier 1. A capability, scope, table,
column, seed row, ceiling, rate or approval threshold that does not exist → tier 2 first, then
tier 1 for the screen. Because the repository has exactly one domain (KYC), *any* new domain —
refunds, feature flags, chargebacks — starts at tier 2; see `docs/devin/demo-two-apps.md`, which
fixes feature flags as the cheap extension (state change, no conserved quantity) and refunds as
the expensive one (amount ceiling, threshold approval, conservation invariant).

**Invariants.** `packages/kernel/src/invariants.ts` generates SQL statements that must return no rows,
from two sources: platform axioms, and each write capability's declaration — `maxAmountCents`,
`approval`, `maxPerHour`, `idempotent` and `effect` (the table the row lands in, the amount
column, the live-row predicate, the pool it draws down, `oncePerSubject`, `tracksState`). Declaring a write
derives its rules; one without an `effect` refuses to register. Never hand-write an invariant for a
rule a declaration could express. They are checked as postconditions inside the writing transaction, by a reconciler every 15s,
and — where expressible — by database triggers. A violated invariant halts the capabilities it
names (`halted` outcome on writes); reads and unrelated capabilities keep serving; only an
admin (`invariants:clear`) can resume, and only once the invariant passes again. See `GET /api/invariants`
and the console's **Invariants** tab. Invariants are platform-owned: apps never define or weaken one.

**Adding a verb.** `defineRead` / `defineWrite` in `packages/capabilities`. Write policies must
declare `scope`, `idempotent: true`, `limits`, `approval`, `approverScope`, an `effect`, and
`amountField` when they move money. `approval: { mode: "derived_from_subject", clauses }` asks the
subject row in SQL which scope must countersign, so a requirement that depends on the record is
still the platform's to decide; `previewApproval()` gives an app the same answer for display. Malformed or unprovable declarations throw at boot.

**A state a write moves** is declared with `effect.tracksState: { column, fromColumn, toColumn }`:
the effect table records the transition, the subject column is a projection of it. That derives two
more statements — the subject equals the last recorded `toColumn`, and no change starts from a
value the change before it did not leave — so a state edited outside the runtime is caught even if
it is edited back. `flags.flip` is the worked example; a subject with no recorded change yet is
covered by a database trigger rather than by the invariant, because there is nothing to compare it
to. Never track a state by hand-writing the comparison.

**Data access.** Handlers receive `ctx.data`, a `DataSource` bound to the runtime's transaction
*and* to the invocation: the platform stamps `invocation_id` on every effect row, so a handler
cannot write a row that is not attributable to an audited invocation. New queries go in
`packages/db/src/datasource.ts`, never inline in a handler.

**Outcomes an app must render.** `ok`, `replayed`, `pending_approval`, `denied_scope`,
`denied_limit`, `rate_limited`, `invalid_input`, `not_found`, `conflict`, `halted`,
`invariant_violation`, `error`.

**Seeded principals.** `u_agent` (agent: `kyc:read`, `kyc:pii`, `kyc:review`), `u_supervisor`
(supervisor: adds `kyc:decide`, `approvals:*`, `audit:read`), `u_admin` and `u_admin_2` (admins:
add `kyc:sar`, `flags:write` and `invariants:clear`; two of them so a compliance approval or a
protected flag flip has a second pair of eyes). All roles have `invariants:read` and `flags:read`. Every app header switches acting user; the API takes
`x-platform-user`.

**Deciding an approval** needs `approvals:decide` *and* the capability's declared `approverScope`,
and never the requester themself.

**Commands.** `npm run setup` (Postgres + migrate + seed) · `npm run dev` (api :8080 · console
:5173 · kyc :5174 · sar :5177 · flags :5178 — every app folder, discovered; one alone with
`npx vite --config apps/<name>/vite.config.ts` plus `npm run dev:api`) · `npm run lint`
(boundary, manifest and tier checks) · `npm run typecheck` (the platform, then each app against
its own tsconfig) · `npm test` ·
`npm run test:db` (invariants against a real database) · `npm run reconcile` (one-shot invariant
check, non-zero exit on violation) · `npm run build:apps` (every discovered app).

**Before opening a PR** run lint, typecheck and tests, and lead the description with any policy
declarations added or changed.
