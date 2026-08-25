# KYC Review Queue

An app on the platform, not part of it. It contains no SQL, no vendor SDK, and no credentials — every
effect goes through a capability the kernel enforces. See `docs/apps/kyc-review-queue.md` for the
capability spec and why KYC was chosen as the first real app.

## Run

```bash
pnpm install
pnpm dev            # http://localhost:5174
```

By default the app runs against a **mock kernel** (`src/platform/mock/kernel.ts`) that implements the same
middleware chain as the real runtime — authz → limits → idempotency → approval → execute → audit — over
seeded fixtures. To point it at the API host instead:

```bash
VITE_CAPABILITY_API=http://localhost:8080 pnpm dev
```

Nothing in `src/views` or `src/components` changes between the two; both adapters implement
`CapabilityClient` in `src/platform/client.ts`.

## What to try

The demo is arranged so the guardrails are visible rather than described:

- **KYC-1041** (low risk) — approve it. Executes immediately, one audit row.
- **KYC-1043** (high risk, PEP hit) — approve it as the Reviewer. Refused: the reviewer lacks `kyc:decide`.
  Switch to Lead and approve: the result is `pending_approval`, not success. Approve it yourself in the
  approvals inbox and the runtime denies you — four-eyes. Switch to Compliance to clear it.
- **KYC-1045** (unresolved OFAC hit) — any decision escalates to `dual_compliance`; only Dana can approve.
- **Reveal PII** on any case — requires a justification, is rate-limited, and writes a high-severity audit
  row. The masked view is the default because unmasking is a separate capability.
- **Stale revisions** — open a case in two tabs, decide in one, then decide in the other. The second call
  is denied on optimistic concurrency, and the idempotency key derived from the revision means a
  double-click is one effect.
- **Audit tab** — every one of the above, including the denials, with the policy that produced them.

The role switcher in the top bar is the dev auth stub (`x-actor-role`), standing in for SSO.

## Layout

```
src/platform/contracts.ts   capability names, I/O types, policy metadata (mirrors the registry)
src/platform/client.ts      CapabilityClient interface + HTTP adapter
src/platform/mock/          in-browser kernel + seeded fixtures
src/views/                  queue, case, approvals inbox, audit trail
```
