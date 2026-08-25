import type { PlatformUser } from "@platform/sdk";
import { missingScopes, type AppDefinition } from "../apps/manifest.ts";
import { APPS } from "../apps/registry.ts";
import { PLATFORM_VIEWS } from "./views.tsx";

/**
 * The landing page: every discovered app as a tile, offered or locked
 * depending on the scopes of the signed-in principal. Availability here is
 * presentation only — the runtime enforces the same scopes on every call.
 */
export function Home({ user, onOpen }: { user: PlatformUser | undefined; onOpen: (id: string) => void }) {
  const scopes = user?.scopes ?? [];

  return (
    <>
      <h2>Apps</h2>
      <p className="hint">
        {user
          ? `Signed in as ${user.name} — ${user.role}, ${scopes.length} scopes. Locked tiles show what is missing.`
          : "Loading identity…"}
      </p>
      <div className="tile-grid">
        {APPS.map((entry) => (
          <Tile key={entry.id} entry={entry} scopes={scopes} onOpen={onOpen} />
        ))}
      </div>

      <h2 style={{ marginTop: 24 }}>Platform</h2>
      <p className="hint">Built into the platform rather than generated: approvals, audit, and the capability registry.</p>
      <div className="tile-grid">
        {PLATFORM_VIEWS.map((entry) => (
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
  entry: AppDefinition;
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
