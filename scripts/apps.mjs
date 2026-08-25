/**
 * Where the repository learns what apps exist: the filesystem, not a list.
 *
 * The console launcher globs every apps/<name>/app.json, so a new folder appears on the
 * dashboard without editing the console. Everything else that has to know the set
 * of apps — the dev process, the build, the typecheck, the manifest check — reads
 * it from here, for the same reason: a step someone can forget is a step that gets
 * forgotten, and the app that never got wired up is the one nobody can demo.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/** The API is a Fastify process, not a Vite app; every other folder is served by Vite. */
const API = "api";

export function viteApps() {
  return readdirSync("apps")
    .filter((name) => name !== API && statSync(join("apps", name)).isDirectory())
    .filter((name) => existsSync(join("apps", name, "vite.config.ts")))
    .sort()
    .map((name) => ({
      name,
      config: join("apps", name, "vite.config.ts"),
      manifest: join("apps", name, "app.json"),
      tsconfig: join("apps", name, "tsconfig.json"),
    }));
}

/** The port a Vite config pins, so the dev banner and the manifest can be checked against it. */
export function portOf(app) {
  const match = /port:\s*(\d+)/.exec(readFileSync(app.config, "utf8"));
  return match ? Number(match[1]) : null;
}
