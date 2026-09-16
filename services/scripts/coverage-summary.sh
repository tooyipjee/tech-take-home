#!/usr/bin/env bash
# One table for the whole monorepo. Run `make test` first; this only reads reports.
set -euo pipefail
cd "$(dirname "$0")/.."

printf "%-34s %8s %8s   %s\n" "service" "lines" "branches" "note"
printf "%-34s %8s %8s   %s\n" "-------" "-----" "--------" "----"

for pom in java/*/pom.xml; do
  svc=$(dirname "$pom")
  csv="$svc/target/site/jacoco/jacoco.csv"
  if [ -f "$csv" ]; then
    awk -F, -v s="$svc" 'NR>1{lm+=$8;lc+=$9;bm+=$6;bc+=$7}
      END{printf "%-34s %7.1f%% %7.1f%%\n", s, 100*lc/(lm+lc), (bm+bc)?100*bc/(bm+bc):0}' "$csv"
  elif grep -q junit "$pom"; then
    printf "%-34s %8s %8s   %s\n" "$svc" "?" "?" "tests present, run make test"
  else
    printf "%-34s %8s %8s   %s\n" "$svc" "none" "none" "no test framework"
  fi
done

for pkg in ts/*/package.json; do
  svc=$(dirname "$pkg")
  if grep -q '"test"' "$pkg"; then
    # node --test prints a coverage table; take the "all files" row (line, branch, funcs).
    row=$(cd "$svc" && npm test --silent 2>/dev/null | grep "all files" | tr -d 'ℹ|' | awk '{print $3, $4}')
    printf "%-34s %7.1f%% %7.1f%%\n" "$svc" ${row:-0 0}
  else
    printf "%-34s %8s %8s   %s\n" "$svc" "none" "none" "no test framework"
  fi
done

for toml in python/*/pyproject.toml; do
  svc=$(dirname "$toml")
  if grep -q pytest "$toml"; then
    line=$(cd "$svc" && python3 -m pytest -q 2>/dev/null | grep '^TOTAL' | awk '{print $NF}' | tr -d '%')
    printf "%-34s %7.1f%% %8s   %s\n" "$svc" "${line:-0}" "-" "pytest-cov combined line+branch"
  else
    printf "%-34s %8s %8s   %s\n" "$svc" "none" "none" "no test framework"
  fi
done
