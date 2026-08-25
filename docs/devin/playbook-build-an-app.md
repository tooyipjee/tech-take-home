# Playbook — build an internal app on the platform

Draft for a Devin playbook. Paste into a playbook, attach the knowledge note in
[`knowledge-platform-conventions.md`](knowledge-platform-conventions.md), and iterate.

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
3. **Report the plan before writing code.** State the capabilities you will add, and for each write
   capability, the exact policy declaration you propose:
   `scope`, `maxAmountCents`, `maxPerHour`, `approval`. Ask the user to confirm the numbers —
   they are risk decisions, not implementation details, and they are the thing a human reviews.
4. **Add missing capabilities** in `packages/capabilities`, one file per domain. Use
   `defineRead` / `defineWrite`. Handlers use only `input` and `ctx.data`. If you need a data
   operation that `DataSource` does not expose, add it in `packages/db/src/datasource.ts` — never
   run SQL from a handler.
5. **Add scopes** to `ROLE_SCOPES` in `packages/kernel/src/auth.ts` only if no existing scope fits.
   A new scope is a bigger decision than a new verb: call it out explicitly.
6. **Write the app** in `apps/console/src/apps/<Name>.tsx`. It may import `../client.ts`,
   `../format.ts` and `../Outcome.tsx` and nothing else from the platform. Render every outcome
   the SDK can return — `pending_approval` and `denied_*` are normal states, not errors.
7. **Register the tab** in `apps/console/src/App.tsx`.
8. **Verify** with `npm run lint && npm run typecheck && npm test`, then exercise the app in the
   browser as each seeded role, including at least one denial and one approval path.
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
