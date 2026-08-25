# 0005 — An app is discovered, not listed

Adding an app used to mean editing five places outside the app folder: a `dev:` script, a
`build:` script, `build:apps`, the root `tsconfig.json` exclude list, and (before the launcher
became manifest-driven) the console itself. Every one of them is a step a tier-1 session can
forget, and each failure is silent in a different way — the app runs locally but never builds in
CI, or typechecks against the wrong `lib`, or never appears on the launcher at all.

So the repository now reads the set of apps off the filesystem. `scripts/apps.mjs` lists every
folder under `apps/` that has a `vite.config.ts`; `npm run dev`, `npm run build:apps` and
`npm run typecheck` all derive their work from it, as the boundary check and the console launcher
already did. **A new app is a folder** is now true of the whole toolchain, not just the launcher.

The one thing that could still be wrong is the manifest, and the failure mode is a tile that
opens a port nothing is listening on. `scripts/check-boundaries.mjs` now also checks each
`app.json`: it exists, it has every field the launcher reads, `folder` matches the directory,
`url` names the port the Vite config pins, `requiredScopes` is a subset of `scopes`, and — the
useful one — every scope it declares is a scope some role actually holds in
`packages/kernel/src/auth.ts`. An app asking for a scope nobody can be granted is a permanently
locked tile, and it is the exact symptom of a tier-1 session that should have escalated to
tier 2 instead.

`apps/console` gained its own `tsconfig.json` for the same reason: the root project is now the
platform and the API, and every app owns its own DOM-flavoured typecheck, so the root config no
longer names any app.

## Invariants affected

None. No capability, policy declaration, migration, effect table or derived invariant changed;
`invariants()` produces the same 29 statements, and `npm test` (which asserts that set) is
unchanged. This is toolchain and static-check work, and it appears here only because
`scripts/check-` is protected: the checks that enforce the boundaries are themselves tier-2
surface, which is the correct rule — a weakened check is indistinguishable from a weakened
guarantee.

The manifest check is *additive* static enforcement: previously nothing prevented a manifest from
advertising a scope the platform never issues.

## How it was verified

- `npm run lint` — the boundary and manifest checks pass on `apps/kyc-review`; deliberately
  breaking the manifest (wrong port, unknown scope `flags:write`, `requiredScopes` outside
  `scopes`, deleted file) fails the check with the specific reason in each case.
- `npm run typecheck` — root project plus `apps/console` and `apps/kyc-review` against their own
  configs.
- `npm test` (13) and `npm run test:db` (15) unchanged, `npm run reconcile` clean.
- `npm run build:apps` builds both discovered apps; `npm run dev` starts api :8080, console :5173
  and kyc :5174 from discovery alone.

## Rollback

Revert this change record and the commit. The old explicit `dev:console` / `dev:kyc` /
`build:console` / `build:kyc` scripts and the root-config exclude come back with it; nothing in
the database, the capability registry or the invariant set is touched, so there is no data
consequence and no halt to clear. The only loss is the manifest check, after which a broken
`app.json` becomes a runtime discovery again.
