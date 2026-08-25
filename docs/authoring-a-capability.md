# Authoring a capability

Adding a capability is **tier-2 work**: it changes what the platform can promise, so it runs
under [`docs/devin/playbook-extend-the-platform.md`](devin/playbook-extend-the-platform.md) and
needs a change record under `docs/platform-changes/`. This page is the shape of the artifact;
the playbook is the procedure and the review it must pass.

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
- A capability that moves money (a non-null `maxAmountCents`) without an `effect` declaration
  **fails to register at boot**: with nowhere named for the money to land, no invariant can be
  derived and nothing about it could be proved after the fact.
- The `effect` declaration generates this capability's invariants — attribution, conservation
  against the pool it names, the ceiling, the approval rule, the rate, idempotency — which are
  then proved inside its own transaction and re-proved by the reconciler.
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
- [ ] Does `effect` name the right pool? `conserves` is the claim "this effect can never total
      more than that row"; naming the wrong table produces a rule that proves the wrong thing
      convincingly.
- [ ] Does the handler use only `ctx.data` and `input`? No imports of `pg`, no vendor SDKs, no
      reads of `process.env`.
- [ ] Does the handler re-check business invariants (the case is still open, the revision matches)?
      The runtime enforces policy; the handler enforces domain truth.

## Anti-patterns

| Don't | Do |
| --- | --- |
| `if (user.role === "admin")` inside a handler | declare a `scope` |
| A capability taking a SQL fragment or a table name | one capability per verb |
| `kyc.case.adminApprove` that skips the approval clause | change the declared rule, in review |
| An app calling three capabilities to fake a transaction | one capability doing the whole unit |
