/**
 * Tier check: the boundary between building an app and changing the platform.
 *
 * Tier 1 (build an internal tool) consumes existing capabilities and invariants. It
 * may touch app code and docs only.
 *
 * Tier 2 (extend the platform) may change the kernel, the invariants, the schema or
 * the capability set — and must say so in writing, in a change record that names
 * the invariant it affects and how it was tested. This script is what makes that a
 * rule rather than an expectation: a tier-1 change that edits the kernel fails
 * here, before review.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

const PROTECTED = [
  { prefix: "packages/kernel/", why: "the runtime and the invariants" },
  { prefix: "packages/db/migrations/", why: "the database-enforced invariants" },
  { prefix: "packages/db/src/datasource.ts", why: "the data surface handlers are given" },
  { prefix: "packages/capabilities/", why: "the declared capability set and its policy" },
  { prefix: "packages/sdk/", why: "the surface every app depends on" },
  { prefix: "scripts/check-", why: "the checks that enforce the boundaries" },
];

const CHANGE_RECORD_DIR = "docs/platform-changes";
const REQUIRED_SECTIONS = ["## Invariants affected", "## How it was verified", "## Rollback"];

const base = process.env.TIER_CHECK_BASE ?? defaultBase();

function defaultBase() {
  for (const candidate of ["origin/main", "main"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", candidate], { stdio: "ignore" });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}

function changedFiles() {
  if (!base) return null;
  try {
    const mergeBase = execFileSync("git", ["merge-base", "HEAD", base], { encoding: "utf8" }).trim();
    const output = execFileSync("git", ["diff", "--name-only", `${mergeBase}...HEAD`], {
      encoding: "utf8",
    });
    const working = execFileSync("git", ["diff", "--name-only", "HEAD"], { encoding: "utf8" });
    const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard"], {
      encoding: "utf8",
    });
    return [
      ...new Set(
        [...output.split("\n"), ...working.split("\n"), ...untracked.split("\n")].filter(Boolean),
      ),
    ];
  } catch {
    return null;
  }
}

const files = changedFiles();
const problems = [];

if (files === null) {
  console.log("tier check skipped (no git base to compare against)");
} else {
  const platformEdits = files.filter((file) => PROTECTED.some((p) => file.startsWith(p.prefix)));
  const records = files.filter((file) => file.startsWith(`${CHANGE_RECORD_DIR}/`));

  if (platformEdits.length > 0 && records.length === 0) {
    problems.push(
      `This change edits the platform, which is tier-2 work:\n` +
        platformEdits.map((file) => `    ${file}`).join("\n") +
        `\n  Add a change record under ${CHANGE_RECORD_DIR}/ describing what it means for the` +
        `\n  invariants, or keep the change inside an app (tier 1).`,
    );
  }

  for (const record of records) {
    if (!existsSync(record)) continue;
    const body = readFileSync(record, "utf8");
    const missing = REQUIRED_SECTIONS.filter((section) => !body.includes(section));
    if (missing.length > 0) {
      problems.push(`${record} is missing required section(s): ${missing.join(", ")}`);
    }
  }
}

// Invariants are derived from declarations at runtime, so the "every invariant is
// attacked by a test" check lives in the test suite itself, where the derivation
// can be executed. What is checkable statically is that the check still exists.
const invariantTest = readFileSync("packages/kernel/test/invariants.test.ts", "utf8");
if (!invariantTest.includes("no invariant is in force without a test that attacks it")) {
  problems.push(
    "the invariant coverage test was removed; an invariant with no test is a sentence, not a guarantee",
  );
}

if (problems.length > 0) {
  console.error("Tier check failed:\n");
  for (const problem of problems) console.error(`  ${problem}\n`);
  process.exit(1);
}
console.log("tier check passed");
