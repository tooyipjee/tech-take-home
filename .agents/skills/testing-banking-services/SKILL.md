---
name: testing-banking-services
description: How to build, test and read coverage for the synthetic banking services under services/ (Java/Maven, TypeScript/node --test, Python/pytest), and how to run the demo fault injection.
---

# Testing the banking-scenario services

Everything lives under `services/`. Nothing needs installing beyond JDK 17, Maven, Node 22.18+
and `pip install pytest pytest-cov`. The root `node_modules` already provides `tsc`; the
TypeScript services have no dependencies of their own.

## Commands

```bash
cd services
make test          # all services with tests
make coverage      # per-service line/branch table; "none" = no framework
make typecheck     # ts/*
```

Single service:

- Java: `cd services/java && mvn -q -B -s ../maven-settings.xml -pl <module> test`;
  report at `<module>/target/site/jacoco/index.html`, CSV at `jacoco.csv`.
- TypeScript: `cd services/ts/<svc> && npm test` (prints a coverage table).
- Python: `cd services/python/<svc> && python3 -m pytest` (pytest-cov configured in `pyproject.toml`).

## Gotchas

- Maven Central returns 429 from this environment. Always pass `-s services/maven-settings.xml`
  (the Makefile does). `~/.m2/settings.xml` with the same mirror also works.
- `node --test` with `.ts` files needs Node 22.18+ (type stripping). `nvm use 24`.
- Root `tsc` is older than the tsconfig options `erasableSyntaxOnly` / `rewriteRelativeImportExtensions`;
  do not add them.
- JaCoCo's CSV columns: `BRANCH_MISSED, BRANCH_COVERED, LINE_MISSED, LINE_COVERED` are columns 6–9.

## Fault injection (demo)

`docs/demo/inject-fault.sh ownership|daily-limit|audit-masking` edits
`AuthorizationService.java` in place and prints a yellow `[INJECTED FAULT]` banner;
`--restore` runs `git checkout` on the source dir. Never commit the injected state — check
`git diff` before committing.

## Playbook

Test-strengthening tasks follow `docs/devin/playbook-strengthen-tests.md`: no production code
changes, behaviour-named tests, before/after line *and* branch coverage, fault-injection evidence.
