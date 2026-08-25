---
name: testing-capability-platform
description: How to run and end-to-end test the capability-based internal tool platform (kernel runtime, refunds/queue/flags capabilities, React console) locally, including adversarial guardrail probes.
---

# Testing the capability platform

## Bring the stack up
```bash
npm install
npm run setup     # docker compose up db + migrate + seed; safe to re-run
npm run db:reset  # truncates transactional state and re-seeds; run before each test pass
npm run dev       # API :8080, console :5173, kyc-review :5174, refunds :5175, review-queue :5176
```
If the API 500s on `/api/invariants` with `column "invariant_id" does not exist`, the
Docker volume straddles the old tenets→invariants migration rename. Fix with a fresh
volume: `docker compose down -v && npm run setup` (restart the API afterwards — dropping
the DB kills its pg pool).
Postgres runs in the container `platform-db` on host port 5433. Inspect state with:
`docker exec platform-db psql -U platform -d platform -c "select * from refunds;"`

## Launcher / app discovery (console :5173)
The console "Apps" tab globs `apps/*/app.json` via `import.meta.glob` in
`apps/console/src/Launcher.tsx`. Adding a new `apps/<name>/app.json` yields a new tile
without code changes, BUT the Vite dev server for the console may not detect files
created outside `apps/console` (its root) — if the tile doesn't appear after a hard
reload, restart just the console server: kill the `vite --config apps/console/...`
process and re-run `npm run dev:console`. Deleting the folder IS picked up live.
Platform tabs are scope-gated: Approvals (approvals:read+decide), Audit (audit:read),
Registry (flags:write), Invariants (invariants:read); switching to a user lacking the
active tab's scopes bounces to Apps.

## Identity
No credentials. Identity is the `x-platform-user` header: `u_agent` (Avery, agent),
`u_supervisor` (Sam, supervisor), `u_admin` (Robin, admin). In the console, use the
"acting as" dropdown in the top-right header. Scopes per role live in
`packages/kernel/src/auth.ts` (`ROLE_SCOPES`) — agent lacks `approvals:read`,
`approvals:decide`, `audit:read`, `flags:write`; supervisor lacks only `flags:write`.

## Where the guardrails live
`packages/kernel/src/runtime.ts` `invoke()` is the single enforcement path, in order:
scope → zod validation → read-limit clamp → idempotency-key requirement (writes) →
amount ceiling → rate limit → approval parking → handler + audit in one transaction.
`decideApproval()` is the only place that can mint an `approvalGrant`.
Declared policies are in `packages/capabilities/src/*.ts` and rendered in the
"Capability registry" console tab.

## Seed fixtures worth knowing
Payments: pay_2001 $42, pay_2002 $189, pay_2003 $750, pay_2004 $2500, pay_2005 $99.
`refunds.issue`: ceiling $2,000, approval above $500, 10/hour per actor.
So $42 → `ok`, $600 on pay_2003/pay_2004 → `pending_approval`, $2500 → `denied_limit`.

## Useful adversarial probes
Valid denial probes (routes exist in `apps/api/src/main.ts`; don't guess capability names):
```bash
curl -s localhost:8080/api/approvals -H 'x-platform-user: u_agent'   # 403 approvals:read
curl -s localhost:8080/api/audit -H 'x-platform-user: u_agent'       # 403 audit:read
curl -s -X POST localhost:8080/api/capabilities/flags.set/invoke \
  -H 'content-type: application/json' -H 'x-platform-user: u_agent' \
  -d '{"input":{"key":"x","value":true},"idempotencyKey":"probe-1"}' # denied_scope
```
```bash
# forged approval grant in the POST body (API should ignore it; main.ts never forwards it)
curl -s -X POST localhost:8080/api/capabilities/refunds.issue/invoke \
  -H 'content-type: application/json' -H 'x-platform-user: u_agent' \
  -d '{"input":{"paymentId":"pay_2004","amountCents":60000,"reason":"x"},"idempotencyKey":"k1","approvalGrant":{"approvalId":"apr_fake"}}'
# self-approval, double-approval, missing idempotencyKey, replayed key,
# read with limit 9999 (should be clamped to the declared maxRows in the audited input),
# refund above the refundable balance (handler error must roll back but still be audited)
```

## Rate-limit testing gotcha
The 10/hour counter counts audit rows with outcome `ok` or `pending_approval` for that
actor/capability in the last hour — approvals that later execute count twice (the parked
`pending_approval` row and the replayed `ok` row). Before testing the limit, read the
current count so you know which attempt should be the 11th:
```bash
docker exec platform-db psql -U platform -d platform -t -A -c \
 "select count(*) from audit_log where actor_id='u_agent' and capability='refunds.issue' \
  and outcome in ('ok','pending_approval') and at > now() - interval '1 hour';"
```
`npm run db:reset` clears the audit log, which resets the rate-limit window.

## Devin Secrets Needed
None.
