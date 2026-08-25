# Platform change: an app is a folder, and the SDK carries an idempotency key

Tier: 2 (extends the framework)

## What changed

Structural, so that "build an internal tool" means "add a folder under `apps/`":

- `apps/refunds/` and `apps/review-queue/` — the two screens that lived inside the
  console (`apps/console/src/apps/*`) are now standalone apps with their own
  `package.json`, Vite config and port. `apps/kyc-review` already was one.
- `apps/console` is no longer a host for apps: it is the platform surface
  (approvals, audit, registry, tenets) plus a launcher that links to each app.
- `packages/app-kit` — what an app gets besides the SDK: the client bound to the
  acting user, the identity switcher, the outcome banner and the stylesheet. It
  imports `@platform/sdk` and nothing deeper, so it cannot widen what an app can
  reach; it exists so a new app is a screen rather than a re-implemented shell.
- `scripts/check-boundaries.mjs` — instead of a hand-maintained list of app
  directories, every folder under `apps/` except the two platform hosts (`api`,
  `console`) is scanned. A new app is covered the moment it exists.

Carried in the same change, from moving the KYC app onto the SDK:

- `packages/sdk/src/index.ts` — `invoke()` takes an optional idempotency key, so an
  app can make a retry provably the same call instead of relying on a fresh UUID
  per click. `ApprovalSummary` exposes `decidedBy`/`decidedAt`, which the API
  already returned.
- `packages/kernel/src/runtime.ts` — `decideApproval` now also requires the
  capability's declared `approverScope`, not just `approvals:decide`.
- `packages/kernel/src/auth.ts`, `packages/db/src/seed.ts` — KYC scopes on the three
  roles, and a second compliance admin so a SAR approval has someone to go to.

## Tenets affected

None weakened or removed.

`approvals.decided_by_a_second_person` is strengthened in the runtime: previously a
holder of the generic `approvals:decide` scope could decide any held invocation,
including one whose capability declares a stronger `approverScope`. The tenet
itself already spoke in terms of the declared scope; the runtime now agrees with
it before the fact rather than the reconciler catching it after.

The boundary check is widened, not relaxed: it now covers three app roots instead
of two, and cannot silently miss a fourth. `packages/app-kit` is deliberately not
in the tier-2 protected list — it holds no policy, only presentation and a bound
client — so app authors can extend the shell without a change record. If it ever
grows something that decides what an app may do, it belongs behind the SDK
instead.

Not affected: nothing here touches the schema, the derived tenet set, the
reconciler, or any capability's declaration.

## How it was verified

`npm run lint && npm run typecheck && npm test`, plus `vite build` for each app.
The boundary check reports the app roots it scanned, which is how the widened
coverage is visible rather than assumed.

The approver-scope rule is exercised in `packages/kernel/test/db/invariants.test.ts`
("an approval is decided by someone holding the capability's approverScope"): a
supervisor holding `approvals:decide` but not `flags:write` is refused, the refusal
is audited, and an admin then clears the same approval.

The two relocated screens are import-level moves: same capability names, same
inputs, no behaviour change to verify beyond the build.

## Rollback

Revert the commit. The app folders are additive and the console keeps working
without them; the SDK's idempotency key is optional, so callers that omit it
behave exactly as before. The runtime's approver-scope check is the only
behavioural revert: dropping it returns to generic `approvals:decide`, which the
reconciler would then be the only thing catching.
