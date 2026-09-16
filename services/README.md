# services/ — the digital-banking monorepo scenario

A stand-in for the customer's estate: thirteen small services in Java, TypeScript and Python
with uneven, mostly thin, test coverage. **All code and data are synthetic.** Nothing here
comes from, or resembles, a real bank's systems.

The point of this folder is the demo in [`docs/demo/README.md`](../docs/demo/README.md):
give Devin a scoped testing task on one critical path and watch what comes back — the tests,
the evidence, the PR.

## Inventory

| Service | Lang | What it does | Critical path | Test framework | Tests | CI job |
| --- | --- | --- | --- | --- | --- | --- |
| `java/transaction-authorization` | Java 17 | may this debit proceed? | **transaction, authz, PII, audit** | JUnit 5 + JaCoCo | 1 (happy path) | yes |
| `java/account-ledger` | Java 17 | append-only postings, derived balances | transaction | **none** | 0 | no |
| `java/payments-gateway` | Java 17 | outbound payment instructions, rail choice | transaction | JUnit 5 + JaCoCo | 4 (sort codes only) | yes |
| `java/customer-auth` | Java 17 | password hashing, lockout, step-up | **authentication** | **none** | 0 | no |
| `java/audit-log` | Java 17 | hash-chained audit records | **audit** | JUnit 5 + JaCoCo | 1 | yes |
| `ts/mobile-bff` | TypeScript | shapes data for mobile screens, masks PANs | PII | `node --test` | 2 | yes |
| `ts/notifications` | TypeScript | channel choice, push/SMS templates | **PII** | **none** | 0 | no |
| `ts/card-controls` | TypeScript | freeze, caps, category blocks | transaction | `node --test` | 2 | yes |
| `ts/onboarding-api` | TypeScript | applicant parsing and eligibility | PII, input validation | **none** | 0 | no |
| `python/fraud-scoring` | Python 3.10+ | rule-based risk score | transaction | pytest + pytest-cov | 2 | yes |
| `python/pii-redaction` | Python 3.10+ | redacts PAN/account/NINO/email in text | **PII** | **none** | 0 | no |
| `python/statement-generator` | Python 3.10+ | monthly statements from postings | transaction | **none** | 0 | no |
| `python/kyc-document-ocr` | Python 3.10+ | MRZ check digits, expiry, name match | KYC | **none** | 0 | no |

Seven of thirteen services have no test framework and no CI job. Where coverage exists it is
line coverage from a happy-path test, which is exactly the number that flatters: run
`make coverage` and compare the line and branch columns for `transaction-authorization`.

## Running things

Toolchain: JDK 17 + Maven 3.6+, Node 22.18+ (type-stripping `node --test`), Python 3.10+
with `pytest` and `pytest-cov`. No other dependencies.

```bash
cd services
make test        # every service that has tests
make coverage    # one table: line and branch coverage per service, "none" where there is no framework
make typecheck   # TypeScript services
```

Per service: `cd java && mvn -q -B -pl transaction-authorization test` · `cd ts/mobile-bff && npm test` ·
`cd python/fraud-scoring && python3 -m pytest`.

If Maven Central rate-limits you (HTTP 429), `make test` already passes `-s maven-settings.xml`,
which mirrors central to Google's copy.

## Where the bugs are meant to be found

Nothing is deliberately broken on `main`. The demo injects a fault live
(`docs/demo/inject-fault.sh`) so the room can see whether the new tests catch it. If you are
writing tests and one fails, that is a finding, not a fixture — report it.
