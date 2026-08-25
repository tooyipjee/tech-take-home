# Feature flags

`npm run dev` starts it with everything else — http://localhost:5178. On its own:
`npx vite --config apps/feature-flags/vite.config.ts`, alongside `npm run dev:api` and a seeded
database.

Two verbs, both introduced by the tier-2 change recorded in
`docs/platform-changes/0008-feature-flags.md`:

| Verb | Declared policy (served by the registry) |
| --- | --- |
| `flags.list` | `{ scope: "flags:read", maxRows: 200 }` |
| `flags.flip` | `{ scope: "flags:write", idempotent: true, limits: { maxAmountCents: null, maxPerHour: 30 }, approval: { mode: "derived_from_subject", clauses: [{ when: "s.protected = true", approverScope: "flags:write" }] }, approverScope: "flags:write", subject: { table: "feature_flags", idField: "flagId" }, effect: { table: "feature_flag_changes", subjectColumn: "flag_id", tracksState: { column: "enabled", fromColumn: "from_enabled", toColumn: "to_enabled" } } }` |

What follows from those numbers, rather than from anything in this folder:

- Every seeded role holds `flags:read`, so the list is readable by all of them: which features are
  on is not a secret from the people working under them. Only an admin holds `flags:write`, so an
  agent or a KYC lead pressing **Turn on** gets `denied_scope`, refused before the input is parsed.
  The button is not hidden — a refusal the user can see is the point.
- `approval.mode: "derived_from_subject"` asks the flag row, not the caller: `s.protected = true`
  holds and a flip returns `pending_approval` and waits for a *second* holder of `flags:write`;
  it does not hold and the flip is immediate. The platform refuses a requester deciding their own
  request, so `u_admin` asks and `u_admin_2` signs.
- Nothing here creates a flag or marks one protected. Which switches exist and which of them gate
  money is a reviewed change to the platform, not an action this screen can take.
- The per-hour allowance on screen is read from the served declaration, so it is the number the
  runtime is enforcing rather than a copy that can drift. There is no amount: flipping a switch
  moves no money, even where the feature behind it does.
- The idempotency key is `flags.flip:<flagId>:<revision>:<state asked for>`, so a double click or
  a retry replays the stored response instead of flipping twice, and a flag that moved while the
  page was open returns `conflict`.
- `effect.tracksState` is what makes the change history the authority and the switch a projection
  of it. A flag whose state does not match its recorded flips halts `flags.flip`, which this screen
  renders as *flipping is paused* — reading is unaffected, and only `invariants:clear` resumes it.
- Outcomes are rendered as consequences, not as the platform's vocabulary: the screen never names a
  scope, a capability or an invariant. `GET /api/invariants` and the console are where that belongs.

The approvals table is the platform's own surface (`platform.approvals()` / `platform.decide()`),
not a flag verb, so a flip raised here is decided the same way as anything else the runtime holds.
