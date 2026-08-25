# Playbook — build on Rangka

There is one playbook. You are given a paragraph of intent and you decide, out loud, what kind of
change it is; the tier is an output of triage, not something the user has to know before asking.

Attach the knowledge note in
[`knowledge-platform-conventions.md`](knowledge-platform-conventions.md).

```
spec → triage → tier 1: compose existing capabilities            → PR (tier-1: app)
              → tier 2: extend the platform, then compose        → PR (tier-2: platform, escalated)
              → tier 3: infrastructure                           → stop, do not build
```

## What the user provides

A paragraph of intent in risk terms, e.g.:

> Compliance leads need one screen showing every case waiting on a second signature, who raised it,
> what the platform decided it needs, and the audit trail behind it. No new decisions are taken here.

They are not expected to say which tier it is. That is your first job.

---

# Phase A — triage

Do this before writing anything, and put the verdict in your first message: **what exists already,
what you will build, which tier it is, and what that means for review.**

### A1. Does it already exist?

Run the platform (`npm run setup && npm run dev`) and look, rather than guessing:

- `apps/*/app.json` — every app and the scopes it uses. The console's **Apps** tab is the same list.
- `GET /api/capabilities` — every verb, with its full policy declaration.
- `GET /api/invariants` — what is already proved about those verbs.

Three outcomes, in order of preference:

| You find | Do |
| --- | --- |
| An app that already does this | Say so and stop. Ask what is missing from it rather than shipping a second screen over the same verbs |
| An app that is one view away from doing this | **Extend that app.** A tab or a panel in an existing folder beats a new tile competing for the same job |
| Nothing close | Build a new app — a new folder under `apps/` |

### A2. Which tier?

Tier 1 is when **every verb the screen needs already exists** and every scope it needs is already
held by a role. Anything else is tier 2.

| The change needs… | Tier | Why |
| --- | --- | --- |
| Only existing capabilities | 1 | Nothing the platform promises changes |
| A different UI over the same verbs | 1 | This is the case Rangka is optimised for |
| A capability that does not exist | 2 | A new verb is a new promise |
| A new table, column or seed row | 2 | Migrations are database-enforced invariants |
| A new scope, or a role to hold an existing one | 2 | `ROLE_SCOPES` is the kernel |
| A different ceiling, rate or approval threshold | 2 | Those numbers are the reviewed artifact |
| A change to CI, the API host, the console shell, the launcher or the build | 3 | How the proving happens, not what is proved |

The honest state of the repository today: the capability surface is `kyc.*` plus the platform's own
reads (approvals, audit, capability registry, invariants). A pure tier-1 app is therefore some other
view of that surface. **Any app in a new domain — refunds, feature flags, chargebacks — begins with
tier 2**, and pretending otherwise in app code is the failure this playbook exists to prevent.

You do not need permission to proceed with tier 2 — you build it. What changes is the review it
carries (phase C) and how loudly the PR says so.

**Tier 3 is where you stop.** A change to how the proving happens is worth more to an attacker than
a change to what is proved, so it is agreed with a platform owner rather than done unsupervised. If
the diff needs it, split the infrastructure part out or report and stop.

### A3. Say the verdict

First message, before any code:

> Existing: `kyc-review` and `sar-desk` cover X and Y; neither shows Z.
> Building: a new app `apps/<name>` (or: a tab in `apps/<existing>`).
> Tier 2 — it needs `kyc.case.reopen`, which does not exist. That means a change record, adversarial
> database tests, and a human review of the policy declaration before merge.

---

# Phase B — tier 1: compose what exists

1. **Read the boundary first.** `docs/architecture.md` and `docs/authoring-a-capability.md`. The
   constraints there are the whole point of Rangka, and violating them fails `npm run lint`.
2. **Inventory the verbs.** List every read and write the screen needs, and name the existing
   capability that serves each one, with the policy it already declares (`scope`, `maxAmountCents`,
   `maxPerHour`, `approval`). Those numbers are risk decisions the user has already made: build
   around them rather than asking for them to be changed.
