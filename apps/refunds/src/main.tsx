import React from "react";
import { createRoot } from "react-dom/client";
import { AppShell } from "@rangka/app-kit";
import { RefundsDesk } from "./RefundsDesk.tsx";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppShell title="Refunds desk" note="A refund recorded here is an instruction to the payments team.">
      {(actorId) => <RefundsDesk actorId={actorId} />}
    </AppShell>
  </React.StrictMode>,
);
