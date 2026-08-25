import type { ReactElement } from "react";

/**
 * A tile on the landing page. Apps declare one of these next to their
 * component and the launcher discovers it — no central list to edit, so a
 * generated app shows up the moment its file lands in `src/apps`.
 *
 * The scope list is a courtesy, not a control. The runtime re-checks every
 * capability invocation server-side, so hiding a tile is UX — a principal who
 * reaches an app another way still cannot do anything their scopes forbid.
 */
export interface AppDefinition {
  id: string;
  name: string;
  description: string;
  /** Scopes a principal must hold for the launcher to offer the app. */
  requiredScopes: string[];
  /** Which capabilities / platform surfaces the app talks to, for the tile. */
  surface: string;
  kind: "app" | "platform";
  /** Standalone apps launch in a new tab instead of rendering in the shell. */
  external?: { url: string; note: string };
  /** How the shell renders the app. Absent for external apps. */
  render?: (actorId: string) => ReactElement;
}

export function missingScopes(entry: AppDefinition, held: string[]): string[] {
  return entry.requiredScopes.filter((scope) => !held.includes(scope));
}
