# transaction-authorization (Java)

Decides whether a debit against a customer account may proceed. This is the service the
demo focuses on: the rules are small enough to read in five minutes and important enough
that a regulator would ask how they are tested.

## Rules, in the order they are applied

1. **Shape** — ids are `[A-Za-z0-9_-]{1,64}`, amount is `0 < n <= £1,000,000`, currency is GBP/USD/EUR, merchant category is non-blank. → `INVALID_REQUEST`
2. **Existence** — the account is known. → `ACCOUNT_NOT_FOUND`
3. **Ownership** — the requesting customer owns the account. → `NOT_ACCOUNT_OWNER`
4. **Status** — the account is not frozen or closed. → `ACCOUNT_FROZEN` / `ACCOUNT_CLOSED`
5. **Daily limit** — today's spend plus this amount stays within the account's limit. → `DAILY_LIMIT_EXCEEDED`
6. **Funds** — the available balance covers the amount. → `INSUFFICIENT_FUNDS`
7. **Idempotency** — a request id is honoured once. → `DUPLICATE_REQUEST`

Every decision, approved or declined, is written to the audit sink with **masked** customer
and account identifiers (last four characters only).

## Current test baseline

One test: the happy path. Nothing exercises a decline, the audit trail, masking, the day
rollover, or idempotency. That is the gap the demo asks Devin to close.

```bash
cd services/java && mvn -q -B -pl transaction-authorization test
open transaction-authorization/target/site/jacoco/index.html
```
