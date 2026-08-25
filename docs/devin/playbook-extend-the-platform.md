# Playbook (tier 2) — extend the platform

Draft for a Devin playbook. This is the *only* route by which a capability, a scope, a
`DataSource` method, a migration or a tenet may change. It exists because those changes
alter what the platform can promise, and a promise is worth what its weakest change is.

Use [`playbook-build-an-app.md`](playbook-build-an-app.md) for anything that can be built
from what already exists. If you are unsure which tier you are in, you are in this one.

## When this playbook is invoked

- A tier-1 app needs a verb the platform does not have.
- A policy number (ceiling, rate, approval threshold) must change.
- A new domain arrives with money-moving effects and no tenets covering them.
- A tenet is wrong: too strict (false halts) or too weak (it missed something real).

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
   Most tenets belong in all three. Note in the change record why any layer was skipped.
4. **Prefer declaring over writing.** Most invariants should not be written at all: state them
   in the capability's `policy` (`limits`, `approval`, `idempotent`) and its `effect` (the
   table, the amount column, the live-row predicate, the pool it draws down), and
   `packages/kernel/src/tenets.ts` generates the SQL that proves them. Hand-write a tenet only
   for something no declaration can express — and then argue in the change record why it is an
   axiom rather than a property of one capability. Whichever route, the query returns zero rows
   when the tenet holds and one row per violation, with `subject` and `detail`, and reads
   thresholds from `capability_registry` rather than hard-coding them.
5. **Add the migration** in `packages/db/migrations/`. Additive only. Never drop or weaken an
   existing constraint in the same change as a feature; that is its own PR with its own
   argument. New effect tables need an `invocation_id` with the not-null trigger and the FK
   to `audit_log`, or their rows will not be attributable to an audited invocation.
6. **Add the capability** in `packages/capabilities`, and any `DataSource` method it needs in
   `packages/db/src/datasource.ts`. Handlers still see only `input` and `ctx.data`; no SQL in
   a handler, no invocation id passed by the caller.
7. **Add adversarial tests** in `packages/kernel/test/db/`. A tenet with no test is a
   sentence, not a guarantee — and `npm test` fails if a derived tenet is not named by a
   database test. Update the expected derived set in `packages/kernel/test/tenets.test.ts`;
   that assertion failing is the signal that a declaration changed and needs review. For each
   new tenet, prove:
   - the write is refused or rolled back when the tenet would break, and the refusal is
     still audited;
   - the same attack through direct SQL is refused by the database;
   - the reconciler notices state that was corrupted outside the runtime;
   - the guarded capability halts, unrelated capabilities and reads keep serving;
   - the halt cannot be cleared while the data is still wrong, and can be after repair.
8. **Write the change record** under `docs/platform-changes/`, with the sections
   `## Tenets affected`, `## How it was verified` and `## Rollback`. `npm run lint` requires
   it: a platform edit with no change record fails the tier check.
9. **Update the knowledge** in [`knowledge-platform-conventions.md`](knowledge-platform-conventions.md)
   so tier-1 sessions can find the new verb without reading the kernel. A capability nobody
   knows about is a capability that gets rebuilt badly in app code.
10. **Verify** with `npm run lint && npm run typecheck && npm test && npm run test:db`, then
    exercise the flow in the console as each seeded role.
11. **Open the PR and say what changed about the guarantees.** Lead the description with the
    tenet table from the change record and the policy declarations, then ask for review
    explicitly. Do not merge on green CI alone.

## Hard rules

- Never weaken or delete a tenet in the same PR as a feature. Separate PR, explicit argument,
  named reviewer.
- Never disable a trigger or constraint to make a test pass. If a tenet blocks a legitimate
  flow, the tenet is wrong and fixing it is the work.
- Never let a handler write an effect row the platform cannot attribute to an invocation.
- Never clear a halt to unblock yourself. Repair the data; the halt clears itself when the
  tenet passes.
- Never move an authorisation, limit or audit decision out of the runtime and into a handler.

## What the human reviewer is asked to check

1. The policy declaration — the numbers, not the code.
2. The tenet statements: are they what an auditor would want proved, in the words they would
   use?
3. The enforcement layers, and the stated reason for any layer skipped.
4. The tests: does each one actually attack the invariant, or only exercise the happy path?
5. What the rollback leaves in force.
