# 0002 — Policy is declared metadata, not handler code

**Status:** accepted

## Context

If a generated capability enforces its own limits with `if` statements, then every capability is a
fresh audit surface and every review is an exercise in spotting a missing branch. Reviewers are
bad at that and get worse with volume — which is precisely what a generator produces.

## Decision

Write capabilities declare `scope`, `idempotent`, `limits`, `approval`, `approverScope` and
`amountField` as data. The runtime reads the declaration and enforces it. Handlers contain domain
logic only. Declarations are validated at registration, so a malformed one fails at boot rather
than at the first refund.

## Consequences

- Review becomes "is `maxAmountCents: 200_000` right?" — answerable by a risk owner in seconds —
  instead of "is this control flow exhaustive?".
- The declared policy of every capability is queryable: it is mirrored into `capability_registry`
  at boot, so compliance never has to read TypeScript.
- The runtime must supply idempotency, rate limiting and approval storage, because capabilities
  are no longer allowed to implement them.
- Expressiveness is capped by the policy vocabulary. Extending it is a platform change with tests,
  which is the point: the vocabulary is small enough to reason about.
