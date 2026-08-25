import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@platform/app-kit";
import { RefundsQueue } from "./RefundsQueue.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="Refunds" note="an app: it calls capabilities, never the database">
      {(actorId) => <RefundsQueue actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
