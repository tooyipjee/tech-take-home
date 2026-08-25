# Refunds desk

`npm run dev` starts it with everything else — http://localhost:5175. On its own:
`npx vite --config apps/refunds/vite.config.ts`, alongside `npm run dev:api` and a seeded database.

Three verbs, all declared in `packages/capabilities/src/refunds.ts`:

| Verb | Declared policy (served by the registry) |
| --- | --- |
| `refunds.payments.list` | `{ scope: "refunds:read", maxRows: 100 }` |
| `refunds.payments.get` | `{ scope: "refunds:read", maxRows: 1 }` |
| `refunds.issue` | `{ scope: "refunds:issue", idempotent: true, limits: { maxAmountCents: 200000, maxPerHour: 10 }, approval: { mode: "above_amount", amountCents: 50000 }, approverScope: "refunds:approve", amountField: "amountCents", subject: { table: "payments", idField: "paymentId" }, effect: { table: "refunds", subjectColumn: "payment_id", amountColumn: "amount_cents", live: { column: "status", equals: "issued" }, conserves: { table: "payments", via: "payment_id", amountColumn: "amount_cents" } } }` |

What follows from those numbers, rather than from anything in this folder:

- An agent refunds up to **$500** alone. Above it, `approval: { mode: "above_amount" }` returns
  `pending_approval`, the handler has not run, and nothing is owed to the customer until a holder
  of `refunds:approve` who is not the requester signs. The screen says "waiting for a supervisor"
  and never "refunded".
- **$2,000** is `maxAmountCents`, and a ceiling is not a threshold: above it the refund is refused
  with `denied_limit` and *no approval is raised*. A supervisor gets the same answer as an agent.
- `conserves` means the sum of live refunds against a payment can never exceed the payment. The
  screen shows what is left, but does not enforce it — the amount is sent as typed and the runtime
  answers `conflict` with how much is actually left, which is what a stale screen deserves.
- 10 accepted refunds an hour per person is `maxPerHour`; the eleventh is `rate_limited`.
- The idempotency key is `refunds.issue:<paymentId>:<refundedSoFar>:<amount>`, so a double click
  replays the first answer rather than refunding the customer twice.
- The reason field's 10-character floor lives in the capability's schema, so a bare "n" comes back
  as `invalid_input` from the runtime, not from a check here.
- The threshold and ceiling in the guidance text and in every refusal are read from
  `GET /api/capabilities`. Change the declaration and this screen changes with it; there is no copy
  of either number in this folder.
- The warning before submitting is `previewApproval()`'s answer, served by `refunds.payments.get`
  — the same rule that will be enforced, not a restatement of it.

Compliance officers hold `refunds:approve` but not `refunds:issue`, so `requiredScopes` locks this
tile for them while the console's own approvals inbox stays open: they sign refunds off without
raising any. The queue at the bottom of this screen is the platform's approvals surface
(`platform.approvals()` / `platform.decide()`) filtered to refunds, so a supervisor can sign
without leaving the payment they were looking at, and an agent — who cannot read it — is told so
rather than shown an empty table.

Every outcome is translated into what it means for the customer's money, because "denied_limit" is
not a sentence you can read to someone on the phone; `src/outcomes.tsx` is that mapping and is the
only place the wording lives.
