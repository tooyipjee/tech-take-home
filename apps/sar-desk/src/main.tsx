import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@platform/app-kit";
import { SarDesk } from "./SarDesk.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="SAR desk" note="an app: it calls capabilities, never the database">
      {(actorId) => <SarDesk actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
