# KYC Review Queue — app spec

An app on the internal tool platform. It is ordinary TypeScript UI code with **no database access, no
vendor SDKs, and no privileged network egress**. Everything it does happens through capabilities the
platform kernel enforces: `authz → limits → idempotency → approval → execute → audit`.

The point of choosing KYC as the first real app: it is the worst case for an internal tool. It touches
raw PII, it produces regulator-visible decisions, some of its actions are irreversible, and the people
using it are the ones most likely to be socially engineered. If the platform's guardrails hold here,
refunds and feature flags are trivial.

## What the app does

Reviewers work a queue of onboarding cases that automated screening could not clear. For each case they
see the applicant, their documents, screening hits (sanctions / PEP / adverse media), device and
geo-risk signals, and a risk score breakdown. They then take exactly one terminal decision — approve,
reject, request more information, or escalate to enhanced due diligence — and every step is written to
the audit log with the capability, inputs (PII-redacted), policy decision, and outcome.

## Capability surface

The app may call these and nothing else. Names are stable; inputs/outputs are Zod schemas in
`packages/capabilities/kyc`.

| Capability | Effect | Scope | Approval tier | Limits | Idempotent by |
| --- | --- | --- | --- | --- | --- |
| `kyc.cases.list` | read | `kyc:read` | none | 120/min/user | — |
| `kyc.cases.get` | read | `kyc:read` | none | 300/min/user | — |
| `kyc.case.pii.reveal` | read (sensitive) | `kyc:pii` | none, but justification required | 20/hour/user | — |
| `kyc.case.claim` | write | `kyc:review` | none | 1 open claim per case | `caseId + userId` |
| `kyc.case.requestInfo` | write | `kyc:review` | none | 3 per case | `caseId + revision` |
| `kyc.case.escalate` | write | `kyc:review` | none | 20/day/user | `caseId + revision` |
| `kyc.case.approve` | write | `kyc:decide` | tiered (below) | 50/day/user | `caseId + revision` |
| `kyc.case.reject` | write | `kyc:decide` | tiered (below) | 50/day/user | `caseId + revision` |
| `kyc.case.sar.file` | write (irreversible) | `kyc:sar` | always dual, `compliance_officer` | 5/day/org | `caseId` |

### Approval tiers are a function of the case, not the button

The runtime resolves the tier from the case's risk band at invocation time, so a reviewer cannot lower
it by calling a different capability:

- **low / medium risk** → executes immediately under the reviewer's own scope.
- **high risk**, or any case with an unresolved sanctions/PEP hit → `pending_approval`; a second human
  holding `kyc_lead` (or `compliance_officer` for sanctions) must approve before the effect happens.
  The requester may never approve their own request.
- **`kyc.case.sar.file`** → always dual approval, and it is write-once: there is no unfile capability.

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

`apps/kyc-review` is a Vite + React app talking to a single typed `CapabilityClient` interface
(`src/platform/client.ts`). Two adapters implement it:

- **mock** (default) — an in-browser implementation of the kernel: it evaluates scope, limits,
  idempotency, and approval tier against seeded fixtures and writes an audit log. It exists so the app
  can be built and demoed before the API host is up, and so the policy behaviour is testable without
  Postgres.
- **http** — posts to the API host's `POST /v1/capabilities/:name/invoke` with the dev auth headers.
  Selected by setting `VITE_CAPABILITY_API`.

The app is written against the interface only, so switching adapters is an env var, not a refactor. Any
divergence between the two is a bug in the mock, and the mock's policy table is copied from the spec
above.

## What this proves about the platform

1. An app author never writes SQL, never holds a credential, and cannot exceed their scope.
2. Dangerous actions are gated by data-derived policy, not by UI affordances — hiding a button is not a
   control, and the app does not pretend it is.
3. Every effect has an audit row before the user sees a result.
4. The same app code runs against a mock kernel and the real one, which is what makes it reviewable.
