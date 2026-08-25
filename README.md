# Internal Tool Platform

One framework, one Postgres database, back-office apps talking to it — and a layer in between
that decides what each app is allowed to do.

The apps are written by Devin, so nothing load-bearing may live in them: an app can only call
**capabilities**, and every capability declares its policy — who may call it, how often, whether
it needs a second person's approval, and where its effect lands. The runtime enforces that
declaration; the app cannot bypass it, because the app never touches the database.

Today the repository contains exactly one app, the KYC review queue, and the whole platform is
proved against it.

```
apps/kyc-review          a screen, written by Devin
                         invoke("kyc.case.approve", { caseId, revision, note })
─────────────────────────────────────────────────────────  trust boundary
packages/capabilities    capability = declared policy + handler, human-reviewed
packages/kernel          runtime: scope → validate → rate → ceiling → approval
                                  → execute → audit → invariants (or roll back)
packages/db              Postgres: one database, append-only history,
                                   constraints and triggers
```

Everything the platform refuses — out of scope, unapproved, over the rate, replayed, stale — is
refused in the same place, once.

## Run it

```bash
npm install
npm run setup     # Postgres in Docker, migrate, seed
npm run dev       # api :8080 · console :5173 · kyc review queue :5174
```

Open the console at <http://localhost:5173>; its **Apps** tab links to the KYC app. There is no
login; the **acting as** switcher picks the principal (Avery, reviewer · Sam, lead · Robin and
Dana, compliance) and the API reads it from the `x-platform-user` header. Two compliance officers
exist because four-eyes plus a compliance-only approval tier means a request raised by the only
officer could never be cleared.

## Drive it

Each row is a rule being enforced somewhere the app can't reach:

| Do this | What happens | Enforced by |
| --- | --- | --- |
| As **Robin**, approve `KYC-1041` (low risk, clean) | `ok` — the decision and its audit row commit together | — |
| As **Avery**, approve `KYC-1043` | `denied_scope` — a reviewer does not hold `kyc:decide` | `policy.scope` |
| As **Robin**, approve `KYC-1043` (high risk) | `pending_approval`; the handler never ran | `approval.derived_from_subject`, asked of the case in SQL |
| Approve your own request in **Approvals** | denied — four-eyes | `approvals.decided_by_a_second_person` |
| As **Sam**, clear the approval on `KYC-1045` (unresolved OFAC hit) | denied — that case demands an approver holding `kyc:sar` | the clause stored with the request |
| **Reveal PII** on any case | needs a justification, metered at 20/hour, and audited on its own | `kyc.case.pii.reveal` |
| Decide the same case twice, or from a stale tab | `conflict`, and a double-click replays instead of deciding twice | revision + idempotency key |
| Open **Invariants** → *Reconcile now* | every rule re-proved against committed data, each showing what it was derived from | — |
| In `psql`: delete a decision's audit row, then reconcile | `kyc.case.approve.effects_are_attributed` fails → that capability halts and returns `halted`; every other capability keeps serving | reconciler |

The **Audit log** tab (as Sam) is the whole story: every call, its outcome, and who made it —
including the refusals.

## Test it

```bash
npm test          # policy declarations and the rules derived from them
npm run test:db   # those rules, attacked against a real Postgres
npm run lint      # boundary check + tier check (see below)
npm run typecheck
npm run reconcile # one-shot check of committed data; non-zero exit on a violation
```

