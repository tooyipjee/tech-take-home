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
  /** Every scope the app's capabilities use — shown on the tile. */
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

export function Launcher({ user }: { user: PlatformUser | undefined }) {
  const held = user?.scopes ?? [];

  return (
    <>
      <h2>Apps</h2>
      <p className="hint">
        {user
          ? `Signed in as ${user.name} — ${user.role}, ${held.length} scopes. Locked tiles show what is missing.`
          : "Loading identity…"}{" "}
        Each app is a folder in <code>apps/</code> with its own dev server and an <code>app.json</code>,
        talking to this platform through <code>@rangka/sdk</code>. Tile availability is presentation
        only; the runtime re-checks scopes on every capability call.
      </p>
      <div className="tile-grid">
        {APPS.map((entry) => (
          <Tile key={entry.id} entry={entry} held={held} />
        ))}
      </div>
    </>
  );
}

function Tile({ entry, held }: { entry: AppManifest; held: string[] }) {
  const missing = missingScopes(entry, held);
  const locked = missing.length > 0;

  function open() {
    if (!locked) window.open(entry.url, "_blank", "noopener");
  }

  return (
    <button className={`tile${locked ? " locked" : ""}`} onClick={open} disabled={locked}>
      <span className="tile-head">
        <span className="tile-name">{entry.name}</span>
        {locked ? <span className="badge bad">locked</span> : <span className="badge ok">open</span>}
      </span>
      <span className="tile-desc">{entry.description}</span>
      <span className="tile-foot">
        <code>{entry.folder}</code>{" "}
        {entry.scopes.map((scope) => (
          <span key={scope} className="badge">
            {scope}
          </span>
        ))}
      </span>
      {locked ? (
        <span className="tile-missing">
          requires{" "}
          {missing.map((scope) => (
            <code key={scope}>{scope}</code>
          ))}
        </span>
      ) : null}
    </button>
  );
}
