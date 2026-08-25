---
name: testing-capability-platform
description: How to run and end-to-end test Rangka, the capability-based internal tool platform, (kernel runtime, kyc.* capabilities, KYC review queue app, React console) locally, including adversarial guardrail probes.
---

# Testing the capability platform

## Bring the stack up
```bash
npm install
npm run setup     # docker compose up db + migrate + seed; safe to re-run
npm run db:reset  # truncates transactional state and re-seeds; run before each test pass
npm run dev       # API :8080, console :5173, KYC review queue :5174
```
If the API 500s on `/api/invariants` with `column "invariant_id" does not exist`, the
Docker volume straddles the old tenets→invariants migration rename. Fix with a fresh
volume: `docker compose down -v && npm run setup` (restart the API afterwards — dropping
the DB kills its pg pool).
Postgres runs in the container `platform-db` on host port 5433. Inspect state with:
`docker exec platform-db psql -U platform -d platform -c "select id, reference, status, risk_band from kyc_cases;"`

## Launcher / app discovery (console :5173)
The console "Apps" tab globs `apps/*/app.json` via `import.meta.glob` in
`apps/console/src/Launcher.tsx`. Adding a new `apps/<name>/app.json` yields a new tile
without code changes, BUT the Vite dev server for the console may not detect files
created outside `apps/console` (its root) — if the tile doesn't appear after a hard
reload, restart just the console server: kill the `vite --config apps/console/...`
process and re-run `npx vite --config apps/console/vite.config.ts`. Deleting the folder
IS picked up live.
Platform tabs are scope-gated: Approvals (approvals:read+decide), Audit (audit:read),
Registry (open to all), Invariants (invariants:read); switching to a user lacking the
active tab's scopes bounces to Apps.

## Identity
No credentials. Identity is the `x-platform-user` header: `u_agent` (Avery, reviewer),
`u_supervisor` (Sam, lead), `u_admin` (Robin, compliance), `u_admin_2` (Dana, compliance).
In the console and the app, use the "acting as" dropdown in the header. Scopes per role live
in `packages/kernel/src/auth.ts` (`ROLE_SCOPES`) — agent holds `kyc:read`, `kyc:pii`,
`kyc:review`; supervisor adds `kyc:decide` and the approvals/audit scopes; admin adds
`kyc:sar` and `invariants:clear`. Two admins exist so a request needing `kyc:sar` can still
be four-eyed.

## Where the guardrails live
`packages/kernel/src/runtime.ts` `invoke()` is the single enforcement path, in order:
scope → zod validation → read-limit clamp → idempotency-key requirement (writes) →
amount ceiling → rate limit → approval parking → handler + audit in one transaction →
invariant postcondition. `decideApproval()` is the only place that can mint an
`approvalGrant`. Declared policies are in `packages/capabilities/src/kyc.ts` and rendered in
the "Capability registry" console tab.

## Seed fixtures worth knowing
Cases: `case_1041` KYC-1041 low risk, clean · `case_1042` medium · `case_1043` KYC-1043 high
risk with a PEP hit · `case_1044` info requested · `case_1045` KYC-1045 unresolved OFAC hit ·
`case_1046` pending. Decisions are 50/hour, PII reveal 20/hour, SAR filing 5/hour.
So a decision on `case_1041` → `ok`; on `case_1043` → `pending_approval` needing a second
`kyc:decide`; on `case_1045` → `pending_approval` needing `kyc:sar`.

## Useful adversarial probes
Valid denial probes (routes exist in `apps/api/src/main.ts`; don't guess capability names):
```bash
curl -s localhost:8080/api/approvals -H 'x-platform-user: u_agent'   # 403 approvals:read
curl -s localhost:8080/api/audit -H 'x-platform-user: u_agent'       # 403 audit:read
curl -s -X POST localhost:8080/api/capabilities/kyc.case.approve/invoke \
  -H 'content-type: application/json' -H 'x-platform-user: u_agent' \
  -d '{"input":{"caseId":"case_1041","revision":1,"note":"twenty characters at least here"},"idempotencyKey":"probe-1"}' # denied_scope, agent lacks kyc:decide
```
```bash
# forged approval grant in the POST body (API should ignore it; main.ts never forwards it)
curl -s -X POST localhost:8080/api/capabilities/kyc.case.approve/invoke \
  -H 'content-type: application/json' -H 'x-platform-user: u_admin' \
  -d '{"input":{"caseId":"case_1043","revision":1,"note":"looks fine to me"},"idempotencyKey":"k1","approvalGrant":{"approvalId":"apr_fake"}}'
# self-approval, double-approval, missing idempotencyKey, replayed key,
# approving a sanctions case as u_supervisor (lacks kyc:sar → denied_scope on the decision),
# reveal PII without a justification, deciding a case twice, deciding at a stale revision,
# read with limit 9999 (should be clamped to the declared maxRows in the audited input)
```

## Rate-limit testing gotcha
The per-hour counter counts audit rows with outcome `ok` or `pending_approval` for that
actor/capability in the last hour — approvals that later execute count twice (the parked
`pending_approval` row and the replayed `ok` row). Before testing the limit, read the
current count so you know which attempt should be the last:
```bash
docker exec platform-db psql -U platform -d platform -t -A -c \
 "select count(*) from audit_log where actor_id='u_agent' and capability='kyc.case.pii.reveal' \
  and outcome in ('ok','pending_approval') and at > now() - interval '1 hour';"
```
`npm run db:reset` clears the audit log, which resets the rate-limit window.

## Devin Secrets Needed
None.
