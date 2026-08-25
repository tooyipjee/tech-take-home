import { useEffect, useState } from "react";
import type { PlatformUser } from "@platform/sdk";
import { platform, setActingUser } from "./client.ts";
import { RefundsQueue } from "./apps/RefundsQueue.tsx";
import { ReviewQueue } from "./apps/ReviewQueue.tsx";
import { ApprovalsInbox } from "./platform/ApprovalsInbox.tsx";
import { AuditLog } from "./platform/AuditLog.tsx";
import { RegistryView } from "./platform/RegistryView.tsx";
import { InvariantsView } from "./platform/InvariantsView.tsx";

const TABS = [
  { id: "refunds", label: "Refunds (app)" },
  { id: "queue", label: "Review queue (app)" },
  { id: "approvals", label: "Approvals" },
  { id: "audit", label: "Audit log" },
  { id: "registry", label: "Capability registry" },
  { id: "invariants", label: "Invariants" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export function App() {
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [userId, setUserId] = useState("u_agent");
  const [tab, setTab] = useState<TabId>("refunds");

  useEffect(() => {
    platform.users().then(setUsers).catch(() => setUsers([]));
  }, []);

  const current = users.find((user) => user.id === userId);

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

      <nav className="tabs">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            className={tab === entry.id ? "active" : ""}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </nav>

      <main>
        <section className="panel">
          {tab === "refunds" ? <RefundsQueue actorId={userId} /> : null}
          {tab === "queue" ? <ReviewQueue actorId={userId} /> : null}
          {tab === "approvals" ? <ApprovalsInbox actorId={userId} /> : null}
          {tab === "audit" ? <AuditLog actorId={userId} /> : null}
          {tab === "registry" ? <RegistryView /> : null}
          {tab === "invariants" ? <InvariantsView actorId={userId} /> : null}
        </section>
      </main>
    </>
  );
}
