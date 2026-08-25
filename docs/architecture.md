# Architecture

## The one decision everything follows from

Apps are generated. Review is the only human gate, and review is fallible. So the properties
that must never fail are not properties of app code — they are properties of the runtime.

Concretely: an application can express *what* it wants (`refunds.issue`, `$600`, this payment).
It cannot express *whether it is allowed*, *how much is too much*, *who must approve*, or
*whether to write an audit record*. Those are decided by the runtime from a declaration attached
to the capability, and there is no code path that skips them.

## Layers

| Layer | Written by | Reviewed how | May touch |
| --- | --- | --- | --- |
| App (`apps/console/src/apps`) | Devin | Skimmed — it cannot do damage | `@platform/sdk` only |
| Capability (`packages/capabilities`) | Devin from a human spec | Read in full, line by line | `ctx.data`, its own input |
| Runtime (`packages/kernel`) | Devin under the tier-2 playbook | Read in full, with adversarial DB tests and a change record | Everything |
| Data (`packages/db`) | Devin under the tier-2 playbook | Migrations reviewed; additive only | Postgres |

The boundary is mechanically enforced by `npm run lint`, which fails if app code imports the
kernel, the data layer, capability handlers, `pg`, or calls `fetch` directly — and, separately,
if a change edits the platform without a record under `docs/platform-changes/`, or registers an
invariant no test names. The two playbooks in `docs/devin/` are the two sides of that line.

## The invocation pipeline

Every call — read or write, allowed or denied — goes through `invoke()` in
`packages/kernel/src/runtime.ts`:

1. **Resolve** the capability from the registry. Unknown name → `not_found`.
2. **Authorise**: the principal's scopes must contain the capability's declared scope.
   Denials happen before input is even parsed, so a malformed hostile payload never reaches a
   schema written by a generator.
3. **Validate** input with the capability's Zod schema. Read capabilities have their `limit`
   clamped to the declared `maxRows`, so an app cannot ask for the whole table.
4. **Require an idempotency key** for every write. There is no way to opt out: the type demands
   `idempotent: true` and the runtime rejects writes without a key.
5. **Rate limit** from the audit log itself — accepted invocations per actor per capability per
   hour. The audit log being the source of truth means the limit cannot drift from the record.
6. **Amount ceiling**: the runtime reads the amount out of the validated input at the declared
   `amountField` and compares it to `maxAmountCents`. Over the ceiling is refused outright — no
   approval can override a ceiling, which is the difference between a limit and a threshold.
7. **Approval**: if the declared rule fires, the runtime persists the pending invocation and
   returns `pending_approval`. **The handler has not run.** Approval is not a UI convention here;
   it is a suspended invocation.
8. **Execute** inside one transaction. The handler receives a `DataSource` bound to that
   transaction and nothing else — no pool, no HTTP client, no vendor SDK.
9. **Audit** in the *same* transaction as the effect. An effect that commits without its audit
   record is not representable. Failures roll back the effect and are audited on a separate
   connection under the same invocation id, so denials and errors are recorded too.
10. **Prove the invariants** before commit. The invariants are re-derived inside the transaction
    from what it is about to commit; a violation aborts it, so the money never lands and only
    the audited refusal survives.

Writes are also refused up front (`halted`) while an invariant guarding that capability is violated.

## Invariants

An invariant is a statement about the data that must always be true, written as SQL that returns no
rows (`packages/kernel/src/invariants.ts`).

The set is **derived, not curated**. Two sources:

- **Axioms** — properties of the platform itself, true independently of any capability. Today:
  an approval is decided by someone other than its requester, and an effect nobody audited did
  not legitimately happen.
- **Declarations** — every write capability declares its policy (`maxAmountCents`, `approval`,
  `maxPerHour`, `idempotent`) and its `effect`: which table the row lands in, which column holds
  the amount moved, which rows count as live, and which finite pool it draws down. Each field
  generates the SQL that proves the committed data obeys it, so `refunds.issue` gets
  `conserves_payments`, `respects_declared_ceiling`, `carries_the_declared_approval`,
  `respects_declared_rate`, `is_idempotent` and `effects_are_attributed` without anyone writing
  a rule. A capability that moves money and declares no effect does not register
  (`PolicyDeclarationError`) — there would be nothing to prove.

That is what stops the set being arbitrary: a rule exists because a declaration says something,
and changing the declaration changes the rule in the same commit.

The same definition is enforced in three places:

| Layer | Catches | Cost of being wrong |
| --- | --- | --- |
| Database constraints and triggers | anything, including a kernel bug or a human with `psql` | the write fails loudly |
| Postcondition in the writing transaction | a handler that did something its declaration did not describe | the effect rolls back, refusal is audited |
| Reconciler, every 15s | drift that arrived by a path the runtime never saw — manual UPDATE, restore, migration | the guarded capability halts |

Thresholds inside invariant queries are read from `capability_registry`, so an invariant is derived
from the declaration a human approved rather than being a second copy that can drift from it.

Every effect row carries the `invocation_id` of the audited invocation that produced it. The
`DataSource` stamps it, not the handler, and a trigger plus a foreign key to `audit_log` make an
unattributable effect unrepresentable — the property the reconciler's "is this refund real?"
question depends on.

On a violation the platform halts the capabilities the invariant names: writes return `halted`,
reads and everything else keep serving, and only `invariants:clear` (admin) resumes it, once every
invariant guarding it passes again. See [ADR 0006](adr/0006-invariants-are-enforced-three-times.md).

## Approvals

`decideApproval()` is the only place an approval grant can be minted, and an HTTP caller cannot
supply one. On approval the runtime **replays the original request as the original requester** —
the refund is attributed to the agent who asked for it, not the supervisor who allowed it — and
the decision is itself an audited action. A requester may never approve their own request.

## What a policy declaration looks like

```ts
policy: {
  scope: "refunds:write",
  idempotent: true,
  limits: { maxAmountCents: 200_000, maxPerHour: 10 },
  approval: { mode: "above_amount", amountCents: 50_000 },
  approverScope: "approvals:decide",
  amountField: "amountCents",
}
```

That block is the review artifact. Reviewing *"is this handler correct?"* is hard and subjective;
reviewing *"should an agent be able to move up to $2,000, ten times an hour, unattended up to
$500?"* is a question a risk owner can answer in seconds. Malformed declarations fail at boot,
not at the first refund: a ceiling with no `amountField` refuses to register.

## Identity

`resolvePrincipal()` maps a user to a role, and a role to scopes. The dev implementation trusts an
`x-platform-user` header; production replaces that function alone. Capabilities declare scopes,
never roles, so adding a role never touches capability code.

## Postgres

One database, two concerns, deliberately: platform state (`platform_users`,
`capability_registry`, `approvals`, `idempotency_keys`, `audit_log`) and business data
(`customers`, `payments`, `refunds`, `feature_flags`, `review_queue_items`), plus the
reconciliation record (`invariant_runs`, `capability_halts`). They share a
database so that an effect and its audit record commit atomically — the property that makes the
audit log trustworthy. See [ADR 0004](adr/0004-postgres-as-system-of-record.md) for the cost of
that choice.