`npm run test:db` is the interesting one. It doesn't test the happy path — it writes decisions by
raw SQL with no invocation behind them, forges audit rows to fake a rate limit and an idempotency
replay, tries to rewrite history, approves as the requester, and approves a sanctions case as a
supervisor, then asserts the database or the runtime stopped it.

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
  scope: "kyc:decide",
  limits: { maxAmountCents: null, maxPerHour: 50 },
  idempotent: true,
  subject: { table: "kyc_cases", idField: "caseId" },
  approval: {
    mode: "derived_from_subject",          // asked of the case, not of the input
    clauses: [
      { when: "unresolved sanctions hit", approverScope: "kyc:sar", because: "…" },
      { when: "s.risk_band = 'high' or any unresolved hit", approverScope: "kyc:decide", because: "…" },
    ],
  },
  effect: {                                 // where the decision lands
    table: "kyc_case_decisions", subjectColumn: "case_id", oncePerSubject: true,
  },
}
```

That block generates `kyc.case.approve.{carries_the_declared_approval, respects_declared_rate,
is_idempotent, effects_are_attributed, happens_at_most_once_per_subject}` — and the thresholds and
clauses inside the generated SQL are read back out of the registry, so a rule can never drift from
the declaration it polices. A write capability that declares no `effect` refuses to register,
because nothing could be derived for it.

The same clauses answer two different questions: the runtime asks them *before* the write to
decide whether to suspend it, and the invariant asks them *after* the fact of committed rows. The
app asks neither — `kyc.cases.get` returns what the runtime would demand, so the UI can warn a
reviewer without keeping a second copy of the rule.

Each invariant is then proved three times: by the database (constraints, append-only triggers),
as a postcondition inside the writing transaction (fails → the effect rolls back, the refusal is
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
| `packages/capabilities` | The reviewed surface: the `kyc.*` capabilities |
| `packages/db` | Migrations, seed, and the `DataSource` handlers are bound to |
| `packages/sdk` | The only thing an app may import |
| `packages/app-kit` | What an app gets besides the SDK: bound client, identity switcher, outcome banner, stylesheet |
| `apps/api` | Fastify host: identity, invocation, approvals, audit, invariants |
| `apps/console` | Platform surface: approvals, audit log, capability registry, invariants, app launcher |
| `apps/kyc-review` | KYC review queue — the app |

`packages/*` is the platform: the trust boundary, the data layer, and the only surfaces an app may
import (`@platform/sdk`, `@platform/app-kit`). `apps/*` is everything above it, one folder per
deployable. The console is not an app either — it is the platform's own screens plus a launcher.

**A new app is a new folder.** Copy the shape of `apps/kyc-review`: a `package.json`, an
`index.html`, a `vite.config.ts` with its own port, and `src/`. Add a `dev:<name>` script at the
root, add a row to the launcher in `apps/console/src/Launcher.tsx`, and that is the whole
ceremony — the boundary check picks up every folder under `apps/` automatically, so the new app is
held to `@platform/sdk` from its first commit without anyone remembering to list it.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run setup` | Postgres up, migrate, reset + seed |
| `npm run dev` | API, console and the app together |
| `npm run dev:kyc` | Just the KYC review queue, on :5174 |
| `npm run db:reset` | Wipe transactional state, re-seed |
| `npm run typecheck` | `tsc --noEmit` across the workspace |
| `npm run lint` | Boundary check (apps may not import the db, kernel, capabilities, or call `fetch`) and tier check (a platform edit needs a change record) |
| `npm test` | Kernel policy-declaration and invariant-derivation tests, including that every derived invariant is attacked by a database test |
| `npm run test:db` | The invariants, attacked against a real database |
| `npm run reconcile` | One-shot invariant check; exits non-zero on a violation |

## Documentation

- [Architecture](docs/architecture.md) — the trust boundary and the invocation pipeline in detail
- [KYC review queue](docs/apps/kyc-review-queue.md) — the app, its capabilities and its policy
- [Authoring a capability](docs/authoring-a-capability.md) — the workflow humans and Devin share
- [Decisions](docs/adr) — why it is built this way, and what was deliberately not built
- [Playbook, tier 1](docs/devin/playbook-build-an-app.md) — build an app from what exists
- [Playbook, tier 2](docs/devin/playbook-extend-the-platform.md) — the only route that may change
  a rule, a capability or a migration
- [Platform changes](docs/platform-changes) — what each tier-2 change did to the guarantees

## Status

One framework, one database, one app. KYC review is the product; everything under `packages/` is
what makes the next app a prompt rather than a project.
