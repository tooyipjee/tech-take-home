import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@rangka/app-kit";
import { SarDesk } from "./SarDesk.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="SAR desk">
      {(actorId) => <SarDesk actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
