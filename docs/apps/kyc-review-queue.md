# KYC Review Queue — app spec

An app on Rangka. It is ordinary TypeScript UI code with **no database access, no
vendor SDKs, and no privileged network egress**. Everything it does happens through capabilities the
platform kernel enforces: `authz → limits → idempotency → approval → execute → audit`.

The point of choosing KYC as the first real app: it is the worst case for an internal tool. It touches
raw PII, it produces regulator-visible decisions, some of its actions are irreversible, and the people
using it are the ones most likely to be socially engineered. If Rangka's guardrails hold here, refunds
and feature flags are trivial.

## What the app does

Reviewers work a queue of onboarding cases that automated screening could not clear. For each case they
see the applicant, their documents, screening hits (sanctions / PEP / adverse media), device and
geo-risk signals, and a risk score breakdown. They then take exactly one terminal decision — approve,
reject, request more information, or escalate to enhanced due diligence — and every step is written to
the audit log with the capability, inputs (PII-redacted), policy decision, and outcome.

## Capability surface

The app may call these and nothing else. Names are stable; inputs/outputs are Zod schemas in
`packages/capabilities/kyc`.

These are the kernel's own policy shapes — `{ scope, maxRows }` for reads, `{ scope, idempotent, limits,
approval, approverScope }` for writes — so a descriptor here can be handed to `defineRead` / `defineWrite`
unchanged.

| Capability | Kind | Scope | Approval | Limit | Idempotent by |
| --- | --- | --- | --- | --- | --- |
| `kyc.cases.list` | read | `kyc:read` | — | ≤100 rows | — |
| `kyc.cases.get` | read | `kyc:read` | — | ≤1 row | — |
| `kyc.case.pii.reveal` | write | `kyc:pii` | never, but justification required | 20/hour | `caseId + timestamp` |
| `kyc.case.claim` | write | `kyc:review` | never | 120/hour | `caseId + userId` |
| `kyc.case.requestInfo` | write | `kyc:review` | never | 60/hour | `caseId + revision` |
| `kyc.case.escalate` | write | `kyc:review` | never | 20/hour | `caseId + revision` |
| `kyc.case.approve` | write | `kyc:decide` | derived from the case (below) | 50/hour | `caseId + revision` |
| `kyc.case.reject` | write | `kyc:decide` | derived from the case (below) | 50/hour | `caseId + revision` |
| `kyc.case.sar.file` | write (irreversible) | `kyc:sar` | always, `kyc:sar` | 5/hour | `caseId` |

Unmasking PII is declared a **write** even though it returns data: the kernel meters and rate-limits
writes, and a disclosure is an effect worth metering.

### The approval requirement is a function of the case, not the button

Resolved at invocation time from the case itself, so a reviewer cannot lower it by picking a different
capability:

- **low / medium risk, no unresolved hits** → executes immediately under the reviewer's own scope.
- **high risk, or any unresolved hit** → `pending_approval`; a second human holding `kyc:decide` must
  approve before the effect happens.
- **unresolved OFAC / EU / UK sanctions hit** → the approver must hold `kyc:sar`.
- **`kyc.case.sar.file`** → always approved by another `kyc:sar` holder, and write-once: there is no
  unfile capability.

The requester may never approve their own request, and the check is on user id, not display name.

**This is what `approval: { mode: "derived_from_subject" }` exists for.** The rule is a function of the
*record being acted on*, not of the input, so it is declared as SQL clauses over the subject row rather
than resolved in a handler: each clause carries the `approverScope` it demands and a `because` the UI can
show, first match wins, and the resolved scope is written onto the approval row so later edits to the
clauses cannot lower the bar on a request already waiting. The same clauses are re-evaluated over
committed data by the `carries_the_declared_approval` invariant, so the rule is proved, not merely applied.

`pending_approval` is a first-class result the app renders, not an error. The decision is recorded as
*requested* immediately, so the audit trail shows intent even when approval is later denied.

### PII is a capability, not a field

`kyc.cases.get` returns masked identifiers (`•••• 4821`, `j••@example.com`). Unmasking is a separate
capability that requires a free-text justification, is rate-limited per reviewer, and emits a
high-severity audit event. This makes "reviewer bulk-exported the customer table" a policy violation the
runtime can refuse rather than an incident discovered later.

## Data the platform owns

Business tables (in the same Postgres, owned by the platform, reachable only through capabilities):

- `kyc_cases` — applicant ref, status, risk band, score, queue, SLA due, revision counter
- `kyc_case_documents` — type, uploaded at, verification result
- `kyc_screening_hits` — provider, list, match strength, resolution
- `kyc_case_events` — append-only per-case timeline, joined to the platform audit log by `audit_id`

`revision` is the optimistic-concurrency token. Every write capability takes the revision the reviewer
was looking at; a stale revision is rejected. Two reviewers cannot decide the same case twice, and the
idempotency key derives from it, so a double-clicked approve is one effect.

## Frontend

`apps/kyc-review` is a Vite + React app whose only platform dependencies are `@rangka/sdk` and
`@rangka/app-kit`. It talks to a `PlatformClient` narrowed to KYC's capability map
(`src/platform/client.ts`), so `invoke` is typed per capability while the transport, outcomes, approvals
and audit are the platform's: `createClient()` posts to `POST /api/capabilities/:name/invoke` with
`{ input, idempotencyKey }` and the `x-platform-user` identity header. There is no mock — the app runs
against the real runtime and the real Postgres, which is the only version worth demoing.

Approvals and audit are read through the platform surfaces (`approvals()`, `decide()`, `audit()`) rather
than KYC-specific capabilities, so an approval raised by this app is decided in the same inbox as one
raised by any other.

## What this proves about the platform

1. An app author never writes SQL, never holds a credential, and cannot exceed their scope.
2. Dangerous actions are gated by data-derived policy, not by UI affordances — hiding a button is not a
   control, and the app does not pretend it is.
3. Every effect has an audit row before the user sees a result.
4. The screen can be rewritten, or replaced by another app over the same verbs, without any of the above
   changing — which is what makes generated app code safe to accept.
