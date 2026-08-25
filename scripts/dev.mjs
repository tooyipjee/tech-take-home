/**
 * `npm run dev`: the API plus every app folder, discovered rather than listed.
 * Adding an app means adding a folder; it starts with everything else next time.
 */
import { spawn } from "node:child_process";
import { portOf, viteApps } from "./apps.mjs";

const COLOURS = ["magenta", "yellow", "green", "blue", "cyan", "white"];

const apps = viteApps();
const names = ["api", ...apps.map((app) => app.name)];
const commands = ["npm:dev:api", ...apps.map((app) => `vite --config ${app.config}`)];

console.log(
  ["api :8080", ...apps.map((app) => `${app.name} :${portOf(app) ?? "?"}`)].join(" · "),
);

const child = spawn(
  "npx",
  ["concurrently", "-n", names.join(","), "-c", ["cyan", ...COLOURS].join(","), ...commands],
  { stdio: "inherit" },
);

child.on("exit", (code) => process.exit(code ?? 0));
