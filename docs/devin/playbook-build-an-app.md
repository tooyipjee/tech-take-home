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

> Compliance leads need one screen showing every case waiting on a second signature, who raised it,
> what the platform decided it needs, and the audit trail behind it. No new decisions are taken here.

## Step 0 — decide, out loud, whether this is tier 1 at all

Do it before anything else, and say the answer in your first message. Tier 1 is when **every verb
the screen needs already exists** and every scope it needs is already held by a role.

| The app needs… | Tier | Why |
| --- | --- | --- |
| Only existing capabilities (`GET /api/capabilities`) | 1 | Nothing the platform promises changes |
| A capability that does not exist | 2 | A new verb is a new promise |
| A new table, column or seed row | 2 | Migrations are database-enforced invariants |
| A new scope, or a role to hold an existing one | 2 | `ROLE_SCOPES` is the kernel |
| A different ceiling, rate or approval threshold | 2 | Those numbers are the reviewed artifact |
| A different UI over the same verbs | 1 | This is the case the platform is optimised for |

The honest state of the repository today: the capability surface is `kyc.*` plus the platform's own
reads (approvals, audit, capability registry, invariants). A pure tier-1 app is therefore some other
view of that surface — a compliance oversight screen, a SAR desk, an audit explorer. **Any app in a
new domain — refunds, feature flags, chargebacks — begins with tier 2**, and pretending otherwise
in app code is the failure this playbook exists to prevent.

## Procedure

1. **Read the boundary first.** Read `docs/architecture.md` and
   `docs/authoring-a-capability.md`. Do not skip: the constraints there are the whole point of the
   platform, and violating them fails `npm run lint`.
2. **Inventory the verbs.** List every read and write the screen needs. Run the platform
   (`npm run setup && npm run dev`) and read `GET /api/capabilities`: it returns each capability's
   full declaration, including the policy the UI should be showing.
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
6. **Write the app** in its own folder, `apps/<app-name>/`, copying the shape of
   `apps/kyc-review`. The whole folder is:

   | File | Notes |
   | --- | --- |
   | `package.json` | `@align/<app-name>`, `private`, the same react/eslint deps |
   | `index.html`, `src/` | It may import `@platform/sdk` and `@platform/app-kit`, nothing else |
   | `vite.config.ts` | An unused port, `proxy: { "/api": "http://localhost:8080" }`, and the `@platform/*` aliases |
   | `tsconfig.json` | Extends the root one; every app owns its own typecheck |
   | `app.json` | `id`, `name`, `description`, `folder`, `url` (the port above), `scopes`, `requiredScopes` |

   Run `npm install` once after creating `package.json` so the workspace links.
7. **Do not wire it up anywhere else.** There is no list to add the app to: `npm run dev`,
   `npm run build:apps`, `npm run typecheck`, the boundary check and the console launcher all
   discover folders under `apps/`. Restart `npm run dev` afterwards — the new app needs a dev
   server, and the launcher only re-globs `app.json` at startup.
8. **Get the policy from the platform, never from a constant.** Render scopes, limits and approval
   requirements from the served declaration (`GET /api/capabilities`, and `previewApproval`-backed
   fields such as `kyc.cases.get`'s `decisionApproval`). A copy of a threshold in app code is a
   second source of truth that goes stale silently.
9. **Leave buttons enabled that the current user cannot use.** Disabling them hides the guarantee.
   Let the runtime refuse and render the refusal — that is the demo.
10. **Verify** with `npm run lint && npm run typecheck && npm test`, then exercise the app in the
    browser as each seeded role, including at least one denial and one approval path, and confirm
    the tile appears on the console launcher — offered to a role that holds `requiredScopes`,
    locked for one that does not.
11. **Open a PR** describing which existing capabilities the app composes and which outcomes it
    renders, and **label it `tier-1: app`** (CI applies the label too, from the paths in the diff
    — `npm run lint` prints which one it will be). If the label comes out as `tier-2: platform` or
    `tier-3: infrastructure`, the change is not the job this playbook was given: say so rather than
    merging it as an app.

    | Label | Means | If your app PR gets it |
    | --- | --- | --- |
    | `tier-1: app` | Only app folders changed | Expected — review is "does the screen do the job?" |
    | `tier-2: platform` | The kernel, capabilities, migrations, the SDK or the checks changed | Stop; that is the other playbook, with a change record and adversarial tests |
    | `tier-3: infrastructure` | CI, the API host, the console shell or the build changed | Stop; infrastructure is elevated and agreed with a platform owner first |

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
- Never declare a scope in `app.json` that no role holds — the tile is then permanently locked, and
  the boundary check fails. Needing the scope is a tier-2 escalation, not a manifest edit.
- Never treat a `halted` or `invariant_violation` outcome as a bug to route around. Surface it: the
  platform is telling the user it can no longer prove the operation is safe.

## Outcomes an app must render

`ok`, `replayed`, `pending_approval`, `denied_scope`, `denied_limit`, `rate_limited`,
`invalid_input`, `not_found`, `halted`, `invariant_violation`, `error`. All of them are normal
platform behaviour; none of them should reach the user as a stack trace.
