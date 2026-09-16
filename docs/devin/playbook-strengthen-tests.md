# Playbook — strengthen tests on a critical path

For services under `services/`. You are given one service and one behaviour that matters (money
moves, someone is authenticated, PII is handled, an audit record is written). You leave behind a
PR a reviewer can trust without re-deriving it.

## Rules

1. **Do not change production code.** If a test you write fails against the current code, that is
   a finding. Leave the failing test in, mark it clearly, and put the finding at the top of the PR.
   Never edit the code under test to make a test pass.
2. **Test behaviour, not lines.** Every decline reason, every boundary (`limit`, `limit + 1`),
   every branch that decides whether something is written, masked or refused. Coverage is a
   by-product; state it but do not chase it.
3. **Use the toolchain already in the service.** JUnit 5 + JaCoCo for Java, `node --test` for
   TypeScript, pytest + pytest-cov for Python. If a service has no test framework, adding the
   minimal one that matches its siblings is in scope; adding a new dependency is not.
4. **Synthetic data only.** Nothing that looks like a real card number, account, or person.
5. **Reproducible.** Every number in the PR comes from a command that is also in the PR.

## Steps

1. Read the service's README and the code under test. Write down the rules in the order the code
   applies them, in your own words, before writing a test. Put this list in your first message.
2. Run the existing tests and coverage. Record line and branch coverage — both. Note which
   branches the existing tests miss.
3. Write the tests. One test per rule or boundary, named for the behaviour
   (`declinesWhenRequesterDoesNotOwnAccount`, not `test3`). Group with nested classes or
   `describe` where it helps a reader.
4. Run them. Then run the fault-injection script for the service, if there is one
   (`docs/demo/inject-fault.sh`), and confirm each injected fault makes at least one test fail.
   Restore. Include that evidence in the PR.
5. Run coverage again. Report before/after for lines and branches.
6. Open the PR with: what behaviour is now proved, the commands, the coverage table, what you
   did not test and why, and any findings. Label `tier-3: infrastructure` if you touched CI.

## PR description template

```
## What is now tested
- <rule> → <test name>
## Reproduce
cd services/java && mvn -q -B -s ../maven-settings.xml -pl <service> test
## Coverage
| | lines | branches |
| before | | |
| after  | | |
## Fault injection
<fault> → <failing test>
## Not tested
<what, and why>
## Findings
<anything the tests revealed about the code, or "none">
```
