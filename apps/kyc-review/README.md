# KYC Review Queue

An app on the platform, not part of it. It contains no SQL, no vendor SDK, and no credentials — every
effect goes through a capability the kernel enforces. See `docs/apps/kyc-review-queue.md` for the
capability spec and why KYC was chosen as the first real app.

## Run

```bash
npm install                        # from the repo root
npm run -w @align/kyc-review dev   # http://localhost:5174
```

By default the app runs against a **mock kernel** (`src/platform/mock/kernel.ts`) that implements the same
middleware chain as the real runtime — authz → validation → limits → idempotency → approval → execute →
audit — over seeded fixtures, so the guardrails are demonstrable with no Postgres and no API host.

With the platform running (`npm run dev` at the root), open <http://localhost:5174/?adapter=api> and the
same views run against the real kernel over `@platform/sdk`; Vite proxies `/api` to the API host.

Nothing in `src/views` or `src/components` changes between the two: both are a `PlatformClient` from the
SDK, narrowed to KYC's typed capabilities in `src/platform/client.ts`.

## What to try

The demo is arranged so the guardrails are visible rather than described:

- **KYC-1041** (low risk) — approve it. Executes immediately, one audit row.
- **KYC-1043** (high risk, PEP hit) — approve it as the Reviewer. Refused: the reviewer lacks `kyc:decide`.
  Switch to Lead and approve: the result is `pending_approval`, not success. Approve it yourself in the
  approvals inbox and the runtime denies you — four-eyes. Switch to Compliance to clear it.
- **KYC-1045** (unresolved OFAC hit) — any decision needs an approver holding `kyc:sar`, so only the other
  compliance officer can clear it.
- **Reveal PII** on any case — requires a justification, is rate-limited, and writes a high-severity audit
  row. The masked view is the default because unmasking is a separate capability.
- **Stale revisions** — open a case in two tabs, decide in one, then decide in the other. The second call
  is denied on optimistic concurrency, and the idempotency key derived from the revision means a
  double-click is one effect.
- **Audit tab** — every one of the above, including the denials, with the policy that produced them.

The identity switcher in the top bar is the platform's dev auth stub (`x-platform-user`), standing in for
SSO; the ids match the seeded users, so switching identity means the same thing in both adapters. There are
two compliance officers in the directory, because four-eyes plus a compliance-only tier means a SAR raised
by the only officer could never be cleared.

## Layout

```
src/platform/contracts.ts   capability names, I/O types, registry-shaped descriptors
src/platform/client.ts      KYC-typed PlatformClient + the SDK-backed HTTP adapter
src/platform/mock/          in-browser kernel + seeded fixtures
src/views/                  queue, case, approvals inbox, audit trail
```
