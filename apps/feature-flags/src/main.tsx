import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@rangka/app-kit";
import { FeatureFlags } from "./FeatureFlags.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="Feature flags">
      {(actorId) => <FeatureFlags actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
