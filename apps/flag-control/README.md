# Flag control

`npm run dev:flags` — http://localhost:5177 (needs `npm run dev:api`).

Two verbs, both already on the platform:

| Verb | Declared policy (served by the registry) |
| --- | --- |
| `flags.list` | `{ scope: "flags:read", maxRows: 200 }` |
| `flags.set` | `{ scope: "flags:write", idempotent: true, limits: { maxAmountCents: null, maxPerHour: 30 }, approval: { mode: "never" }, approverScope: "approvals:decide" }` |

What follows from those numbers, rather than from anything in this folder:

- Every seeded role holds `flags:read`, so the table is readable by all three. Only `admin` holds
  `flags:write`, so an agent or supervisor pressing **Apply** gets `denied_scope` — refused before
  the input is parsed. The button is not hidden: a refusal the user can see is the point.
- Nothing here moves money, so there is no ceiling (`maxAmountCents: null`) and no `denied_limit`,
  and no approval rule (`mode: "never"`) so no `pending_approval`. The blast radius is bounded by
  `maxPerHour: 30` instead — the 31st change in an hour is `rate_limited`.
- The idempotency key is derived from the state being requested (`flags.set:<key>:<enabled>:<pct>`),
  so a double click or a retry comes back `replayed` with no second write.
- The rollout figure is sent as typed. The capability's schema decides whether it is an integer
  between 0 and 100; `invalid_input` is the runtime answering, not this screen pre-empting it.
- `flags.set` halts are read from `GET /api/invariants` and shown as a banner, so a user whose work
  just stopped can see which invariant stopped it and that only `invariants:clear` resumes it.

The policy chip renders the declaration the registry serves, so editing the declaration changes
what this app displays without an edit here.
