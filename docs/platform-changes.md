# Platform changes

One record per tier-2 or tier-3 change, in the order they happened. `npm run lint` fails if the
platform is edited without adding one.

These are **history, not current documentation**: a record describes what the platform could
promise before and after that change, so older ones name capabilities, apps and terms that no
longer exist (`refunds.issue`, the generic review queue, `tenet`, `@platform/*`). For how the
platform works today, read [the architecture](architecture.md) and the [README](../README.md).

| # | Change |
| --- | --- |
| [0001](platform-changes/0001-deterministic-invariants.md) | Invariants derived from declarations, proved three times |
| [0002](platform-changes/0002-rename-tenets-to-invariants.md) | `tenet` became `invariant`, in code and in the schema |
| [0003](platform-changes/0003-apps-are-folders.md) | An app is a folder under `apps/`, not a route in the console |
| [0004](platform-changes/0004-kyc-is-the-only-app.md) | KYC became the only domain; refunds and the generic queue were removed |
| [0005](platform-changes/0005-an-app-is-discovered-not-listed.md) | Every script and the launcher discover `apps/*` from `app.json` |
| [0006](platform-changes/0006-tiers-are-labelled-and-there-are-three.md) | Three tiers, detected from the diff and labelled on the PR |
| [0007](platform-changes/0007-one-playbook-and-a-name.md) | Two playbooks became one, and the platform was named Rangka |
