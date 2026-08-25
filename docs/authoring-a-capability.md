# Authoring a capability

The workflow the platform is designed around:

1. **A human writes a one-paragraph spec**, in risk terms rather than code terms:
   > Chargeback analysts need to submit evidence for an open dispute. Max one submission per
   > dispute; no money moves; analysts can do it unattended; everything logged.
2. **Devin implements it** — a capability in `packages/capabilities`, plus the app screen.
3. **A human reviews the declaration first**, and the handler second.
4. **A human tests it in the console** with the *acting as* switcher, then merges.

## The shape

```ts
export const submitEvidence = defineWrite({
  name: "disputes.submitEvidence",
  summary: "Attach evidence to an open dispute",
  input: z.object({ disputeId: z.string().min(1), evidence: z.string().min(10).max(4000) }),
  policy: {
    scope: "disputes:write",
    idempotent: true,
    limits: { maxAmountCents: null, maxPerHour: 60 },
    approval: { mode: "never" },
    approverScope: "approvals:decide",
  },
  handler: async (input, ctx) => { /* only ctx.data and input are in scope */ },
});
```

## Rules that the runtime, not the reviewer, enforces

- A write capability that omits `limits` or `approval` **fails to register at boot**.
- A capability declaring an amount ceiling or amount-based approval without an `amountField`
  **fails to register at boot**.
- Writes without an idempotency key are rejected at invocation.
- Reads cannot return more than their declared `maxRows`.
- Every invocation — including denials — is audited; successful effects commit with their audit
  record or not at all.

## Review checklist

Read the policy block before the handler:

- [ ] Is `scope` the narrowest existing scope? A new scope is a bigger decision than a new verb.
- [ ] Is `maxAmountCents` a number a risk owner would sign off on, and is it a *ceiling* rather
      than a threshold? Nothing overrides a ceiling, not even approval.
- [ ] Does `maxPerHour` bound the blast radius of a loop in app code or a stuck retry?
- [ ] Does the approval rule match who carries the loss if this is wrong?
- [ ] Does the handler use only `ctx.data` and `input`? No imports of `pg`, no vendor SDKs, no
      reads of `process.env`.
- [ ] Does the handler re-check business invariants (refundable balance, item still open)?
      The runtime enforces policy; the handler enforces domain truth.

## Anti-patterns

| Don't | Do |
| --- | --- |
| `if (user.role === "admin")` inside a handler | declare a `scope` |
| A capability taking a SQL fragment or a table name | one capability per verb |
| `refunds.adminIssue` with no ceiling to bypass approval | change the declared rule, in review |
| An app calling three capabilities to fake a transaction | one capability doing the whole unit |
