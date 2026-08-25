import { useEffect, useState, type ReactNode } from "react";
import type { PlatformUser } from "@platform/sdk";
import { platform, setActingUser } from "./client.ts";

/**
 * The chrome every app shares: who you are acting as, and how many scopes that
 * grants. Identity comes from the platform's user list, not from the app, so an
 * app cannot invent a principal for itself.
 */
export function AppShell({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: (actorId: string) => ReactNode;
}) {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("u_agent");

  useEffect(() => {
    platform
      .users()
      .then(setUsers)
      .catch(() => setUsers([]));
  }, []);

  const current = users.find((user) => user.id === userId);

  function switchUser(id: string) {
    setActingUser(id);
    setUserId(id);
  }

  return (
    <>
      <header className="shell">
        <h1>{title}</h1>
        {note ? <span className="badge">{note}</span> : null}
        <span className="spacer" />
        <label htmlFor="actor">
          <code>acting as</code>
        </label>
        <select id="actor" value={userId} onChange={(event) => switchUser(event.target.value)}>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </select>
        <span className="badge">{current ? `${current.scopes.length} scopes` : "…"}</span>
      </header>
      <main>
        <section className="panel">{children(userId)}</section>
      </main>
    </>
  );
}
