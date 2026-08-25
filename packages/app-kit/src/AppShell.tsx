import { useEffect, useState, type ReactNode } from "react";
import type { PlatformUser } from "@rangka/sdk";
import { platform, setActingUser } from "./client.ts";
import { Brand, initials, roleTitle } from "./Brand.tsx";

/**
 * The chrome every app shares: the platform mark, the app's name, and who you are
 * acting as. Identity comes from the platform's user list, not from the app, so an
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
        <Brand app={title} />
        {note ? <span className="shell-tagline">{note}</span> : null}
        <span className="spacer" />
        <label className="identity" htmlFor="actor">
          <span className="avatar" aria-hidden="true">
            {current ? initials(current.name) : "··"}
          </span>
          <span className="identity-words">
            <select id="actor" value={userId} onChange={(event) => switchUser(event.target.value)}>
              {users.map((user) => (
                <option key={user.id} value={user.id}>
                  {user.name}
                </option>
              ))}
            </select>
            <span className="identity-role">
              {current ? roleTitle(current.role) : "signing in…"}
            </span>
          </span>
        </label>
      </header>
      <main>
        <section className="panel">{children(userId)}</section>
      </main>
    </>
  );
}
