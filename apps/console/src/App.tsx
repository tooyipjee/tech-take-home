import { useEffect, useState } from "react";
import type { PlatformUser } from "@platform/sdk";
import { platform, setActingUser } from "@platform/app-kit";
import { ApprovalsInbox } from "./platform/ApprovalsInbox.tsx";
import { AuditLog } from "./platform/AuditLog.tsx";
import { RegistryView } from "./platform/RegistryView.tsx";
import { InvariantsView } from "./platform/InvariantsView.tsx";
import { Launcher } from "./Launcher.tsx";

/**
 * The console is a platform surface, not an app: approvals, audit, the registry
 * and invariant health. The apps live in `apps/*` and are launched from here.
 */
const TABS = [
  { id: "apps", label: "Apps", scopes: [] },
  { id: "approvals", label: "Approvals", scopes: ["approvals:read", "approvals:decide"] },
  { id: "audit", label: "Audit log", scopes: ["audit:read"] },
  { id: "registry", label: "Capability registry", scopes: [] },
  { id: "invariants", label: "Invariants", scopes: ["invariants:read"] },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("u_agent");
  const [tab, setTab] = useState<TabId>("apps");

  useEffect(() => {
    platform
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const current = users.find((user) => user.id === userId);

  function locked(entry: (typeof TABS)[number]): boolean {
    return current ? entry.scopes.some((scope) => !current.scopes.includes(scope)) : false;
  }

  // Switching to a principal who lacks the open tab's scopes returns to the
  // launcher. Cosmetic only: the runtime would deny every call regardless.
  const active = TABS.find((entry) => entry.id === tab);
  useEffect(() => {
    if (active && locked(active)) setTab("apps");
  });

  function switchUser(id: string) {
    setActingUser(id);
    setUserId(id);
  }

  return (
    <>
      <header className="shell">
        <h1>Internal Tool Platform</h1>
        <span className="badge">apps call capabilities, never the database</span>
        <span className="spacer" />
        {/*
          Development sign-in. Identity is a solved problem, so it is mocked:
          this switcher stands in for an OAuth2/OIDC redirect, and the selected
          user id plays the part of the token subject. Production replaces this
          control and `resolvePrincipal` — nothing else, because everything
          downstream only ever sees a resolved Principal.
        */}
        <label htmlFor="actor">
          <code>signed in as</code>
        </label>
        <select id="actor" value={userId} onChange={(event) => switchUser(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <span className="badge">{current ? `${current.role} · ${current.scopes.length} scopes` : "…"}</span>
        <span className="badge warn">mock identity — swaps for OAuth/OIDC</span>
      </header>

      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? "active" : ""}
            disabled={locked(entry)}
            title={locked(entry) ? `requires ${entry.scopes.join(", ")}` : undefined}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main>
        <section className="panel">
          {tab === "apps" ? <Launcher user={current} /> : null}
          {tab === "approvals" ? <ApprovalsInbox actorId={userId} /> : null}
          {tab === "audit" ? <AuditLog actorId={userId} /> : null}
          {tab === "registry" ? <RegistryView /> : null}
          {tab === "invariants" ? <InvariantsView actorId={userId} /> : null}
        </section>
      </main>
    </>
  );
}
