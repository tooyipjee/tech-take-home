# 0008 — Refunds are a conserved quantity

Until now every effect on the platform was a *state change*: a case is decided, a SAR is filed,
and the only question the invariants asked was "was this attributable, countersigned and once?".
A refund is the first effect that **draws down a pool**. A payment of $480 can be refunded twice
for $200 and not a third time, and no single refund's paperwork tells you that — the rule is about
the sum of every live row pointing at the same payment. That is the shape the platform gains here.

Three things follow from that, and they are worth separating because reviewers tend to collapse
them:

- **A ceiling is not a threshold.** `$500` is the threshold: above it the refund is held and a
  holder of `refunds:approve` who is not the requester decides it. `$2,000` is the ceiling: above
  it the refund is refused outright and *no approval is raised*, so there is nothing for anyone to
  sign. Making the ceiling a very high threshold would have been a one-word change and a different
  promise.
- **Conservation is enforced three times, deliberately.** The declaration derives the invariant;
  the runtime checks it as a postcondition inside the writing transaction; and
  `enforce_refund_conservation()` re-checks it in the database against a locked payment row, so a
  refund inserted with the handler bypassed is refused too. The reconciler then re-derives it every
  15s over committed data. The trigger is the one that survives a future handler bug.
- **Nothing leaves the database.** A `refunds` row is an instruction to the payments team, not a
  call to a card processor. The desk says so on screen, because an agent who believes the money has
  moved will tell the customer it has.

The refund handler takes the payment row with `select ... for update` **before** summing what has
been refunded against it, in a separate statement. Combining the two reads into one query is the
obvious version and it is wrong: the combined statement can be planned against a snapshot taken
before the lock was granted, so two concurrent refunds both see the full remainder, both pass the
handler's check, and the loser dies at the trigger with `error` instead of being told `conflict`.
The test that catches this races two $400 refunds at one $480 payment.

`conflict` was already an outcome the runtime could return and was missing from the SDK's `Outcome`
union, so an app could not handle it without a cast. It is now exported. `NotFoundError` is new
next to `StaleRevisionError`: "this payment does not exist" and "this payment moved under you" are
different sentences to a support agent with a customer on the line, and the runtime now maps them
to `not_found` and `conflict` respectively rather than folding both into a stale-revision conflict.

Scopes: `refunds:read` and `refunds:issue` for the agent, `refunds:approve` added for the
supervisor. Compliance officers (`u_admin`, `u_admin_2`) hold `refunds:read` and `refunds:approve`
but **not** `refunds:issue` — the refunds desk is support's work, and an officer who could both
raise and sign would leave the four-eyes rule with nobody to enforce it against. Their launcher tile
is locked; their approvals inbox is not.

## Invariants affected

Six new derived invariants, all from the `refunds.issue` declaration rather than hand-written SQL
(the set `invariants()` produces goes from 29 statements to 35):

- `refunds.issue.effects_are_attributed` — every refund row names an audited invocation of
  `refunds.issue` that succeeded. Who asked is never unknown.
- `refunds.issue.carries_the_declared_approval` — every refund above $500 has an approval row that
  was approved, whose recorded approver scope is `refunds:approve`, and whose approver is not the
  requester.
- `refunds.issue.respects_declared_ceiling` — no refund exceeds $2,000, whoever approved it.
- `refunds.issue.respects_declared_rate` — no principal has more than 10 accepted refunds in any
  hour.
- `refunds.issue.conserves_payments` — for every payment, the sum of live (`status = 'issued'`)
  refunds against it is at most the payment amount. This is the new *kind* of statement: it is
  about a group of rows, not a row.
- `refunds.issue.is_idempotent` — a repeated request replays rather than refunding twice.

Existing invariants are untouched; the migration is additive (two new tables, no change to any
existing column), and the platform axioms are the same statements as before. Three database
guarantees back the derived set: refunds must carry an `invocation_id` that resolves to a
successful audit row (deferred FK plus trigger), refunds are append-only (no update, no delete, so
the history an agent reads cannot be edited), and conservation is checked against the capability
registry's declared ceiling and the locked payment row.

## How it was verified

- `packages/kernel/test/db/refunds.test.ts` — 15 tests against a real database, each named for the
  invariant it attacks: forged refunds with no invocation and with an invocation whose audit row
  failed; an attempt to update and to delete a committed refund; $2,500 as an agent and as a
  supervisor, asserting `denied_limit` *and* that the approvals table stayed empty; four partial
  refunds summing to exactly the payment and a fifth cent refused; the same overdraw attempted in
  raw SQL with the handler bypassed; two $400 refunds racing at one $480 payment; a supervisor
  approving their own request; an agent trying to decide an approval; a rejected approval leaving
  no refund; a forged refund whose approval was never granted, caught by the reconciler; 11 refunds
  in an hour; a double-submitted refund replaying.
- `packages/kernel/test/invariants.test.ts` — the derived set for `refunds.issue` is asserted by
  name, so adding or dropping a clause in the declaration fails the snapshot.
- `npm run lint` (tier 2, change record present), `npm run typecheck`, `npm test` (15 pass),
  `npm run test:db` (30 pass), `npm run reconcile` (all invariants held on seeded data),
  `npm run build:apps`.
- In the browser: `apps/refunds` exercised as Avery Nolan (agent) and Sam Okafor (supervisor),
  including a refusal above the ceiling and a $900 refund held and then signed off by the
  supervisor, plus the launcher tile locked for Robin Vale and Dana Whitfield.

## Rollback

Revert this commit and run `npm run db:down && npm run setup` — or, to keep the data, drop the two
new tables and their triggers (`drop table refunds, payments cascade`), which removes the effect
table the declaration names. Then remove `packages/capabilities/src/refunds.ts` and its export: an
unregistered capability derives no invariants, so the set returns to 29 statements and nothing
halts. The `refunds:*` grants in `ROLE_SCOPES` and the seeded payments are inert once the
capabilities are gone, but `apps/refunds/app.json` names scopes no role holds, so the boundary
check fails until that folder is removed too — remove the app in the same revert.

Nothing outside this database ever heard about a refund, so there is nothing to reverse anywhere
else. That was the point of the record-of-intent design: rolling this back cannot leave a customer
refunded twice.
