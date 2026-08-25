/// <reference types="vite/client" />
import type { AppDefinition } from "./manifest.ts";

/**
 * Auto-discovery: every module in this directory that exports an `app`
 * definition becomes a tile. Adding an app is adding a file; nothing in the
 * shell needs editing.
 */
const modules = import.meta.glob<{ app?: AppDefinition }>("./*.tsx", { eager: true });

export const APPS: AppDefinition[] = Object.values(modules)
  .map((module) => module.app)
  .filter((entry): entry is AppDefinition => Boolean(entry))
  .sort((a, b) => a.name.localeCompare(b.name));
