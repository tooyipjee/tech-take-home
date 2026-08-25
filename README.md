# Internal Tool Platform

An internal-tool platform for a fintech back office. Apps here are **written by Devin**, not
drawn in a canvas — so the platform's job is not app authoring. Its job is to be the substrate
that makes generated code safe: apps get a narrow, typed capability surface, and authorisation,
amount ceilings, rate limits, approvals and audit are enforced *below* the app, by the runtime.

The bet: generated code is fast but not trustworthy, so nothing load-bearing may live in it.
And because "we tested it and it held" is a verdict about a moment rather than a property of
the system, the platform states its invariants as **tenets** and re-proves them continuously —
in the database, inside every writing transaction, and on a timer (see
[ADR 0006](docs/adr/0006-tenets-are-enforced-three-times.md)).

Tenets are not a hand-picked list. Each one is derived either from a platform axiom or
mechanically from the policy a human reviewed — declare `maxAmountCents`, an approval rule and
where the money lands, and the SQL that proves the committed data obeys all three is generated
from that declaration. A money-moving capability cannot register without it.

```
Devin writes this ──►  app (React screen)     apps/console/src/apps
                             │  invoke("refunds.issue", {...})
                       ──────┼───────────────────────────────  trust boundary
Humans review this ──► capability (declared policy + handler)   packages/capabilities
                             │
                       runtime: scope → validate → rate limit → ceiling
                                → approval → halted? → execute → audit
                                → tenet postcondition (or roll back)   packages/kernel
                             │
                       data source (transaction- and invocation-bound) packages/db
                             │
                       Postgres: constraints, append-only history,
                                 conservation triggers
                             ▲
                       reconciler, every 15s: re-derives every tenet,
                       halts the capabilities a violated one guards
```

## Run it

```bash
npm install
npm run setup     # starts Postgres in Docker, migrates, seeds
npm run dev       # api on :8080, console on :5173
```

Open <http://localhost:5173>. You land on the **app launcher**: every registered app as a tile,
offered or locked according to the signed-in principal's scopes. The **signed in as** switcher in
the header is a mock identity provider — it stands in for an OAuth2/OIDC sign-in (swapping it for
the real thing changes `resolvePrincipal` and nothing else). Tile availability is presentation
only; the runtime re-checks scopes on every capability call.

### The demo

| Do this | What the platform does |
| --- | --- |
| As **Avery (agent)**, refund $42 on `pay_2001` | `ok` — executed and audited in one transaction |
| Click *Issue refund* again with the same amount | fresh idempotency key, so a second refund; re-issuing the *same* key returns `replayed` |
| Refund $600 on `pay_2003` | `pending_approval` — the handler never ran |
| Switch to **Sam (supervisor)** → Approvals → Approve | runtime replays the request as Avery under a grant only it can mint |
| Switch back to Avery, try to refund $2,500 | `denied_limit` — above the declared ceiling |
| As Avery, open **Audit log** | `403` — agents lack `audit:read`; the denial is itself audited |
| Open **Tenets** → *Reconcile now* | every statement re-proved against committed data, each showing the axiom or policy field it was derived from and when it was last checked |
| In `psql`, `update payments set amount_cents = 1000 where id = 'pay_2004'`, then reconcile | `refunds.issue.conserves_payments` fails, `refunds.issue` halts, refunds now return `halted` while every other capability keeps serving; an admin cannot clear it until the data is repaired |

Everything above is visible in the **Audit log** tab as a supervisor, including every denial.

## Two tiers of change

|  | Tier 1 — build an app | Tier 2 — extend the platform |
| --- | --- | --- |
| May touch | `apps/console/src/apps/*`, docs | the kernel, tenets, migrations, capabilities, SDK |
| Consumes | existing capabilities and tenets | defines new ones |
| Review | does the screen do the job? | what can no longer be proved, and what now can? |
| Extra required | — | adversarial DB tests, a change record, explicit human sign-off |
| Enforced by | `npm run lint` fails if an app imports the platform | `npm run lint` fails if a platform edit has no change record; `npm test` fails if a derived tenet has no test |

The point of the split: most work should be fast and unsupervised, and the work that can weaken
a guarantee should be neither.

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
| `npm run lint` | Boundary check (apps may not import the db, kernel, capabilities, or call `fetch`) and tier check (a platform edit needs a change record) |
| `npm test` | Kernel policy-declaration and tenet-derivation tests, including that every derived tenet is attacked by a database test |
| `npm run test:db` | The invariants, attacked against a real database |
| `npm run reconcile` | One-shot tenet check; exits non-zero on a violation |

## Documentation

- [Architecture](docs/architecture.md) — the trust boundary and the invocation pipeline in detail
- [Authoring a capability](docs/authoring-a-capability.md) — the workflow humans and Devin share
- [Decisions](docs/adr) — why it is built this way, and what was deliberately not built
- [Playbook, tier 1](docs/devin/playbook-build-an-app.md) — build an app from what exists
- [Playbook, tier 2](docs/devin/playbook-extend-the-platform.md) — the only route that may change a
  tenet, a capability or a migration, and what the extra human review is for
- [Platform changes](docs/platform-changes) — what each tier-2 change did to the guarantees

## Status

Framework and one worked example. The three target apps (customer review queues, refunds
dashboard, feature flag admin) are intentionally not built yet: `refunds.issue` exists to prove
the enforcement path, not to be the product.
