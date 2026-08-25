# 0006 — Invariants are enforced three times, and a violation halts one capability

**Status:** accepted

## Context

The runtime already guaranteed that every effect is audited. That is a weaker claim than it
sounds: an audit row proves an action was logged, not that the amount was right, that the
effect matched what was approved, or that nothing has drifted since. The evidence that the
guardrails held was a human running an adversarial test session once — a verdict about a
moment, not a property of the system.

For money, the useful claim is the one the system re-establishes continuously and by itself:
*these statements are true right now, and here is when they were last checked.*

## Decision

**Invariants** are SQL statements over committed state that must return no rows. They live in
`packages/kernel/src/invariants.ts`, are platform-owned, and are **derived rather than curated**:
either from an axiom about the platform (an approval is another person's judgement; an effect
nobody audited did not legitimately happen) or mechanically from a write capability's
declaration — `maxAmountCents`, `approval`, `maxPerHour`, `idempotent` and an `effect` naming
the table, the amount column and the pool the effect draws down. Declaring a capability derives
its rules; a capability that moves money without an `effect` does not register.

A hand-written list was the first attempt and was rejected: the rules read as arbitrary because
they were — they came from staring at one flow. Derivation makes the set complete with respect
to what was declared, and makes drift between the policy a human reviewed and the invariant
that polices it impossible rather than merely unlikely.

They are enforced at three layers:

1. **The database.** Constraints and triggers: effects carry the invocation that produced
   them, `audit_log` and `refunds` are append-only, refunds are conserved against the payment.
   These hold against a bug in the kernel and against a human with `psql`.
2. **The transaction.** Postconditions re-derive the invariants inside the writing transaction,
   after the effect and its audit row. A violation aborts the transaction, so the money never
   commits; the failure is then re-audited outside it under the same invocation id, so a
   refused effect is as traceable as an accepted one.
3. **The clock.** A reconciler runs every invariant on a timer and records each run in
   `invariant_runs`. Anything it finds arrived by a path the runtime never saw — a manual UPDATE,
   a restore, a migration, a kernel bug. That is precisely the class of failure an audit log
   cannot tell you about.

Expressing an invariant as SQL rather than as a TypeScript assertion is what makes the three layers
possible: one definition, checkable by the transaction that might break it, by a background
process, and by a human, without any of them trusting the code under suspicion.

**On violation, the platform halts the capabilities the invariant names** — writes to them return
`halted`; reads and unrelated capabilities keep serving. Only an admin (`invariants:clear`) can
resume, and only after every invariant guarding that capability passes again.

## Alternatives considered

- **Alarm only.** Cheaper, no false-positive pages. Rejected: an alarm on a money invariant
  that keeps accepting writes is a decision to keep moving money you can no longer account for.
- **Halt the platform.** Safest, and wrong: a broken refund invariant is no reason to stop a
  KYC review queue, and an over-broad halt trains people to clear halts reflexively.
- **Per-capability invariants declared by app authors.** Scales to capabilities we have not
  imagined, but an invariant that app work can define is an invariant app work can weaken. Invariants are
  platform-owned; extending them is tier-2 (ADR follows in `docs/devin/`). Derivation keeps the
  scaling property without the weakening one: a capability author declares *facts* (where the
  money lands, what pool it draws down), and the platform decides what must be proved about them.
- **A hand-written list of statements.** What this started as. Rejected once written down: six
  refund-shaped rules with no argument for why those six and no others.

## Consequences

- A false-positive invariant takes a capability offline. The cost of a wrong invariant is now
  operational, which is the correct incentive to state them precisely and test them.
- Every effect table must carry an `invocation_id`; a handler cannot write a row that is not
  attributable to an audited invocation, because the platform stamps it, not the handler.
- Thresholds in invariants are read from `capability_registry`, so an invariant cannot drift from
  the policy declaration a human reviewed.
- Adding a money-moving capability adds six statements to the reconciler automatically. Review
  shifts from "are these the right rules?" to "is this declaration true?", which is the review
  humans are actually good at.
- The generated SQL is only as good as the declaration: an effect that names the wrong pool
  produces a rule that proves the wrong thing convincingly. That is the failure mode to look
  for in a tier-2 review, and the reason the declaration is deliberately tiny.
- `npm test` fails if a derived invariant is not named by a database test, and `npm run lint` fails
  if a change edits the platform without a record under `docs/platform-changes/`.
- The reconciler adds a query load proportional to invariant count every 15s. At this data volume
  it is irrelevant; at real volume invariants need incremental formulations or a windowed scan.
