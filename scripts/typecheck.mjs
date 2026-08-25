/**
 * `npm run typecheck`: the platform, then each app against its own tsconfig.
 *
 * Apps are checked separately because they are DOM code with `vite/client` types
 * and stricter unused-symbol rules; the root project is the platform and the API.
 * Discovered, so a new app is typechecked by CI without touching this file.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { viteApps } from "./apps.mjs";

const projects = ["tsconfig.json", ...viteApps().map((app) => app.tsconfig)].filter((path) =>
  existsSync(path),
);

for (const project of projects) {
  console.log(`· tsc -p ${project}`);
  execFileSync("npx", ["tsc", "--noEmit", "-p", project], { stdio: "inherit" });
}
