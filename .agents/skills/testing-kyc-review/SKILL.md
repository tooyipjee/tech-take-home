---
name: testing-kyc-review
description: How to run and UI-test the kyc-review app (apps/kyc-review) and other capability-platform apps whose kernel enforces authz, rate limits, idempotency, approval tiers and audit.
---

# Testing the KYC review queue app (apps/kyc-review)

## Running it
- `apps/kyc-review` is a Vite + React app with **no backend**: it runs against an in-browser mock kernel
  (`src/platform/mock/kernel.ts`) seeded with 6 cases from `src/platform/mock/fixtures.ts`. No Postgres, no API host.
- It is an npm workspace of the repo root, so the root `npm install` covers it. Start it from the repo root:
  ```bash
  npm run dev:kyc     # http://localhost:5174
  ```
  `npm run dev` starts every app at once: api :8080 · console :5173 · refunds :5175 · review queue :5176 · kyc :5174.
- Checks: `npm run -w @align/kyc-review lint` and `npm run -w @align/kyc-review build` (build typechecks first).
- `?adapter=api` swaps the mock kernel for the SDK's HTTP client against the real API host (which needs Postgres
  and `npm run setup` first) — leave it off for UI testing, since the mock kernel is what makes the policy
  flows self-contained.
- Do not reach for `pnpm` here; the root workspace is npm, and corepack has broken signature keys on Devin boxes.

## Critical testing constraint
Kernel state (cases, approvals, audit) lives **in memory per page load**. Reloading the tab resets everything.
Plan the whole multi-role scenario as one uninterrupted browser session and never reload mid-run.

## UI map
- Header: nav tabs `Queue` / `Approvals` / `Audit`, plus an "Acting as" `<select>` identity switcher listing four
  actors: Reviewer Priya (`kyc:read kyc:pii kyc:review`), Lead Tom (`+ kyc:decide`), and two compliance officers,
  Dana and Samir (`+ kyc:sar`). Two officers exist so a SAR raised by one can be cleared by the other.
  Switching identity does **not** reset kernel state — it's the intended way to test four-eyes flows.
- Case view: Applicant card (`Reveal PII`), Decision card with mode tabs
  (Approve / Reject / Request info / Escalate / File SAR), rationale textarea, Timeline.
- Buttons for actions the role lacks are deliberately left **enabled** — that is the point: the runtime, not the UI,
  must refuse. Clicking them is the correct adversarial test.

## Policy behaviours worth asserting
- Denials surface as red toasts titled `Denied · <code with underscores replaced>` and always write an audit row.
  Verify the case's status pill **and** revision number are unchanged after each denial.
- Tier resolution (`resolveTier`): SAR → always `dual_compliance`; approve/reject with unresolved
  OFAC/EU/UK sanctions hits → `dual_compliance`; high risk or any unresolved hit → `dual_lead`; else `none`.
- Self-approval is checked **before** the compliance-scope check, so a lead's attempt on his own
  dual-compliance request reports `self approval`, not `forbidden scope`. To prove the scope gate you must
  approve a request raised by *someone else* (e.g. Tom on Dana's SAR request).
- Validation minimums: PII justification ≥ 10 chars, decision note ≥ 20 chars, SAR narrative ≥ 40 chars.
- A successful PII reveal writes a high-severity audit row rendered with the `row--high` red tint.
- The Audit tab is the ground truth: each row carries actor+role, capability, target, outcome pill
  (executed / denied / pending approval) and the policy string that produced it.

## Gotchas
- Four-eyes is keyed on `requestedById` vs the actor's `userId`, not display names, so two actors sharing a role
  are still distinct approvers.
- Textareas are cleared after every submit attempt, including denied ones — retype the input each time.
- Use `browser_console` at the end to confirm no React warnings/uncaught errors.

## Devin Secrets Needed
None.
