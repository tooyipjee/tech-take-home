import type { PlatformUser } from "@platform/sdk";
import { APP_MANIFEST, missingScopes, type AppManifestEntry } from "../apps/manifest.ts";

/**
 * The landing page: every registered app as a tile, offered or locked
 * depending on the scopes of the signed-in principal. Availability here is
 * presentation only — the runtime enforces the same scopes on every call.
 */
export function Home({ user, onOpen }: { user: PlatformUser | undefined; onOpen: (id: string) => void }) {
  const scopes = user?.scopes ?? [];
  const apps = APP_MANIFEST.filter((entry) => entry.kind === "app");
  const platformViews = APP_MANIFEST.filter((entry) => entry.kind === "platform");

  return (
    <>
      <h2>Apps</h2>
      <p className="hint">
        {user
          ? `Signed in as ${user.name} — ${user.role}, ${scopes.length} scopes. Locked tiles show what is missing.`
          : "Loading identity…"}
      </p>
      <div className="tile-grid">
        {apps.map((entry) => (
          <Tile key={entry.id} entry={entry} scopes={scopes} onOpen={onOpen} />
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>Platform</h2>
      <p className="hint">Built into the platform rather than generated: approvals, audit, and the capability registry.</p>
      <div className="tile-grid">
        {platformViews.map((entry) => (
          <Tile key={entry.id} entry={entry} scopes={scopes} onOpen={onOpen} />
        ))}
      </div>
    </>
  );
}

function Tile({
  entry,
  scopes,
  onOpen,
}: {
  entry: AppManifestEntry;
  scopes: string[];
  onOpen: (id: string) => void;
}) {
  const missing = missingScopes(entry, scopes);
  const locked = missing.length > 0;

  function open() {
    if (locked) return;
    if (entry.external) window.open(entry.external.url, "_blank", "noopener");
    else onOpen(entry.id);
  }

  return (
    <button className={`tile${locked ? " locked" : ""}`} onClick={open} disabled={locked}>
      <span className="tile-head">
        <span className="tile-name">{entry.name}</span>
        {entry.external ? <span className="badge">standalone</span> : null}
        {locked ? <span className="badge bad">locked</span> : <span className="badge ok">open</span>}
      </span>
      <span className="tile-desc">{entry.description}</span>
      <span className="tile-foot">
        <code>{entry.surface}</code>
      </span>
      {locked ? (
        <span className="tile-missing">
          requires {missing.map((scope) => <code key={scope}>{scope}</code>)}
        </span>
      ) : entry.external ? (
        <span className="tile-missing">{entry.external.note}</span>
      ) : null}
    </button>
  );
}
