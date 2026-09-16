# Runs from services/. Each language has its own toolchain; nothing is installed here.
MVN := mvn -q -B -s maven-settings.xml -f java/pom.xml
TS_WITH_TESTS := ts/mobile-bff ts/card-controls
TS_ALL := ts/mobile-bff ts/notifications ts/card-controls ts/onboarding-api
PY_WITH_TESTS := python/fraud-scoring

.PHONY: test test-java test-ts test-python typecheck coverage clean

test: test-java test-ts test-python

test-java:
	$(MVN) test

test-ts:
	@for d in $(TS_WITH_TESTS); do echo "== $$d"; (cd $$d && npm test --silent) || exit 1; done

test-python:
	@for d in $(PY_WITH_TESTS); do echo "== $$d"; (cd $$d && python3 -m pytest -q) || exit 1; done

typecheck:
	@for d in $(TS_ALL); do echo "== $$d"; (cd $$d && npm run --silent typecheck) || exit 1; done

coverage: test
	@./scripts/coverage-summary.sh

clean:
	$(MVN) clean
	rm -rf python/*/.coverage python/*/.pytest_cache python/*/**/__pycache__
