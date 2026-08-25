import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@platform/app-kit";
import { ReviewQueue } from "./ReviewQueue.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="Customer review queue" note="an app: it calls capabilities, never the database">
      {(actorId) => <ReviewQueue actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