3. **If a verb is missing, do not work around it in app code.** Go to phase C, then come back here.
4. **Read the invariants** the flows depend on (`GET /api/invariants`, or
   `packages/kernel/src/invariants.ts`) so you do not re-check in the app what the platform proves.
5. **Write the app** in its own folder, `apps/<app-name>/`, copying the shape of `apps/kyc-review`.
   The whole folder is:

   | File | Notes |
   | --- | --- |
   | `package.json` | `@rangka/<app-name>`, `private`, the same react/eslint deps |
   | `index.html`, `src/` | It may import `@rangka/sdk` and `@rangka/app-kit`, nothing else |
   | `vite.config.ts` | An unused port, `proxy: { "/api": "http://localhost:8080" }`, and the `@rangka/*` aliases |
   | `tsconfig.json` | Extends the root one; every app owns its own typecheck |
   | `app.json` | `id`, `name`, `description`, `folder`, `url` (the port above), `scopes`, `requiredScopes` |

   Run `npm install` once after creating `package.json` so the workspace links.
6. **Do not wire it up anywhere else.** There is no list to add the app to: `npm run dev`,
   `npm run build:apps`, `npm run typecheck`, the boundary check and the console launcher all
   discover folders under `apps/`. Restart `npm run dev` afterwards — the new app needs a dev
   server, and the launcher only re-globs `app.json` at startup.
7. **Get the policy from the platform, never from a constant.** Render scopes, limits and approval
   requirements from the served declaration (`GET /api/capabilities`, and `previewApproval`-backed
   fields such as `kyc.cases.get`'s `decisionApproval`). A copy of a threshold in app code is a
   second source of truth that goes stale silently.
8. **Leave buttons enabled that the current user cannot use.** Disabling them hides the guarantee.
   Let the runtime refuse and render the refusal — that is the demo.
9. **Verify** with `npm run lint && npm run typecheck && npm test`, then exercise the app in the
   browser as each seeded role, including at least one denial and one approval path, and confirm
   the tile appears on the launcher — offered to a role that holds `requiredScopes`, locked for one
   that does not.

Then go to phase D.

## Hard rules for app code

- Never put an authorisation, limit, approval or audit check in app or handler code. If you feel
  the need for one, you have found either a missing scope or a missing runtime feature — say so
  instead of implementing it.
- Never import `pg`, `@rangka/db`, `@rangka/kernel` or `@rangka/capabilities` from an app.
- Never call `fetch` from an app; use the SDK.
- Never add a capability that takes a table name, a SQL fragment, or an arbitrary filter object.
- Never declare a scope in `app.json` that no role holds — the tile is then permanently locked, and
  the boundary check fails. Needing the scope is a phase-C escalation, not a manifest edit.
- Never treat a `halted` or `invariant_violation` outcome as a bug to route around. Surface it: the
  platform is telling the user it can no longer prove the operation is safe.

## Outcomes an app must render

`ok`, `replayed`, `pending_approval`, `denied_scope`, `denied_limit`, `rate_limited`,
`invalid_input`, `not_found`, `halted`, `invariant_violation`, `error`. All of them are normal
platform behaviour; none of them should reach the user as a stack trace.

---

# Phase C — tier 2: extend the platform

This is the only route by which a capability, a scope, a `DataSource` method, a migration or an
invariant may change, because those changes alter what Rangka can promise. Everything here is
reviewed by a human before it merges, and the review is not "does this code look right?" — it is
**"what can no longer be proved, and what now can?"** Your job is to make that question cheap to
answer. A tier-2 PR a reviewer has to reverse-engineer has failed even if the code is correct.

A new domain is one PR with a predictable spine: migration → seed → `DataSource` methods →
capability declarations → derived invariants → adversarial database tests → change record →
knowledge. Beyond that spine:

| The domain… | Extra work |
| --- | --- |
| …moves no money and needs no second signature | None. `approval: { mode: "never" }`, an effect table, and the derived rate/idempotency/attribution invariants come free |
| …moves money | `amountField`, `maxAmountCents`, and an `effect.conserves` pool so the conservation invariant can be derived; `approval: { mode: "above_amount" }` |
| …needs a second signature that depends on the *record* | `approval: { mode: "derived_from_subject" }` and a `subject` on the capability — see C5 |
| …has an action that may happen only once per record | `effect.oncePerSubject`, which derives both a unique index expectation and an invariant |

1. **Write the spec before the code.** One paragraph: the verb, who may call it, what it changes,
   the worst thing it could do if the handler were wrong. Get the user to confirm the policy numbers
   explicitly. Do not proceed on inference.
2. **Name the invariants first**, in English, for every new money-moving or state-changing effect.
   If you cannot state one, you do not yet understand the effect well enough to ship it.
3. **Decide where each invariant is enforced.** Prefer the lowest layer that can hold it:
   - a **database constraint or trigger** if it can be expressed over rows — it survives a bug in
     the kernel and a human with `psql`;
   - a **postcondition** (`postconditionFor`) if it needs the transaction's own view — it rolls the
     money back before it commits;
   - the **reconciler** (`halts`) for everything, always — it is what notices drift that arrived by
     a path nobody anticipated.

   Most invariants belong in all three. Note in the change record why any layer was skipped.
4. **Prefer declaring over writing.** Most invariants should not be written at all: state them in
   the capability's `policy` (`limits`, `approval`, `idempotent`) and its `effect` (the table, the
   amount column, the live-row predicate, the pool it draws down), and
   `packages/kernel/src/invariants.ts` generates the SQL that proves them. Hand-write an invariant
   only for something no declaration can express — and then argue in the change record why it is an
   axiom rather than a property of one capability. Whichever route, the query returns zero rows when
   the invariant holds and one row per violation, with `subject` and `detail`, and reads thresholds
   from `capability_registry` rather than hard-coding them.
