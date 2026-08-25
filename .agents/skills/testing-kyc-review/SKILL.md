---
name: testing-kyc-review
description: How to run and UI-test the kyc-review app (apps/kyc-review), which runs on the real platform API — capabilities, approvals, rate limits and audit are enforced server-side.
---

# Testing the KYC review queue app (apps/kyc-review)

## Running it
- `apps/kyc-review` is a Vite + React app with **no local state and no mock kernel**: every screen is
  a `kyc.*` capability call against the API, which needs Postgres. From the repo root:
  ```bash
  npm run setup     # Postgres in Docker, migrate, seed — required
  npm run dev       # api :8080 · console :5173 · kyc :5174
  ```
  `npx vite --config apps/kyc-review/vite.config.ts` alone will render "Connecting to the platform…" forever without the API.
- Checks: `npm run -w @align/kyc-review lint` and `npm run -w @align/kyc-review build`.
- Do not reach for `pnpm` here; the root workspace is npm, and corepack has broken signature keys on
  Devin boxes.

## Critical testing constraint
State is in Postgres and **persists across reloads**, so reloading mid-scenario is safe — but a case
can only be decided once. `npm run db:reset` re-seeds and clears the audit log (which also resets the
rate-limit windows); do that between test passes rather than hunting for an undecided case.

## UI map
- Header: nav tabs `Queue` / `Approvals` / `Audit`, plus an "Acting as" `<select>` fed by
  `GET /api/users`: Avery (`kyc:read kyc:pii kyc:review`), Sam (`+ kyc:decide`), Robin and Dana
  (`+ kyc:sar`). Two compliance officers exist so a request needing `kyc:sar` still has a second pair
  of eyes. Switching identity only changes the `x-platform-user` header.
- Case view: Applicant card (`Reveal PII`), Decision card with mode tabs
  (Approve / Reject / Request info / Escalate / File SAR), rationale textarea, Timeline.
- Policy chips render the **served** capability registry (`GET /api/capabilities`), so a policy edit
  shows up in the UI without an app change.
- Buttons for actions the role lacks are deliberately left **enabled** — that is the point: the
  runtime, not the UI, must refuse. Clicking them is the correct adversarial test.

## Policy behaviours worth asserting
- Denials surface as red toasts titled `Denied · <code with underscores replaced>` and always write an
  audit row. Verify the case's status pill **and** revision number are unchanged after each denial.
- Approval requirement is derived from the case, server-side (`derived_from_subject`): SAR → always;
  approve/reject with an unresolved OFAC/EU/UK hit → needs `kyc:sar`; high risk or any unresolved hit
  → needs a second `kyc:decide`; a clean low/medium case → decided outright. The app displays this
  from `kyc.cases.get`'s `decisionApproval`, so a wrong warning means a runtime bug, not a UI bug.
- Self-approval is refused before the scope check, so a lead's attempt on his own request reports
  self-approval, not a scope denial. To prove the scope gate, approve a request raised by *someone
  else* (e.g. Sam on Dana's SAR request — he should be refused for lacking `kyc:sar`).
- Deciding a case twice, or at a stale `revision`, returns `conflict`, not `error`.
- A successful PII reveal writes a high-severity audit row and a `kyc_pii_disclosures` effect row.
- The Audit tab is ground truth: actor+role, capability, target, outcome pill and the policy that
  produced it.

## Gotchas
- Four-eyes is keyed on user id, not display name, so two officers sharing a role are distinct
  approvers.
- Textareas are cleared after every submit attempt, including denied ones — retype the input.
- Use `browser_console` at the end to confirm no React warnings/uncaught errors.

## Devin Secrets Needed
None.
