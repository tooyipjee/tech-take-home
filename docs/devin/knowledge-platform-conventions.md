# Knowledge note — internal tool platform conventions

Draft body for a knowledge note scoped to this repository.

**The trust boundary is the whole design.** Apps are generated and therefore untrusted. Apps call
capabilities through `@platform/sdk`; capabilities declare policy and the runtime enforces it.
Authorisation, amount ceilings, rate limits, idempotency, approvals and audit are runtime
concerns. Code that re-implements any of them in an app or a handler is wrong even when it works.

**Layout.** `packages/kernel` runtime and registry · `packages/capabilities` the reviewed verb
surface · `packages/db` migrations, seed and `DataSource` · `packages/sdk` the only platform import
an app may use, alongside `packages/app-kit` (bound client, identity switcher, outcome banner,
stylesheet) · `apps/api` Fastify host · `apps/console` the platform's own screens plus a launcher.
An app is a folder under `apps/` with its own Vite config and port — today only `apps/kyc-review`,
the KYC review queue — and a new app is a new folder, nothing more.

**Two tiers of work.** Building an app on top of the existing capabilities and invariants is tier 1
(`docs/devin/playbook-build-an-app.md`). Changing the kernel, the invariants, a migration, the
capability set, the SDK or the check scripts is tier 2
(`docs/devin/playbook-extend-the-platform.md`): more tests, a change record under
`docs/platform-changes/`, and an explicit human review. `npm run lint` enforces the boundary —
a platform edit with no change record fails.

**Invariants.** `packages/kernel/src/invariants.ts` generates SQL statements that must return no rows,
from two sources: platform axioms, and each write capability's declaration — `maxAmountCents`,
`approval`, `maxPerHour`, `idempotent` and `effect` (the table the row lands in, the amount
column, the live-row predicate, the pool it draws down, `oncePerSubject`). Declaring a write
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

**Data access.** Handlers receive `ctx.data`, a `DataSource` bound to the runtime's transaction
*and* to the invocation: the platform stamps `invocation_id` on every effect row, so a handler
cannot write a row that is not attributable to an audited invocation. New queries go in
`packages/db/src/datasource.ts`, never inline in a handler.

**Outcomes an app must render.** `ok`, `replayed`, `pending_approval`, `denied_scope`,
`denied_limit`, `rate_limited`, `invalid_input`, `not_found`, `halted`, `invariant_violation`,
`error`.

**Seeded principals.** `u_agent` (agent: `kyc:read`, `kyc:pii`, `kyc:review`), `u_supervisor`
(supervisor: adds `kyc:decide`, `approvals:*`, `audit:read`), `u_admin` and `u_admin_2` (admin: add
`kyc:sar` and `invariants:clear`; there are two so a request needing `kyc:sar` can still be
four-eyed). All roles have `invariants:read`. The console header switches acting user; the
API takes `x-platform-user`.

**Commands.** `npm run setup` (Postgres + migrate + seed) · `npm run dev` (API :8080, console
:5173) · `npm run lint` (boundary + tier check) · `npm run typecheck` · `npm test` ·
`npm run test:db` (invariants against a real database) · `npm run reconcile` (one-shot invariant
check, non-zero exit on violation).

**Before opening a PR** run lint, typecheck and tests, and lead the description with any policy
declarations added or changed.
