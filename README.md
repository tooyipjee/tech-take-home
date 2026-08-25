# Internal Tool Platform

![The console's Apps tab: the KYC review queue discovered from its app.json, signed in as a
compliance officer](docs/images/launcher.png)

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

Open the console at <http://localhost:5173>. Its **Apps** tab is the launcher: every app folder's
`app.json` becomes a tile, offered or locked according to the signed-in principal's scopes — today
there is one, the KYC review queue. The **signed in as** switcher in the header is a mock identity
provider: it picks the principal (Avery, reviewer · Sam, lead · Robin and Dana, compliance), the API
reads it from the `x-platform-user` header, and it stands in for an OAuth2/OIDC sign-in (swapping it
for the real thing changes `resolvePrincipal` and nothing else). Two compliance officers exist
because four-eyes plus a compliance-only approval tier means a request raised by the only officer
could never be cleared. Tile availability is presentation only; the runtime re-checks scopes on
every capability call.

## The three tiers

Every change to this repository is one of three kinds, and the kind decides how much review it
gets. Each PR carries the matching label.

| | **Tier 1 — build an app** | **Tier 2 — extend the platform** | **Tier 3 — change the infrastructure** |
| --- | --- | --- | --- |
| Label | `tier-1: app` | `tier-2: platform` | `tier-3: infrastructure` |
| Touches | `apps/<app-name>/` | kernel, capabilities, migrations, `DataSource`, SDK, the check scripts | CI, the console shell and launcher, the API host, build tooling, the environment |
| Does what | Composes capabilities and invariants that already exist | Adds or changes what the platform can promise | Changes how the whole thing is built, shipped and checked |
| Written by | Devin, unsupervised | Devin from a human spec | Elevated humans, with Devin assisting |
| Reviewed for | Does the screen do the job? | What can no longer be proved, and what now can? | Everything downstream: it changes every tier below it |
| Also required | — | Adversarial database tests and a change record under `docs/platform-changes/` | Same, plus agreement from someone who owns the platform |
| Held to it by | `npm run lint` fails if an app imports the kernel, the database or a capability handler, or if its `app.json` claims a scope no role holds | `npm run lint` fails if a platform edit has no change record; `npm test` fails if a derived invariant has no test attacking it | Convention and review — deliberately not automated |

The point of the split is that **tier 1 is cheap because tier 2 was expensive**. An app cannot
weaken a guarantee, so app work needs no ceremony; the work that *can* weaken one gets all of it.
When a tier-1 request needs a verb that does not exist, the correct outcome is to stop and escalate
— never to solve it in app code.

`npm run lint` prints the tier it detected and the label to apply, so the classification is not a
judgement call at PR time.

## The playbooks

Devin writes the apps, so the playbooks *are* the interface to this repository. There is one per
tier:

- **[Tier 1 — build an app](docs/devin/playbook-build-an-app.md).** Starts by deciding whether the
  request is tier 1 at all, maps every screen action to an existing capability, and refuses to
  invent one. The output is a folder under `apps/` and a PR labelled `tier-1: app`.
- **[Tier 2 — extend the platform](docs/devin/playbook-extend-the-platform.md).** The only route by
  which a capability, scope, migration or invariant may change: spec first, invariants named in
  English before any SQL, declaration over hand-written rules, adversarial tests, a change record,
  human sign-off. The output is a PR labelled `tier-2: platform`.
- Tier 3 has no playbook on purpose. Infrastructure changes are agreed with a platform owner first.

[Two apps, two tiers](docs/devin/demo-two-apps.md) works through what this means for the next two
apps: a feature-flag admin is a cheap tier-2 extension followed by a tier-1 screen; a refunds
dashboard is the expensive one, because money moving means a ceiling, a threshold approval and a
conservation invariant.

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

## Watch it refuse things

Everything above is easier to believe after watching the platform say no. Each row is a rule
enforced somewhere an app cannot reach it; the **Audit log** tab (as Sam) then shows every one of
them, refusals included.

<details>
<summary>A walkthrough of nine refusals, in the console and the KYC queue</summary>

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

</details>

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
`index.html`, a `vite.config.ts` with its own port, `src/`, and an `app.json` describing the app
(name, url, scopes). That is the whole ceremony: nothing lists the apps. `npm run dev`,
`npm run build:apps`, `npm run typecheck`, the boundary check and the console launcher all
discover every folder under `apps/`, so a new app runs, builds, typechecks, is held to
`@platform/sdk` and appears on the launcher from its first commit without anyone remembering to
wire it up — and `npm run lint` fails if its `app.json` points at the wrong port or claims a scope
no role holds. Restart `npm run dev` after adding the folder: the new app needs its dev server,
and the console's Vite watcher only re-globs `app.json` files on startup.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run setup` | Postgres up, migrate, reset + seed |
| `npm run dev` | API plus every app folder, discovered rather than listed |
| `npx vite --config apps/kyc-review/vite.config.ts` | One app alone (with `npm run dev:api` beside it) |
| `npm run db:reset` | Wipe transactional state, re-seed |
| `npm run typecheck` | The platform and the API, then each app against its own tsconfig |
| `npm run build:apps` | Production build of every app folder |
| `npm run lint` | Boundary check (apps may not import the db, kernel, capabilities, or call `fetch`; every `app.json` names a real port and real scopes) and tier check (a platform edit needs a change record) |
| `npm test` | Kernel policy-declaration and invariant-derivation tests, including that every derived invariant is attacked by a database test |
| `npm run test:db` | The invariants, attacked against a real database |
| `npm run reconcile` | One-shot invariant check; exits non-zero on a violation |

## Documentation

- [Architecture](docs/architecture.md) — the trust boundary and the invocation pipeline in detail
- [KYC review queue](docs/apps/kyc-review-queue.md) — the app, its capabilities and its policy
- [Authoring a capability](docs/authoring-a-capability.md) — the workflow humans and Devin share
- [Decisions](docs/adr) — why it is built this way, and what was deliberately not built
- [Playbook, tier 1](docs/devin/playbook-build-an-app.md) ·
  [Playbook, tier 2](docs/devin/playbook-extend-the-platform.md) ·
  [Two apps, two tiers](docs/devin/demo-two-apps.md)
- [Platform changes](docs/platform-changes) — what each tier-2 change did to the guarantees

## Status

One framework, one database, one app. KYC review is the product; everything under `packages/` is
what makes the next app a prompt rather than a project.
