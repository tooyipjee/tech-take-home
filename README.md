# Internal Tool Platform

One framework, one Postgres database, many small back-office apps talking to it — and a layer in
between that decides what each app is allowed to do.

The apps (refund queue, review queue, flag admin) are written by Devin, so nothing load-bearing
may live in them: an app can only call **capabilities**, and every capability declares its
policy — who may call it, how much money it may move, how often, whether it needs a second
person's approval. The runtime enforces that declaration; the app cannot bypass it, because the
app never touches the database.

```
apps/<app-name>          a screen, written by Devin
                         invoke("refunds.issue", { paymentId, amountCents })
─────────────────────────────────────────────────────────  trust boundary
packages/capabilities    capability = declared policy + handler, human-reviewed
packages/kernel          runtime: scope → validate → rate → ceiling → approval
                                  → execute → audit → invariants (or roll back)
packages/db              Postgres: one database, append-only history,
                                   constraints and triggers
```

Three back-office apps, one guard layer, one database. Everything the platform refuses — over
the ceiling, unapproved, out of scope, replayed — is refused in the same place, once.

## Run it

```bash
npm install
npm run setup     # Postgres in Docker, migrate, seed
npm run dev       # api :8080 · console :5173 · refunds :5175 · review queue :5176 · kyc :5174
```

Open the console at <http://localhost:5173>. Its **Apps** tab is the launcher: every app folder's
`app.json` becomes a tile, offered or locked according to the signed-in principal's scopes. The
**signed in as** switcher in the header is a mock identity provider — it picks the principal
(Avery, agent · Sam, supervisor · Robin, admin), the API reads it from the `x-platform-user`
header, and it stands in for an OAuth2/OIDC sign-in (swapping it for the real thing changes
`resolvePrincipal` and nothing else). Tile availability is presentation only; the runtime
re-checks scopes on every capability call.

## Drive it

Each row is a rule being enforced somewhere the app can't reach:

| Do this | What happens | Enforced by |
| --- | --- | --- |
| As **Avery**, refund $42 on `pay_2001` | `ok` — money moved and audited in one transaction | — |
| Refund $600 on `pay_2003` | `pending_approval`; the handler never ran | `approval.above_amount: 50000` |
| Switch to **Sam** → *Approvals* → Approve | the runtime replays the request as Avery under a grant only it can mint | approver scope |
| Back as Avery, refund $2,500 on `pay_2004` | `denied_limit` | `limits.maxAmountCents` |
| As Avery, open the **Audit log** tab | `403` — and the denial is itself audited | `audit:read` scope |
| Open **Invariants** → *Reconcile now* | every rule re-proved against committed data, each showing what it was derived from | — |
| In `psql`: `update payments set amount_cents = 1000 where id = 'pay_2004'`, then reconcile | `refunds.issue.conserves_payments` fails → `refunds.issue` halts and returns `halted`; other capabilities keep serving; an admin cannot clear the halt until the data is repaired | reconciler |

The **Audit log** tab (as Sam) is the whole story: every call, its outcome, its amount, and who
made it.

## Test it

```bash
npm test          # policy declarations and the rules derived from them
npm run test:db   # those rules, attacked against a real Postgres
npm run lint      # boundary check + tier check (see below)
npm run typecheck
npm run reconcile # one-shot check of committed data; non-zero exit on a violation
```

`npm run test:db` is the interesting one. It doesn't test the happy path — it inserts refunds by
raw SQL, forges audit rows, edits history, and runs a handler that moves ten times what it
declared, then asserts the database or the runtime stopped it.

CI is split the same way the work is. `.github/workflows/framework.yml` runs the whole list
above, including the adversarial suite against a Postgres service container and migrations
applied to an empty database, whenever anything under `packages/`, `apps/api/` or `scripts/`
changes. `.github/workflows/apps.yml` runs on app changes only and does just boundary check,
typecheck and build — an app cannot weaken a guarantee, so re-proving them on every app PR would
be theatre.

## How the rules work

