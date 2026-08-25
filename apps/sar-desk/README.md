# SAR desk

`npm run dev` starts it with everything else — http://localhost:5177. On its own:
`npx vite --config apps/sar-desk/vite.config.ts`, alongside `npm run dev:api` and a seeded database.

Three verbs, all already on the platform:

| Verb | Declared policy (served by the registry) |
| --- | --- |
| `kyc.cases.list` | `{ scope: "kyc:read", maxRows: 100 }` |
| `kyc.cases.get` | `{ scope: "kyc:read", maxRows: 1 }` |
| `kyc.case.sar.file` | `{ scope: "kyc:sar", idempotent: true, limits: { maxAmountCents: null, maxPerHour: 5 }, approval: { mode: "always" }, approverScope: "kyc:sar", subject: { table: "kyc_cases", idField: "caseId" }, effect: { table: "kyc_sars", subjectColumn: "case_id", oncePerSubject: true } }` |

What follows from those numbers, rather than from anything in this folder:

- Every seeded role holds `kyc:read`, so the escalated queue is readable by all of them. Only an
  admin holds `kyc:sar`, so an agent or a KYC lead pressing **File SAR** gets `denied_scope`,
  refused before the narrative is parsed. The button is not hidden: a refusal the user can see is
  the point.
- `approval: { mode: "always" }` means a filing is never immediate. Every submission returns
  `pending_approval` — the handler has not run — and waits for a *second* holder of `kyc:sar`;
  `u_admin` files, `u_admin_2` signs. The platform refuses a requester deciding their own request.
- `oncePerSubject` makes a second filing on the same case unrepresentable, backed by a unique
  index and a derived invariant. This screen does not check it.
- The idempotency key is `kyc.case.sar.file:<caseId>:<revision>`, so a double click or a retry
  replays the stored response rather than raising a second request.
- The narrative is sent as typed; the 40-character floor lives in the capability's schema, so
  `invalid_input` is the runtime speaking.
- `kyc.cases.get` returns the runtime's own `previewApproval` answer, which the draft panel renders
  verbatim — the warning "this will be held, and the decider must hold `kyc:sar`" is the enforced
  rule, not a copy of it.
- `kyc.case.sar.file` halts read from `GET /api/invariants` and render as a banner naming the
  invariant, so a user whose filing just stopped can see why and that only `invariants:clear`
  resumes it.

The approvals table is the platform's own surface (`platform.approvals()` / `platform.decide()`),
not a KYC verb, so a filing raised here is decided the same way as anything else the runtime holds.
