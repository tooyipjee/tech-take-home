# Platform change: feature flags, and a state an effect is allowed to move

Tier: 2 (extends the platform)

## What changed

- `packages/db/migrations/0004_feature_flags.sql` — `feature_flags` (key, description,
  `enabled`, `protected`, revision) and `feature_flag_changes`, the append-only history
  of every flip. The history carries `invocation_id` and `capability` like every other
  effect table, is immutable, and a deferred constraint trigger refuses any change to
  `feature_flags.enabled` that no history row accounts for.
- `packages/kernel/src/types.ts`, `registry.ts` — `effect.tracksState` on a write
  declaration: the effect table records a transition (`from`/`to`) of a named column on
  the subject. Declaring it without a subject is refused at registration.
- `packages/kernel/src/invariants.ts` — two further derived statements for any write that
  tracks a state, generated from that declaration.
- `packages/db/src/datasource.ts` — `listFeatureFlags` and `flipFeatureFlag`. The flip
  locks the flag row, checks the revision the caller read, refuses a flip to the state the
  flag is already in, writes the history row and then moves the switch.
- `packages/capabilities/src/flags.ts` — `flags.list` (read) and `flags.flip` (write).
- `packages/kernel/src/auth.ts` — `flags:read` for every seeded role, `flags:write` for
  `admin` only.
- `packages/db/src/seed.ts` — eight flags, four of them protected. A seeded flag's
  `enabled` is deliberately *not* overwritten on reseed conflict, so a state the runtime
  moved is never silently reverted underneath its own history.
- `packages/sdk/src/index.ts`, `packages/app-kit/src/Outcome.tsx` — `conflict` was
  reachable from the runtime but missing from the SDK's outcome union and the shared
  explanations.

The policy, in full, as the registry serves it:

```
flags.list  { scope: "flags:read", maxRows: 200 }
flags.flip  { scope: "flags:write", idempotent: true,
              limits: { maxAmountCents: null, maxPerHour: 30 },
              approval: { mode: "derived_from_subject",
                          clauses: [{ when: "s.protected = true", approverScope: "flags:write" }] },
              approverScope: "flags:write",
              subject: { table: "feature_flags", idField: "flagId" },
              effect: { table: "feature_flag_changes", subjectColumn: "flag_id",
                        tracksState: { column: "enabled",
                                       fromColumn: "from_enabled", toColumn: "to_enabled" } } }
```

`maxAmountCents: null` is the honest declaration: flipping a switch moves no money, even
where the feature behind it does. What the protected flags buy is a second pair of eyes
before a money-adjacent path changes behaviour, which is the approval clause, not a ceiling.

## Invariants affected

None weakened, disabled or removed. Two new *kinds* of derived statement, plus the
existing set applied to a new capability.

| Invariant | Derived from | Enforced by |
| --- | --- | --- |
| `flags.flip.state_matches_the_last_recorded_change` | `policy.effect.tracksState` | trigger, postcondition, reconciler |
| `flags.flip.records_every_state_change` | `policy.effect.tracksState` | postcondition, reconciler |
| `flags.flip.effects_are_attributed` | axiom: an effect nobody audited did not legitimately happen | FK + trigger, postcondition, reconciler |
| `flags.flip.carries_the_declared_approval` | `policy.approval` clause `s.protected = true` | postcondition, reconciler |
| `flags.flip.respects_declared_rate` | `policy.limits.maxPerHour` | postcondition, reconciler |
| `flags.flip.is_idempotent` | `policy.idempotent` | postcondition, reconciler |

In English, the two new ones:

- **A flag is what its history says it is.** Every `feature_flags.enabled` equals the value
  the last recorded flip left it at. The switch is a projection of its audit trail, not a
  second source of truth that happens to agree.
- **A flag never moves unrecorded.** No flip records a starting state that the flip before
  it did not leave, so a state that changed between two recorded flips cannot hide in the
  gap — which is what makes the first statement more than a comparison of two numbers that
  were written together.

Deliberate limit, worth a reviewer's attention: the first statement is an inner join, so a
flag with *no* recorded flip is not compared against anything. There is nothing to compare
it to — asserting the seeded value would make the invariant a copy of the seed. That case
is covered by the database trigger instead, which refuses *any* change to `enabled` with no
matching history row, including the first one; the invariant takes over from the first flip
onwards. Both are attacked by name in the tests.

The requester-cannot-sign rule is untouched: it is the existing
`approvals.decided_by_a_second_person` axiom, and the protected-flag clause inherits it
rather than restating it.

## How it was verified

`npm run lint && npm run typecheck && npm test && npm run test:db && npm run reconcile &&
npm run build:apps`.

`packages/kernel/test/invariants.test.ts` pins the derived set for `flags.flip` — six
statements, so a declaration change shows up as a failing snapshot — asserts the two new
proofs are generated from the declared columns rather than hand-written, and that a write
tracking a state without naming the row it lives on is refused at registration.

`packages/kernel/test/db/flags.test.ts` attacks the new guarantees against Postgres:

- An ordinary flip lands immediately and joins to exactly one audit row, actor and time.
- An agent and a KYC lead are refused `flags.flip` and the refusals are on the record,
  while both can still read the list.
- A protected flag returns `pending_approval` and nothing moves; the requester signing
  their own request is refused; a holder of `approvals:decide` without `flags:write` is
  refused; a second admin's signature applies it, and the flip stays recorded as the
  requester's. Protection is read off the flag, not the caller — the same caller is held
  for a protected flag and not for an ordinary one.
- A history row inserted with no invocation is refused by the database; `UPDATE` and
  `DELETE` on history are refused.
- Flipping a flag by direct SQL is refused by the trigger. With the trigger explicitly
  disabled — which takes ownership of the table, not a capability — the drift is caught by
  `state_matches_the_last_recorded_change`, the reconciler halts `flags.flip`, and further
  flips return `halted` while reads keep serving.
- A flag moved outside the runtime and moved back, which the first statement cannot see, is
  caught by `records_every_state_change`; and the postcondition means the runtime refuses
  to append to a broken history at all (`invariant_violation`, nothing committed).
- Forged audit rows break the declared rate of 30, which the rate statement detects.
- A repeated flip replays, leaving one history row; a stale revision and a flag already in
  the requested state both return `conflict`, both audited.
- After a signed protected flip, `reconcile()` reports no violations and no halts.

Exercised in the browser as all four seeded roles, including a refusal (Avery Nolan) and an
approval (Robin Vale asks, Dana Whitfield signs).

## Rollback

The migration is additive: `feature_flags` and `feature_flag_changes` are new tables and no
existing table changed. Reverting `packages/capabilities/src/flags.ts` withdraws both verbs
(the app then shows `not_found`, which it renders); reverting the `auth.ts` scopes withdraws
the ability to flip without touching the data. Reverting the kernel change removes the two
derived statements and leaves the database trigger in force, which is the intended failure
mode. Dropping the tables needs a further tier-2 migration that says why here.

## Operational notes

- Which flags exist and which are protected is seed data, i.e. a reviewed change. No
  capability creates a flag, renames one, or marks one protected: if `protected` were
  flippable in-app, the second signature would be one unprotected flip away.
- A halt on `flags.flip` stops flipping, not reading. Only `invariants:clear` (admin)
  resumes it, and only once the flag's state and its history agree again — repair means
  recording the flip that actually happened, not editing the switch.
- 30 flips an hour per admin is a rollback budget, not a workflow: turning eight flags off
  and back on in an incident is well inside it, and a script looping over the registry is not.
