/**
 * Boundary check: application code may only talk to the platform through the SDK.
 * A generated app that reaches for the database, the kernel, or a vendor client
 * fails here rather than in review.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const FORBIDDEN_IN_APPS = [
  { pattern: /from\s+["']pg["']/, reason: "apps must not open database connections" },
  { pattern: /from\s+["']@platform\/db["']/, reason: "apps must not import the data layer" },
  { pattern: /from\s+["']@platform\/kernel["']/, reason: "apps must not import the kernel" },
  { pattern: /from\s+["']@platform\/capabilities["']/, reason: "apps must not import capability handlers" },
  { pattern: /\bfetch\s*\(/, reason: "apps must invoke capabilities via the SDK, not raw fetch" },
];

/**
 * Every folder under `apps/` is an app and is scanned, except the two hosts that
 * are the platform itself: the API process and the console. A new app is a new
 * folder, so it is covered the moment it exists rather than when someone
 * remembers to list it here.
 */
const PLATFORM_HOSTS = new Set(["api", "console"]);

const APP_ROOTS = readdirSync("apps")
  .filter((name) => !PLATFORM_HOSTS.has(name) && statSync(join("apps", name)).isDirectory())
  .map((name) => join("apps", name, "src"))
  .filter((path) => existsSync(path));

const violations = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.(ts|tsx)$/.test(path)) check(path);
  }
}

function check(path) {
  const source = readFileSync(path, "utf8");
  source.split("\n").forEach((line, index) => {
    for (const rule of FORBIDDEN_IN_APPS) {
      if (rule.pattern.test(line)) {
        violations.push(`${path}:${index + 1}  ${rule.reason}\n    ${line.trim()}`);
      }
    }
  });
}

for (const root of APP_ROOTS) walk(root);

if (violations.length > 0) {
  console.error("Boundary violations found:\n");
  for (const violation of violations) console.error(violation + "\n");
  process.exit(1);
}
console.log(`boundary check passed (${APP_ROOTS.join(", ")})`);
