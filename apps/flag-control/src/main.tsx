import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@platform/app-kit";
import { FlagControl } from "./FlagControl.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="Flag control" note="an app: it calls capabilities, never the database">
      {(actorId) => <FlagControl actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
