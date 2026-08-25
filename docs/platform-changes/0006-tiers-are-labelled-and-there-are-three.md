# 0006 — Tiers are labelled, and there are three of them

The tier of a change decides how much review it gets, which makes it exactly the wrong thing to
leave as a claim the author makes about their own pull request. `scripts/check-tier.mjs` already
knew the answer — it computes it in order to fail a platform edit with no change record — so it now
prints it, `--label` emits nothing but the label, and `.github/workflows/tier-label.yml` puts that
label on the PR. One derivation, three consumers: the failing check, the developer's terminal, and
the label a reviewer sorts by.

A third tier is named for the first time. Tier 1 (an app) and tier 2 (the platform's promises) were
already the split; **tier 3 is the infrastructure the other two stand on** — CI, the API host, the
console shell and launcher, the build tooling, the root configs. It is not a stricter version of
tier 2, it is a different axis: a tier-2 change alters what can be proved, while a tier-3 change
alters *how the proving happens at all*, and a weakened workflow is worth more to an attacker than
a weakened capability. It is reserved for people who own the platform.

Tier 3 is deliberately **not blocked** by the check. A script cannot tell who you are, and a check
that pretends to enforce authorisation it cannot enforce is worse than an honest label: it invites
the belief that the boundary is mechanical when it is social. The label asks for the review; branch
protection or CODEOWNERS is where that would be made real, and neither is in this change.

Two details worth knowing:

- The **highest tier the diff reaches wins**. A PR touching CI and an app is an infrastructure PR;
  requesting the lighter review because most of the files were harmless is the failure mode.
- `package-lock.json` is deliberately *not* infrastructure. Adding an app adds a workspace, so a
  legitimate tier-1 PR changes the lockfile, and escalating it for that would train people to
  ignore the label.

## Invariants affected

None. No capability, declaration, migration, effect or derived invariant changed; the 29 statements
`invariants()` produces are the same, and the change-record and invariant-coverage rules the tier
check already enforced are untouched. This record exists because `scripts/check-` is protected
surface — the checks that enforce the boundaries are themselves tier-2 material, and now tier-3 as
well.

## How it was verified

- `node scripts/check-tier.mjs` on this branch reports tier 3 and the elevated-review note, which
  is correct: the branch edits `.github/`, `scripts/` and the root `package.json`.
- `node scripts/check-tier.mjs --label` emits `tier-3: infrastructure` and nothing else, including
  when no git base is available (empty output rather than the "skipped" line).
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:db`, `npm run reconcile`,
  `npm run build:apps` all pass.
- The workflow itself is verified by CI on this PR: the label it applies is visible on the pull
  request, and the labels are created on first use so a fresh fork needs no manual setup.

## Rollback

Delete `.github/workflows/tier-label.yml` and revert the `INFRASTRUCTURE`, `LABELS` and `--label`
additions to `scripts/check-tier.mjs`. The tier check returns to failing only on a missing change
record; existing labels stay on their PRs and can be deleted by hand. Nothing in the database, the
registry or the invariant set is involved, so there is no data consequence and no halt to clear.
