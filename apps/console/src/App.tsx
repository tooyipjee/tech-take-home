import { useEffect, useState } from "react";
import type { PlatformUser } from "@platform/sdk";
import { platform, setActingUser } from "./client.ts";
import { missingScopes } from "./apps/manifest.ts";
import { APPS } from "./apps/registry.ts";
import { Home } from "./platform/Home.tsx";
import { PLATFORM_VIEWS } from "./platform/views.tsx";

export function App() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("u_agent");
  const [view, setView] = useState("home");

  useEffect(() => {
    platform.users().then(setUsers).catch(() => setUsers([]));
  }, []);

  const current = users.find((user) => user.id === userId);
  const entry = [...APPS, ...PLATFORM_VIEWS].find((candidate) => candidate.id === view);

  // Switching to a principal who lacks the open app's scopes returns to the
  // launcher. Cosmetic only: the runtime would deny every call regardless.
  useEffect(() => {
    if (entry && current && missingScopes(entry, current.scopes).length > 0) setView("home");
  }, [entry, current]);

  function switchUser(id: string) {
    setActingUser(id);
    setUserId(id);
  }

  return (
    <>
      <header className="shell">
        <h1>
          <button className="brand" onClick={() => setView("home")}>
            Internal Tool Platform
          </button>
        </h1>
        {entry ? <span className="badge">{entry.name}</span> : null}
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

      {entry ? (
        <nav className="crumbs">
          <button onClick={() => setView("home")}>← All apps</button>
        </nav>
      ) : null}

      <main>
        <section className={entry ? "panel" : "panel home"}>
          {entry?.render ? entry.render(userId) : <Home user={current} onOpen={setView} />}
        </section>
      </main>
    </>
  );
}
