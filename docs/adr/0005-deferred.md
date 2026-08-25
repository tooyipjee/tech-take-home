# 0005 — Deliberately not built

**Status:** accepted

Named so that nobody mistakes an omission for an oversight.

| Not built | Why it is safe to defer | What it will cost |
| --- | --- | --- |
| Real authentication (OIDC/SSO) | Every route consumes a resolved `Principal`; the dev header is confined to `resolvePrincipal()` | One function, plus session handling |
| Row- and column-level policy | Current apps are back-office wide-read; PII masking is not yet load-bearing | A policy layer inside `DataSource`, applied per principal |
| Outbox / external side effects | Nothing leaves the database yet | Outbox table plus a worker; required before a capability calls a payment processor |
| Approval expiry and multi-party approval | Single-approver covers the demo rules | Runtime change in `decideApproval` |
| Per-tenant isolation | Single-tenant internal tooling | Tenant id on principal, capability and every business table |
| App-level deploys | Every app already builds and serves on its own port; nothing yet ships anywhere | A per-app pipeline and a host, once app count makes one release painful |
| Approval notifications | The inbox is polled by whoever is on shift | An outbox plus a channel integration |

The general rule: defer anything that can be added *below* the app boundary later, because those
additions do not require rewriting generated apps. Never defer something that would have to be
retrofitted *into* app code — that is the bet the whole architecture makes.
