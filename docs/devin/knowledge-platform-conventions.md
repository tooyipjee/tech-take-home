# Knowledge note — internal tool platform conventions

Draft body for a knowledge note scoped to this repository.

**The trust boundary is the whole design.** Apps are generated and therefore untrusted. Apps call
capabilities through `@platform/sdk`; capabilities declare policy and the runtime enforces it.
Authorisation, amount ceilings, rate limits, idempotency, approvals and audit are runtime
concerns. Code that re-implements any of them in an app or a handler is wrong even when it works.

**Layout.** `packages/kernel` runtime and registry · `packages/capabilities` the reviewed verb
surface · `packages/db` migrations, seed and `DataSource` · `packages/sdk` the only import an app
may use · `apps/api` Fastify host · `apps/console` shell, with `src/apps/*` applications and
`src/platform/*` platform views.

**Adding a verb.** `defineRead` / `defineWrite` in `packages/capabilities`. Write policies must
declare `scope`, `idempotent: true`, `limits`, `approval`, `approverScope`, and `amountField`
whenever an amount ceiling or amount-based approval is declared. Malformed declarations throw at
boot.

**Data access.** Handlers receive `ctx.data`, a `DataSource` bound to the runtime's transaction.
New queries go in `packages/db/src/datasource.ts`, never inline in a handler.

**Outcomes an app must render.** `ok`, `replayed`, `pending_approval`, `denied_scope`,
`denied_limit`, `rate_limited`, `invalid_input`, `not_found`, `error`.

**Seeded principals.** `u_agent` (agent), `u_supervisor` (supervisor, can decide approvals and
read audit), `u_admin` (admin, adds `flags:write`). The console header switches acting user; the
API takes `x-platform-user`.

**Commands.** `npm run setup` (Postgres + migrate + seed) · `npm run dev` (API :8080, console
:5173) · `npm run lint` (boundary check) · `npm run typecheck` · `npm test`.

**Before opening a PR** run lint, typecheck and tests, and lead the description with any policy
declarations added or changed.
