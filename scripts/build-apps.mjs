/**
 * `npm run build:apps`: builds every app folder, so app CI covers a new app from
 * its first commit instead of when someone remembers to add a script.
 */
import { execFileSync } from "node:child_process";
import { viteApps } from "./apps.mjs";

for (const app of viteApps()) {
  console.log(`\n· building ${app.name}`);
  execFileSync("npx", ["vite", "build", "--config", app.config], { stdio: "inherit" });
}