5. **If the requirement depends on the record, extend the declaration, not the handler.** The
   temptation, when "does this need a second person?" depends on the row (risk band, an unresolved
   screening hit, an account's standing), is to answer it in the handler or — worse — in the app.
   Both put policy where no invariant can read it. The mechanism is
   `approval: { mode: "derived_from_subject", clauses: [...] }`: each clause is SQL over the subject
   row aliased `s`, carrying the `approverScope` it demands and a `because` the UI can show. First
   match wins.

   Three properties to preserve if you touch this: the resolved scope is written **onto the approval
   row** when the request is raised, so editing the clauses later cannot lower the bar on something
   already waiting; `previewApproval()` answers the same question without performing the write,
   which is how an app warns the user without holding a copy of the rule; and the derived
   `carries_the_declared_approval` invariant re-evaluates the same clauses over committed data, so
   the rule is proved rather than merely applied.
6. **Add the migration** in `packages/db/migrations/`. Additive only. Never drop or weaken an
   existing constraint in the same change as a feature; that is its own PR with its own argument.
   New effect tables need an `invocation_id` with the not-null trigger and the FK to `audit_log`, or
   their rows will not be attributable to an audited invocation.
7. **Add the capability** in `packages/capabilities`, and any `DataSource` method it needs in
   `packages/db/src/datasource.ts`. Handlers still see only `input` and `ctx.data`; no SQL in a
   handler, no invocation id passed by the caller.
8. **Map failures onto the outcome vocabulary the apps already render.** A new failure mode that
   surfaces as `error` is a failure mode nobody handles. A repeated or conflicting write is
   `conflict` — raise `StaleRevisionError` from the `DataSource` rather than letting a unique index
   fail late; a refused write is `denied_*`; a paused capability is `halted`. Adding a *new* outcome
   means every app must learn to render it: avoid it if an existing one is honest.
9. **Add adversarial tests** in `packages/kernel/test/db/`. An invariant with no test is a sentence,
   not a guarantee — and `npm test` fails if a derived invariant is not named by a database test.
   Update the expected derived set in `packages/kernel/test/invariants.test.ts`; that assertion
   failing is the signal that a declaration changed and needs review. For each new invariant, prove:
   - the write is refused or rolled back when the invariant would break, and the refusal is still
     audited;
   - the same attack through direct SQL is refused by the database;
   - the reconciler notices state that was corrupted outside the runtime;
   - the guarded capability halts, unrelated capabilities and reads keep serving;
   - the halt cannot be cleared while the data is still wrong, and can be after repair.
10. **Write the change record** under `docs/platform-changes/`, with the sections
    `## Invariants affected`, `## How it was verified` and `## Rollback`. `npm run lint` requires it:
    a platform edit with no change record fails the tier check. State which invariants appear,
    disappear and change meaning — a *removed* invariant is the sentence a reviewer must not miss.
    The tier check also greps for the invariant-coverage test by name, so renaming that test is a
    deliberate act, not a tidy-up.
11. **Grant the scopes, seed the data, and prove the migration from empty.** A capability whose scope
    no role holds is unreachable, and a launcher tile naming it is permanently locked (the boundary
    check fails on exactly that). Update `ROLE_SCOPES` in `packages/kernel/src/auth.ts` and the seed
    in `packages/db/src/seed.ts` in the same PR. If the migration is destructive, or edits a file
    that has already run, say so in the PR: collaborators need `npm run db:down && npm run setup`,
    and CI applies migrations to an empty database precisely to catch what only works against your
    volume.
12. **Update the knowledge** in
    [`knowledge-platform-conventions.md`](knowledge-platform-conventions.md) so later sessions can
    find the new verb without reading the kernel. A capability nobody knows about is a capability
    that gets rebuilt badly in app code.
13. **Verify** with `npm run lint && npm run typecheck && npm test && npm run test:db &&
    npm run reconcile && npm run build:apps`, then exercise the flow in the console as each seeded
    role. Update the testing skills under `.agents/skills/` if the flows they describe changed — a
    skill describing a capability you deleted is worse than no skill.

Then go back to **phase B**: the UI over the new verbs is ordinary tier-1 work and should need
nothing but the capabilities you just declared.

## Hard rules for platform code

- Never weaken or delete an invariant in the same PR as a feature. Separate PR, explicit argument,
  named reviewer.
- Never disable a trigger or constraint to make a test pass. If an invariant blocks a legitimate
  flow, the invariant is wrong and fixing it is the work.
- Never let a handler write an effect row the platform cannot attribute to an invocation.
- Never clear a halt to unblock yourself. Repair the data; the halt clears itself when the invariant
  passes.
- Never move an authorisation, limit or audit decision out of the runtime and into a handler.

---

# Phase D — the PR, and asking for the right review

CI derives the label from the paths in the diff and applies it; `npm run lint` prints the same
answer locally. It is a check on your triage, not a decision you make — **if the label disagrees
with the tier you announced in phase A, your triage was wrong, and the PR description has to say
so.**

| Label | Means | The PR must |
| --- | --- | --- |
| `tier-1: app` | Only app folders changed | Say which existing capabilities it composes and which outcomes it renders. Review is "does the screen do the job?" |
| `tier-2: platform` | The kernel, capabilities, migrations, the SDK or the checks changed | **Escalate: say plainly that this changes what the platform can promise and needs more than one reviewer.** Lead with the invariant table from the change record and the policy declarations, and ask for review explicitly. Do not merge on green CI alone |
| `tier-3: infrastructure` | CI, the API host, the console shell or the build changed | Not this playbook's job. Split it out, or stop and agree it with a platform owner |

A tier-2 PR opens with, in this order:

1. **What the platform can now promise that it could not** — the invariants added, in English.
2. **The policy declaration** — the numbers a human is actually approving (`scope`,
   `maxAmountCents`, `maxPerHour`, `approval`, `approverScope`).
3. What was verified, including which attacks the adversarial tests make.
4. What a reviewer should push back on, and the rollback.

Then say, in the PR and to the user, that it is a platform change: it wants a second pair of eyes on
the declaration and the invariants, not a rubber stamp on the diff.

## What the human reviewer of a tier-2 PR is asked to check

1. The policy declaration — the numbers, not the code.
2. The invariant statements: are they what an auditor would want proved, in the words they would use?
3. The enforcement layers, and the stated reason for any layer skipped.
4. The tests: does each one actually attack the invariant, or only exercise the happy path?
5. What the rollback leaves in force.
