# Playbook (tier 1) — build an internal app on the platform

Draft for a Devin playbook. Paste into a playbook, attach the knowledge note in
[`knowledge-platform-conventions.md`](knowledge-platform-conventions.md), and iterate.

**Scope of this playbook: apps only.** It composes capabilities and invariants that already
exist. It never adds, weakens or removes one. If the app needs a verb the platform does
not have, stop and run
[`playbook-extend-the-platform.md`](playbook-extend-the-platform.md) instead — that is a
different job with more review, and `npm run lint` fails if this one strays into it.

## What the user provides

A paragraph of intent in risk terms, e.g.:

> Chargeback analysts need a queue of open disputes and a way to submit evidence. No money moves.
> Analysts work unattended. One submission per dispute.

## Procedure

1. **Read the boundary first.** Read `docs/architecture.md` and
   `docs/authoring-a-capability.md`. Do not skip: the constraints there are the whole point of the
   platform, and violating them fails `npm run lint`.
2. **Inventory the verbs.** List every read and write the screen needs. Check
   `packages/capabilities` and `GET /api/capabilities` for existing ones. Reuse beats adding.
3. **Report the plan before writing code.** State which existing capability serves each verb, the
   policy it already declares (`scope`, `maxAmountCents`, `maxPerHour`, `approval`), and anything
   the screen needs that nothing provides. Those declared numbers are risk decisions the user has
   already made: build the app around them rather than asking for them to be changed.
4. **If a verb is missing, stop.** Adding a capability, a `DataSource` method, a scope, an invariant
   or a migration is tier-2 work. Report which verb is missing and what policy it would need,
   and switch to [`playbook-extend-the-platform.md`](playbook-extend-the-platform.md). Do not
   work around it in app code.
5. **Read the invariants** the flows you are building depend on: `GET /api/invariants`, or
   `packages/kernel/src/invariants.ts`. They tell you what the platform already guarantees, so you
   do not re-check it in the app.
6. **Write the app** in its own folder, `apps/<app-name>/`. Copy the shape of
   `apps/kyc-review`: `package.json`, `index.html`, a `vite.config.ts` with an unused port, and
   `src/`. It may import `@platform/sdk` and `@platform/app-kit` and nothing else from the
   platform. Render every outcome the SDK can return — `pending_approval` and `denied_*` are
   normal states, not errors.
7. **Wire it up**: a `dev:<name>` script in the root `package.json`, and a row in
   `apps/console/src/Launcher.tsx`. The boundary check needs no wiring; it scans every folder
   under `apps/`.
8. **Verify** with `npm run lint && npm run typecheck && npm test`, then exercise the app in the
   browser as each seeded role, including at least one denial and one approval path. `npm run lint`
   also fails if this change touched the platform, which is the mechanical form of the rule above.
9. **Open a PR** whose description leads with the policy declarations you added, in full. That
   block is what the reviewer is actually approving.

## Hard rules

- Never put an authorisation, limit, approval or audit check in app or handler code. If you feel
  the need for one, you have found either a missing scope or a missing runtime feature — say so
  instead of implementing it.
- Never import `pg`, `@platform/db`, `@platform/kernel` or `@platform/capabilities` from an app.
- Never call `fetch` from an app; use the SDK.
- Never widen a `maxAmountCents` ceiling to make a flow work. Escalate.
- Never add a capability that takes a table name, a SQL fragment, or an arbitrary filter object.
- Never edit `packages/kernel`, `packages/db`, `packages/capabilities`, `packages/sdk`, a
  migration, or the check scripts. Those are tier 2.
- Never treat a `halted` or `invariant_violation` outcome as a bug to route around. Surface it: the
  platform is telling the user it can no longer prove the operation is safe.

## Outcomes an app must render

`ok`, `replayed`, `pending_approval`, `denied_scope`, `denied_limit`, `rate_limited`,
`invalid_input`, `not_found`, `halted`, `invariant_violation`, `error`. All of them are normal
platform behaviour; none of them should reach the user as a stack trace.
