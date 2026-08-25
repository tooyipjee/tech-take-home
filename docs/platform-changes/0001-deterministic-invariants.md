# Platform change: deterministic invariants, postconditions and reconciliation

Tier: 2 (extends the framework)

## What changed

- `packages/db/migrations/0003_invariants.sql` — every effect row carries the id of the
  invocation that produced it, `audit_log` and `refunds` become append-only, refunds
  are conserved against the payment by a trigger, and reconciliation state
  (`invariant_runs`, `capability_halts`) exists.
- `packages/kernel/src/invariants.ts` — the invariant derivation: SQL statements that must
  return no rows, generated from the axioms plus each write capability's declared
  policy and effect.
- `packages/kernel/src/registry.ts` — a write capability that moves money must
  declare an `effect` (where the row lands, what pool it draws down) or it will
  not register.
- `packages/kernel/src/reconciler.ts` — periodic re-derivation, per-capability halt,
  admin-only clearing.
- `packages/kernel/src/runtime.ts` — halt check before a write, postcondition check
  inside the writing transaction, invocation id stamped on the audit row.
- `packages/db/src/datasource.ts` — the invocation id is stamped by the platform,
  not passed in by a handler.

## Invariants affected

None weakened or removed. The set is now derived rather than hand-written, from
two sources: axioms about the platform, and each write capability's declaration.

| Invariant | Derived from | Enforced by |
| --- | --- | --- |
| `approvals.decided_by_a_second_person` | axiom: an approval is another person's judgement | reconciler |
| `<cap>.effects_are_attributed` | axiom: an effect nobody audited did not legitimately happen | FK + not-null trigger, postcondition, reconciler |
| `<cap>.conserves_<pool>` | `policy.effect.conserves` | trigger, postcondition, reconciler |
| `<cap>.respects_declared_ceiling` | `policy.limits.maxAmountCents` | postcondition, reconciler |
| `<cap>.carries_the_declared_approval` | `policy.approval` | postcondition, reconciler |
| `<cap>.respects_declared_rate` | `policy.limits.maxPerHour` | postcondition, reconciler |
| `<cap>.is_idempotent` | `policy.idempotent` | postcondition, reconciler |

For the one money-moving capability that exists, that is seven statements in
force (`refunds.issue.*` plus the axiom). Any new money-moving capability gets
the same set the moment it declares its effect, and cannot register without one.

Thresholds inside the generated SQL are read from `capability_registry`, so an
invariant is derived from the declaration a human reviewed rather than being a
second copy of it that can drift.

## How it was verified

`npm run lint && npm run typecheck && npm test && npm run test:db`.

`packages/kernel/test/invariants.test.ts` asserts the derived set for the current
declarations, that thresholds are not hard-coded, that a money-moving capability
without an effect is refused at registration, and that no invariant is in force
without a test naming it.

`packages/kernel/test/db/invariants.test.ts` attacks each invariant by a different
route — direct SQL insert, `UPDATE`/`DELETE` on history, an over-refund with the
handler bypassed, a capability whose handler moves ten times what it declares, and
a payment amount changed underneath a committed refund. It asserts the write is
refused or rolled back, that the refusal is still audited, that the reconciler
halts `refunds.issue`, that reads and unrelated capabilities keep serving, that a
halt cannot be cleared while the data is still wrong, and that the capability
resumes once it is repaired. Forged audit rows are used to break the rate and
idempotency invariants, which the runtime alone would never allow.

## Rollback

The migration is additive. Reverting the kernel changes disables the postcondition
and the reconciler; the database-level invariants stay in force, which is the intended
failure mode. To retire a database invariant, a further tier-2 migration must drop the
trigger explicitly and say why here.

## Operational notes

- The reconciler runs every 15s in the API process. A run that cannot reach the
  database logs and retries on the next tick; it does not halt anything, because a
  reconciler that cannot read state has proved nothing either way.
- A halt is scoped to the capabilities the violated invariant names. Reads keep serving.
- Only `invariants:clear` (admin) can resume a capability, and only after every invariant
  guarding it passes again.
