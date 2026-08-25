# KYC Review Queue

The only app in this repository, and it is an app on the platform rather than part of it: no SQL, no
vendor SDK, no credentials, and no policy of its own. Every read and every effect goes through a
`kyc.*` capability the kernel enforces. See `docs/apps/kyc-review-queue.md` for the capability spec.

## Run

```bash
npm install      # from the repo root
npm run setup    # Postgres in Docker, migrations, seed
npm run dev      # API :8080, console :5173, this app :5174
```

The app talks to the platform API over `@rangka/sdk`; Vite proxies `/api` to the API host. There is
no in-app kernel and no fixtures — an app-side copy of the rules would be free to disagree with the
copy that is enforced, and the point of the platform is that it cannot.

## What to try

The demo is arranged so the guardrails are visible rather than described:

- **KYC-1041** (low risk, clean) — approve it as Compliance. Executes immediately, one audit row.
- **KYC-1043** (high risk, PEP hit) — approve it as the Reviewer. Refused: the reviewer lacks
  `kyc:decide`. As the Lead the result is `pending_approval`, not success, because the requirement is
  derived from the case. Approve it yourself in the inbox and the runtime denies you — four-eyes.
- **KYC-1045** (unresolved OFAC hit) — a decision needs an approver holding `kyc:sar`, so the Lead
  cannot clear it and the second compliance officer can.
- **Reveal PII** on any case — needs a justification, is metered at 20/hour and writes its own audit
  row. Masked is the default because unmasking is a separate capability with a separate scope.
- **Stale revisions** — open a case in two tabs, decide in one, then the other. The second is a
  `conflict`, and the idempotency key derived from the revision makes a double-click one effect.
- **Audit tab** — every one of the above, denials included, with the policy that produced them.

The identity switcher is the platform's dev auth stub (`x-platform-user`), standing in for SSO, and the
directory is the seeded platform users rather than a list this app keeps. There are two compliance
officers, because four-eyes plus a compliance-only tier means a SAR raised by the only officer could
never be cleared.

## Layout

```
src/platform/contracts.ts   capability names and I/O types (policy comes from the registry)
src/platform/client.ts      KYC-typed view of the SDK client
src/views/                  queue, case, approvals inbox, audit trail
```
