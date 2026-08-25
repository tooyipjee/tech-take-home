/// <reference types="vite/client" />
import type { PlatformUser } from "@rangka/sdk";

/**
 * An app is a folder under `apps/` served on its own port, so the launcher
 * links out rather than importing it: nothing an app does can reach the
 * console's code. Each folder describes itself in an `app.json`, discovered
 * here by glob — adding an app never edits the console.
 */
export interface AppManifest {
  id: string;
  name: string;
  description: string;
  folder: string;
  url: string;
  /** Every scope the app's capabilities use. Not shown: this is the platform's business, not the user's. */
  scopes: string[];
  /** The minimum to offer the tile. Presentation only: the runtime re-checks on every call. */
  requiredScopes: string[];
}

const manifests = import.meta.glob<{ default: AppManifest }>("../../*/app.json", { eager: true });

export const APPS: AppManifest[] = Object.values(manifests)
  .map((module) => module.default)
  .sort((a, b) => a.name.localeCompare(b.name));

function missingScopes(entry: AppManifest, held: string[]): string[] {
  return entry.requiredScopes.filter((scope) => !held.includes(scope));
}

/** Deterministic per app, so a tile keeps its colour as apps come and go. */
function hue(id: string): number {
  let acc = 0;
  for (const character of id) acc = (acc * 31 + character.charCodeAt(0)) % 360;
  return acc;
}

export function Launcher({ user }: { user: PlatformUser | undefined }) {
  const held = user?.scopes ?? [];
  const firstName = user?.name.split(" ")[0];

  return (
    <>
      <div className="launcher-head">
        <h2>{firstName ? `Good to see you, ${firstName}.` : "Welcome."}</h2>
        <p className="hint">Choose an app to get to work.</p>
      </div>
      <div className="tile-grid">
        {APPS.map((entry) => (
          <Tile key={entry.id} entry={entry} held={held} />
        ))}
      </div>
    </>
  );
}

function Tile({ entry, held }: { entry: AppManifest; held: string[] }) {
  const locked = missingScopes(entry, held).length > 0;

  function open() {
    if (!locked) window.open(entry.url, "_blank", "noopener");
  }

  return (
    <button
      className={`tile${locked ? " locked" : ""}`}
      onClick={open}
      disabled={locked}
      style={{ ["--tile-hue" as string]: hue(entry.id) }}
    >
      <span className="tile-glyph" aria-hidden="true">
        {entry.name.slice(0, 1)}
      </span>
      <span className="tile-name">{entry.name}</span>
      <span className="tile-desc">{entry.description}</span>
      <span className="tile-foot">
        {locked ? "Your role does not have access" : "Open"}
        {locked ? null : <span aria-hidden="true"> →</span>}
      </span>
    </button>
  );
}
