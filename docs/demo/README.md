# Demo runbook — strengthening tests on a critical banking path

For the 18 Sept session. 12 minutes of demonstration inside a 45-minute meeting, so every step
below has one thing the room should notice.

**Scenario:** a monorepo of 13 Java/TypeScript/Python services with thin, uneven coverage
(`services/README.md`). **Target:** `services/java/transaction-authorization` — small enough
to read in the room, important enough that an examiner would ask about it. **Data:**
synthetic throughout.

## Before the meeting

- [ ] `cd services && make coverage` on `learning` — screenshot the table. The story is in
      `transaction-authorization`: ~84% lines, ~45% branches, one test.
- [ ] Open the Devin session in a second window, playbook attached
      (`docs/devin/playbook-strengthen-tests.md`), environment already set up.
- [ ] Rehearse `docs/demo/inject-fault.sh ownership` and `--restore` once.
- [ ] Have `AuthorizationService.java` open in an editor. It is 90 lines.

## In the room (11–23 min)

**1. Baseline (2 min).** Show the coverage table and the single existing test. Point out that
line coverage says 84% and no decline path has a test. This is the "what does the percentage
measure" question from the brief, answered by example.

**2. Define the outcomes (1 min).** Read the rule order from
`services/java/transaction-authorization/README.md`. Name the three the demo cares about:
authorised request, another customer's account (`NOT_ACCOUNT_OWNER`), invalid input
(`INVALID_REQUEST`). Ask the security engineer which of the others they would add.

**3. Delegate (2 min).** Start the Devin session with the playbook and this task:

> Strengthen the tests for `services/java/transaction-authorization`. Cover every decline
> reason, the audit trail (every decision audited, identifiers masked), day rollover and
> idempotency. Do not change production code. Report line and branch coverage before and after,
> and list what you could not test.

Narrate what Devin is doing while it runs: reading the service, running the existing test,
writing tests, running them, opening a PR. If it is slow, switch to a pre-recorded session or a
PR prepared earlier and say so.

**4. Fault injection (3 min).** On the PR branch:

```bash
docs/demo/inject-fault.sh ownership          # clearly labelled in the terminal
cd services/java && mvn -q -B -s ../maven-settings.xml -pl transaction-authorization test
```

The new ownership test should fail; the original happy-path test still passes. That contrast
is the whole point: the old suite would have merged this. Then:

```bash
docs/demo/inject-fault.sh --restore && mvn -q -B -s ../maven-settings.xml -pl transaction-authorization test
```

If time allows, `audit-masking` is the second fault to show — PII in an audit log is the one the
examiner cares about.

**5. Review the PR (3 min).** Walk the description: commands to reproduce, coverage before/after,
what was not tested and why. Show the CI run. Ask the architect what else a reviewer would want.

## What this does not show

Production readiness, regulatory compliance, effectiveness across all thirteen services, or
anything involving the customer's code. Say this out loud before questions.

## Fallbacks

- Maven Central 429s: `make test` already uses `services/maven-settings.xml` (Google mirror).
- Devin session stalls: show the prepared PR; the fault injection works against any branch that
  has the tests.
- Projector fails: the coverage table and the PR description are both plain text — paste them.
