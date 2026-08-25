# 0007 — The platform is called Rangka, and there is one playbook

Two changes with no runtime behaviour between them.

**The name.** The platform was "the internal tool platform", which is a description, not a name.
It is now **Rangka** — Malay for the frame — and the npm scope follows: `@platform/*` and the one
stray `@align/kyc-review` are all `@rangka/*`. Mechanical rename across imports, Vite aliases, the
boundary check patterns, the console title and the docs.

**One playbook.** `playbook-build-an-app.md` and `playbook-extend-the-platform.md` are replaced by
`docs/devin/playbook.md`. The tier is no longer something the requester has to know before asking:
the playbook opens with triage — does an app already do this, can an existing app be extended
instead of adding a tile, and only then which tier — and escalates itself. Tier 1 builds; tier 2
builds *and* announces that it changes what the platform can promise, leading the PR with the
invariants added and the policy numbers a human is approving; tier 3 stops.

The reason for one file rather than two: the previous split asked the human to pick the playbook,
which is the one decision they are least equipped to make and the one the diff can answer
mechanically. Escalation belongs inside the procedure, not in front of it.

## Invariants affected

None. No capability, policy declaration, migration, scope or invariant changed; `npm test` derives
the same set as before.

## How it was verified

`npm run lint` (boundary + tier + manifest), `npm run typecheck`, `npm test`, `npm run test:db`
against a real Postgres, `npm run build:apps`, and both apps exercised in the browser through the
launcher after the rename.

## Rollback

Revert the commit. The rename is source-only — nothing is persisted under either package scope, so
no data migration is involved and a running database is unaffected.
