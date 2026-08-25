/**
 * Boundary check: application code may only talk to the platform through the SDK.
 * A generated app that reaches for the database, the kernel, or a vendor client
 * fails here rather than in review.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { portOf, viteApps } from "./apps.mjs";

const FORBIDDEN_IN_APPS = [
  { pattern: /from\s+["']pg["']/, reason: "apps must not open database connections" },
  { pattern: /from\s+["']@rangka\/db["']/, reason: "apps must not import the data layer" },
  { pattern: /from\s+["']@rangka\/kernel["']/, reason: "apps must not import the kernel" },
  { pattern: /from\s+["']@rangka\/capabilities["']/, reason: "apps must not import capability handlers" },
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

/**
 * The launcher is generated from `app.json`, so a manifest that disagrees with the
 * folder is an app nobody can open: a tile pointing at a port no dev server is
 * listening on, or a scope the runtime will never issue. Cheaper to catch here.
 */
const MANIFEST_FIELDS = [
  "id",
  "name",
  "description",
  "folder",
  "url",
  "scopes",
  "requiredScopes",
];

/**
 * Every scope some role holds, read out of `ROLE_SCOPES` itself so the check cannot
 * drift from the grants. A tile asking for a scope nobody can be granted is dead.
 */
const AUTH = readFileSync("packages/kernel/src/auth.ts", "utf8");
const ROLE_SCOPES = AUTH.slice(AUTH.indexOf("ROLE_SCOPES"), AUTH.indexOf("\n};"));
const KNOWN_SCOPES = new Set(
  [...ROLE_SCOPES.matchAll(/"([a-z][a-z_]*:[a-z][a-z_]*)"/g)].map((match) => match[1]),
);

for (const app of viteApps()) {
  if (PLATFORM_HOSTS.has(app.name)) continue;
  if (!existsSync(app.manifest)) {
    violations.push(
      `${app.manifest}  missing: without a manifest the app never appears on the console launcher`,
    );
    continue;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(app.manifest, "utf8"));
  } catch (error) {
    violations.push(`${app.manifest}  is not valid JSON: ${error.message}`);
    continue;
  }
  for (const field of MANIFEST_FIELDS) {
    if (manifest[field] === undefined) violations.push(`${app.manifest}  missing "${field}"`);
  }
  if (manifest.folder !== join("apps", app.name)) {
    violations.push(`${app.manifest}  "folder" should be apps/${app.name}`);
  }
  const port = portOf(app);
  if (port !== null && typeof manifest.url === "string" && !manifest.url.includes(`:${port}`)) {
    violations.push(
      `${app.manifest}  "url" is ${manifest.url} but ${app.config} serves :${port}` +
        `\n    the launcher tile would open a port nothing is listening on`,
    );
  }
  const declared = new Set(manifest.scopes ?? []);
  for (const scope of declared) {
    if (!KNOWN_SCOPES.has(scope)) {
      violations.push(
        `${app.manifest}  scope "${scope}" is held by no role in packages/kernel/src/auth.ts` +
          `\n    granting it is tier-2 work: see docs/devin/playbook.md (phase C)`,
      );
    }
  }
  for (const scope of manifest.requiredScopes ?? []) {
    if (!declared.has(scope)) {
      violations.push(`${app.manifest}  requiredScopes includes "${scope}", absent from scopes`);
    }
  }
}

if (violations.length > 0) {
  console.error("Boundary violations found:\n");
  for (const violation of violations) console.error(violation + "\n");
  process.exit(1);
}
console.log(`boundary check passed (${APP_ROOTS.join(", ")})`);
