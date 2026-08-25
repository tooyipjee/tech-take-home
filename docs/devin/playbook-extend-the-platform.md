# Playbook (tier 2) — extend the platform

Draft for a Devin playbook. This is the *only* route by which a capability, a scope, a
`DataSource` method, a migration or an invariant may change. It exists because those changes
alter what the platform can promise, and a promise is worth what its weakest change is.

Use [`playbook-build-an-app.md`](playbook-build-an-app.md) for anything that can be built
from what already exists. If you are unsure which tier you are in, you are in this one.

## When this playbook is invoked

- A tier-1 app needs a verb the platform does not have.
- A policy number (ceiling, rate, approval threshold) must change.
- A new domain arrives with money-moving effects and no invariants covering them.
- An invariant is wrong: too strict (false halts) or too weak (it missed something real).
- A new scope is needed, or an existing scope must be granted to a role (`ROLE_SCOPES`).
- The runtime cannot express the policy the domain actually has — see step 4a.

## The shape of the job

A new domain is one PR with a predictable spine, and it is worth stating the size honestly:
migration → seed → `DataSource` methods → capability declarations → derived invariants →
adversarial database tests → change record → knowledge. Roughly:

| The domain… | Extra work beyond the spine |
| --- | --- |
| …moves no money and needs no second signature (e.g. a flag switch) | None. `approval: { mode: "never" }`, an effect table, and the derived rate/idempotency/attribution invariants come free |
| …moves money | `amountField`, `maxAmountCents`, and an `effect.conserves` pool so the conservation invariant can be derived; `approval: { mode: "above_amount" }` |
| …needs a second signature that depends on the *record*, not the input | `approval: { mode: "derived_from_subject" }` and a `subject` on the capability — see step 4a |
| …has an action that may happen only once per record | `effect.oncePerSubject`, which derives both a unique index expectation and an invariant |

When you finish, hand the domain back to tier 1: the UI over the new verbs is
[`playbook-build-an-app.md`](playbook-build-an-app.md), and it should need nothing but the
capabilities you just declared.

## The rule that makes this tier different

Everything here is reviewed by a human before it merges, and the review is not "does this
code look right?" — it is **"what can no longer be proved, and what now can?"** Your job is
to make that question cheap to answer. A tier-2 PR that a reviewer has to reverse-engineer
has failed even if the code is correct.

## Procedure

1. **Write the spec before the code.** One paragraph: the verb, who may call it, what it
   changes, the worst thing it could do if the handler were wrong. Get the user to confirm
   the policy numbers explicitly. Do not proceed on inference.
2. **Name the invariants first.** For every new money-moving or state-changing effect, write
   the statements that must always hold about it, in English, before you write SQL. If you
   cannot state one, you do not yet understand the effect well enough to ship it.
3. **Decide where each invariant is enforced.** Prefer the lowest layer that can hold it:
   - a **database constraint or trigger** if it can be expressed over rows — it survives a
     bug in the kernel and a human with `psql`;
   - a **postcondition** (`postconditionFor`) if it needs the transaction's own view —
     it rolls the money back before it commits;
   - the **reconciler** (`halts`) for everything, always — it is what notices drift that
     arrived by a path nobody anticipated.
   Most invariants belong in all three. Note in the change record why any layer was skipped.
4. **Prefer declaring over writing.** Most invariants should not be written at all: state them
   in the capability's `policy` (`limits`, `approval`, `idempotent`) and its `effect` (the
   table, the amount column, the live-row predicate, the pool it draws down), and
   `packages/kernel/src/invariants.ts` generates the SQL that proves them. Hand-write an invariant only
   for something no declaration can express — and then argue in the change record why it is an
   axiom rather than a property of one capability. Whichever route, the query returns zero rows
   when the invariant holds and one row per violation, with `subject` and `detail`, and reads
   thresholds from `capability_registry` rather than hard-coding them.
