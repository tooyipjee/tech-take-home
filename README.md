# Internal Tool Platform

An internal-tool platform for a fintech back office. Apps here are **written by Devin**, not
drawn in a canvas — so the platform's job is not app authoring. Its job is to be the substrate
that makes generated code safe: apps get a narrow, typed capability surface, and authorisation,
amount ceilings, rate limits, approvals and audit are enforced *below* the app, by the runtime.

The bet: generated code is fast but not trustworthy, so nothing load-bearing may live in it.

```
Devin writes this ──►  app (React screen)     apps/console/src/apps
                             │  invoke("refunds.issue", {...})
                       ──────┼───────────────────────────────  trust boundary
Humans review this ──► capability (declared policy + handler)   packages/capabilities
                             │
                       runtime: scope → validate → rate limit → ceiling
                                → approval → execute → audit     packages/kernel
                             │
                       data source (transaction-bound)           packages/db
                             │
                       Postgres
```

## Run it

```bash
npm install
npm run setup     # starts Postgres in Docker, migrates, seeds
npm run dev       # api on :8080, console on :5173
```

Open <http://localhost:5173> and use the **acting as** switcher in the header to change principal.

### The demo, in five clicks

| Do this | What the platform does |
| --- | --- |
| As **Avery (agent)**, refund $42 on `pay_2001` | `ok` — executed and audited in one transaction |
| Click *Issue refund* again with the same amount | fresh idempotency key, so a second refund; re-issuing the *same* key returns `replayed` |
| Refund $600 on `pay_2003` | `pending_approval` — the handler never ran |
| Switch to **Sam (supervisor)** → Approvals → Approve | runtime replays the request as Avery under a grant only it can mint |
| Switch back to Avery, try to refund $2,500 | `denied_limit` — above the declared ceiling |
| As Avery, open **Audit log** | `403` — agents lack `audit:read`; the denial is itself audited |

Everything above is visible in the **Audit log** tab as a supervisor, including every denial.

## Layout

| Path | What it is |
| --- | --- |
| `packages/kernel` | Capability registry, policy declaration types, invocation runtime, audit |
| `packages/capabilities` | The reviewed surface: refunds, feature flags, review queue |
| `packages/db` | Migrations, seed, and the `DataSource` handlers are bound to |
| `packages/sdk` | The only thing an app may import |
| `apps/api` | Fastify host: identity, capability invocation, approvals, audit |
| `apps/console` | App shell; `src/apps/*` are applications, `src/platform/*` are platform views |

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run setup` | Postgres up, migrate, reset + seed |
| `npm run dev` | API and console together |
| `npm run db:reset` | Wipe transactional state, re-seed |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm run lint` | Boundary check: apps may not import the db, kernel, capabilities, or call `fetch` |
| `npm test` | Kernel policy-declaration tests |

## Documentation

- [Architecture](docs/architecture.md) — the trust boundary and the invocation pipeline in detail
- [Authoring a capability](docs/authoring-a-capability.md) — the workflow humans and Devin share
- [Decisions](docs/adr) — why it is built this way, and what was deliberately not built
- [Devin playbook](docs/devin/playbook-build-an-app.md) — the prompt-side of "a new app is a prompt"

## Status

Framework and one worked example. The three target apps (customer review queues, refunds
dashboard, feature flag admin) are intentionally not built yet: `refunds.issue` exists to prove
the enforcement path, not to be the product.
