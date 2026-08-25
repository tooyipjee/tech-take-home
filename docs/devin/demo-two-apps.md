# Demo — two apps, two tiers

The claim being demonstrated is not "Devin can write a CRUD screen". It is:

> Apps are generated quickly *because* the things that must not go wrong are not in the app.
> One tier is cheap because the other tier was expensive.

So the demo needs one app of each kind. This document fixes which is which, and why.

## Which app is which tier

| App | Tier | Why |
| --- | --- | --- |
| A second view over `kyc.*` — `apps/sar-desk`, already built | **1 only** | Every verb it needs already existed |
| **Feature flag admin** | **2, then 1** | No capability, no table, no `flags:*` scope exists — but nothing it does moves money |
| **Refunds dashboard** | **2, then 1** | Same, plus money: a ceiling, an amount-threshold approval, and a conservation invariant |

Two honest points to make on stage rather than hide:

1. **Neither flags nor refunds is a tier-1 job today.** The repository contains exactly one domain,
   KYC. Any new domain begins in the platform, and that is the design working, not a gap: the app
   layer physically cannot mint a verb. The only genuinely tier-1 app right now is another screen
   over the KYC verbs — `apps/sar-desk` is exactly that, and it is the evidence for the claim: three
   existing verbs, no migration, no capability, no change record.
2. **Feature flags is the easier of the two**, and by a wide margin.

## Why feature flags is the easy tier-2

A flag switch is a state change with no conserved quantity. The declaration is short —
`scope: "flags:write"`, `idempotent: true`, `limits: { maxPerHour: n }`,
`approval: { mode: "never" }` (or `"always"` for flags marked as protected), and an `effect`
naming the row it writes — and the derived invariants that fall out of it are the free ones:
the effect is attributed to an audited invocation, the rate is respected, a replay is a replay.
There is no `conserves`, no `amountField`, no threshold to argue about.

The work is therefore: one migration (`feature_flags` plus an append-only
`feature_flag_changes` effect table carrying `invocation_id`), two or three `DataSource` methods,
`flags.list` / `flags.set`, the `flags:write` scope granted to `admin`, seed rows, and the
adversarial tests. Then tier 1 builds `apps/flag-admin` and it appears on the launcher.

The interesting demo moment is not the switch flipping. It is: **flip a flag with `psql` instead
of the app**, and watch the reconciler notice a flag change with no audited invocation behind it,
halt `flags.set`, and refuse to clear until the row is repaired.

## Why refunds is the expensive tier-2

Refunds is the one that exercises the machinery the platform was built for, which is exactly why
it should be second: money-moving means `amountField`, `maxAmountCents`, an
`approval: { mode: "above_amount", thresholdCents }`, and an `effect.conserves` pool
(`payments.amount_cents` drawn down by live refunds) — from which the conservation invariant is
*derived*, not written. It also needs the payments side of the schema to exist to be refunded
against, and its adversarial suite is the interesting one: over-refund by direct SQL, forge an
approval, replay an idempotency key, edit a committed refund.

That gives the strongest single frame of the demo — the reconciler halting `refunds.issue` after
a raw SQL over-refund, reads still serving, and an admin unable to clear the halt until the data
is repaired — at the cost of being the longer build.

## Suggested running order

1. **Show the platform, not an app.** Console → Capability registry and Invariants: 29 statements,
   none hand-written, each derived from a declaration. Then the KYC app refusing something.
2. **Tier 1, live.** Build a third KYC-domain screen from the playbook (`apps/sar-desk` is the one
   built earlier the same way). Point out what the
   session was *not allowed* to do — and that adding the folder was the whole wiring: it typechecks,
   builds, runs and lands on the launcher because everything discovers `apps/*`.
3. **Tier 1 refuses.** Ask the same playbook for the flag admin. Triage must class it tier 2 and
   escalate: no `flags.*` capability, no `flags:write` scope. Show `npm run lint` failing if it
   tries anyway, and the boundary check rejecting an `app.json` that claims a scope no role holds.
4. **Tier 2.** Run the playbook's phase C for flags: declaration, derived invariants, change record,
   adversarial tests. This is the slow, reviewed half, and it should look slow.
5. **Tier 1 again.** The flag admin, now cheap, on the launcher next to the others.
6. **Break it.** `psql` a flag change with no invocation; watch the halt, then the clear.

Refunds is the optional encore if the audience is money-focused: it is the same script with a
conservation invariant that visibly cannot be talked around.

## What must be true before the demo

- `npm run setup && npm run dev` from a clean clone, and `npm run db:down && npm run setup` if the
  volume is older than the current migrations.
- The launcher shows every app, offered or locked per principal — check as Avery *and* as Robin.
- `npm run lint && npm run typecheck && npm test && npm run test:db && npm run reconcile` green,
  because step 1 is a claim about proofs and someone will ask you to run them.