A rule here is an **invariant**: one SQL statement over committed data that must return zero
rows. Not a hand-picked list — each is derived from either a platform axiom ("an effect nobody
audited did not legitimately happen") or from the policy a human already reviewed:

```ts
policy: {
  limits: { maxAmountCents: 200_000, maxPerHour: 10 },
  approval: { mode: "above_amount", amountCents: 50_000 },
  idempotent: true,
  effect: {                                    // where the money lands
    table: "refunds", amountColumn: "amount_cents",
    conserves: { table: "payments", via: "payment_id", amountColumn: "amount_cents" },
  },
}
```

That block generates `refunds.issue.{respects_declared_ceiling, carries_the_declared_approval,
respects_declared_rate, is_idempotent, effects_are_attributed, conserves_payments}` — and the
thresholds inside the generated SQL are read back out of the registry, so a rule can never drift
from the declaration it polices. A capability that moves money without declaring an `effect`
refuses to start.

Each invariant is then proved three times: by the database (constraints, append-only triggers),
as a postcondition inside the writing transaction (fails → the money rolls back, the refusal is
audited), and by a reconciler on a timer (fails → the capabilities that rule guards are halted).
Why three: see [ADR 0006](docs/adr/0006-invariants-are-enforced-three-times.md).

## Two tiers of change

|  | Tier 1 — build an app | Tier 2 — extend the platform |
| --- | --- | --- |
| May touch | `apps/<app-name>/*`, docs | kernel, invariants, migrations, capabilities, SDK |
| Uses | existing capabilities and rules | defines new ones |
| Review | does the screen do the job? | what can no longer be proved, and what now can? |
| Also required | — | adversarial DB tests, a change record, human sign-off |
| Enforced by | `npm run lint` fails if an app imports the platform | `npm run lint` fails if a platform edit has no change record; `npm test` fails if a derived rule has no test attacking it |

Most work should be fast and unsupervised; the work that can weaken a guarantee should be
neither.

## Layout

| Path | What it is |
| --- | --- |
| `packages/kernel` | Registry, policy types, invocation runtime, audit, invariants, reconciler |
| `packages/capabilities` | The reviewed surface: refunds, feature flags, review queue |
| `packages/db` | Migrations, seed, and the `DataSource` handlers are bound to |
| `packages/sdk` | The only thing an app may import |
| `packages/app-kit` | What an app gets besides the SDK: bound client, identity switcher, outcome banner, stylesheet |
| `apps/api` | Fastify host: identity, invocation, approvals, audit, invariants |
| `apps/console` | Platform surface: approvals, audit log, capability registry, invariants, app launcher |
| `apps/refunds` | Refunds — an app |
| `apps/review-queue` | Customer review queue — an app |
| `apps/kyc-review` | KYC review queue — an app |

`packages/*` is the platform: the trust boundary, the data layer, and the only surfaces an app may
import (`@platform/sdk`, `@platform/app-kit`). `apps/*` is everything above it, one folder per
deployable. The console is not an app either — it is the platform's own screens plus a launcher.

**A new app is a new folder.** Copy the shape of `apps/review-queue`: a `package.json`, an
`index.html`, a `vite.config.ts` with its own port, `src/`, and an `app.json` describing the app
(name, url, scopes). Add a `dev:<name>` script at the root, and that is the whole ceremony — the
launcher discovers every `apps/*/app.json` and the boundary check picks up every folder under
`apps/` automatically, so the new app shows up on the launcher and is held to `@platform/sdk`
from its first commit without anyone remembering to list it. Restart `npm run dev` after adding
the folder: the new app needs its dev server, and the console's Vite watcher only re-globs
`app.json` files on startup.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run setup` | Postgres up, migrate, reset + seed |
| `npm run dev` | API, console and every app together |
| `npm run dev:refunds` | Just the refunds app, on :5175 |
| `npm run dev:queue` | Just the customer review queue, on :5176 |
| `npm run dev:kyc` | Just the KYC review queue, on :5174 |
| `npm run db:reset` | Wipe transactional state, re-seed |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm run lint` | Boundary check (apps may not import the db, kernel, capabilities, or call `fetch`) and tier check (a platform edit needs a change record) |
| `npm test` | Kernel policy-declaration and invariant-derivation tests, including that every derived invariant is attacked by a database test |
| `npm run test:db` | The invariants, attacked against a real database |
| `npm run reconcile` | One-shot invariant check; exits non-zero on a violation |

## Documentation

- [Architecture](docs/architecture.md) — the trust boundary and the invocation pipeline in detail
- [Authoring a capability](docs/authoring-a-capability.md) — the workflow humans and Devin share
- [Decisions](docs/adr) — why it is built this way, and what was deliberately not built
- [Playbook, tier 1](docs/devin/playbook-build-an-app.md) — build an app from what exists
- [Playbook, tier 2](docs/devin/playbook-extend-the-platform.md) — the only route that may change
  a rule, a capability or a migration
- [Platform changes](docs/platform-changes) — what each tier-2 change did to the guarantees

## Status

Framework plus one worked example. The target apps are deliberately not built yet:
`refunds.issue` exists to prove the enforcement path, not to be the product.