5. **If the requirement depends on the record, extend the declaration, not the handler.** The
   temptation, when "does this need a second person?" depends on the row (risk band, an unresolved
   screening hit, an account's standing), is to answer it in the handler or — worse — in the app.
   Both put policy where no invariant can read it. The mechanism is
   `approval: { mode: "derived_from_subject", clauses: [...] }`: each clause is SQL over the
   subject row aliased `s`, carrying the `approverScope` it demands and a `because` the UI can
   show. First match wins.

   Three properties to preserve if you touch this: the resolved scope is written **onto the
   approval row** when the request is raised, so editing the clauses later cannot lower the bar on
   something already waiting; `previewApproval()` answers the same question without performing the
   write, which is how an app warns the user without holding a copy of the rule; and the derived
   `carries_the_declared_approval` invariant re-evaluates the same clauses over committed data, so
   the rule is proved rather than merely applied.

6. **Add the migration** in `packages/db/migrations/`. Additive only. Never drop or weaken an
   existing constraint in the same change as a feature; that is its own PR with its own
   argument. New effect tables need an `invocation_id` with the not-null trigger and the FK
   to `audit_log`, or their rows will not be attributable to an audited invocation.
7. **Add the capability** in `packages/capabilities`, and any `DataSource` method it needs in
   `packages/db/src/datasource.ts`. Handlers still see only `input` and `ctx.data`; no SQL in
   a handler, no invocation id passed by the caller.
8. **Map failures onto the outcome vocabulary the apps already render.** A new failure mode that
   surfaces as `error` is a failure mode nobody handles. A repeated or conflicting write is
   `conflict` — raise `StaleRevisionError` from the `DataSource` rather than letting a unique index
   fail late; a refused write is `denied_*`; a paused capability is `halted`. Adding a *new*
   outcome means every app must learn to render it: avoid it if an existing one is honest.

9. **Add adversarial tests** in `packages/kernel/test/db/`. An invariant with no test is a
   sentence, not a guarantee — and `npm test` fails if a derived invariant is not named by a
   database test. Update the expected derived set in `packages/kernel/test/invariants.test.ts`;
   that assertion failing is the signal that a declaration changed and needs review. For each
   new invariant, prove:
   - the write is refused or rolled back when the invariant would break, and the refusal is
     still audited;
   - the same attack through direct SQL is refused by the database;
   - the reconciler notices state that was corrupted outside the runtime;
   - the guarded capability halts, unrelated capabilities and reads keep serving;
   - the halt cannot be cleared while the data is still wrong, and can be after repair.
10. **Write the change record** under `docs/platform-changes/`, with the sections
   `## Invariants affected`, `## How it was verified` and `## Rollback`. `npm run lint` requires
   it: a platform edit with no change record fails the tier check. State which invariants appear,
   disappear and change meaning — a *removed* invariant is the sentence a reviewer must not miss.
   The tier check also greps for the invariant-coverage test by name, so renaming that test is a
   deliberate act, not a tidy-up.

11. **Grant the scopes, seed the data, and prove the migration from empty.** A capability whose
   scope no role holds is unreachable, and a launcher tile naming it is permanently locked (the
   boundary check fails on exactly that). Update `ROLE_SCOPES` in `packages/kernel/src/auth.ts` and
   the seed in `packages/db/src/seed.ts` in the same PR. If the migration is destructive, or edits
   a file that has already run, say so in the PR: collaborators need
   `npm run db:down && npm run setup`, and CI applies migrations to an empty database precisely to
   catch what only works against your volume.
12. **Update the knowledge** in [`knowledge-platform-conventions.md`](knowledge-platform-conventions.md)
   so tier-1 sessions can find the new verb without reading the kernel. A capability nobody
   knows about is a capability that gets rebuilt badly in app code.
13. **Verify** with `npm run lint && npm run typecheck && npm test && npm run test:db &&
    npm run reconcile && npm run build:apps`, then exercise the flow in the console as each seeded
    role. Update the testing skills under `.agents/skills/` if the flows they describe changed — a
    skill describing a capability you deleted is worse than no skill.
14. **Open the PR and say what changed about the guarantees.** Lead the description with the
    invariant table from the change record and the policy declarations, then ask for review
    explicitly. Do not merge on green CI alone.

## Hard rules

- Never weaken or delete an invariant in the same PR as a feature. Separate PR, explicit argument,
  named reviewer.
- Never disable a trigger or constraint to make a test pass. If an invariant blocks a legitimate
  flow, the invariant is wrong and fixing it is the work.
- Never let a handler write an effect row the platform cannot attribute to an invocation.
- Never clear a halt to unblock yourself. Repair the data; the halt clears itself when the
  invariant passes.
- Never move an authorisation, limit or audit decision out of the runtime and into a handler.

## What the human reviewer is asked to check

1. The policy declaration — the numbers, not the code.
2. The invariant statements: are they what an auditor would want proved, in the words they would
   use?
3. The enforcement layers, and the stated reason for any layer skipped.
4. The tests: does each one actually attack the invariant, or only exercise the happy path?
5. What the rollback leaves in force.
