import type { AppDefinition } from "../apps/manifest.ts";
import { ApprovalsInbox } from "./ApprovalsInbox.tsx";
import { AuditLog } from "./AuditLog.tsx";
import { RegistryView } from "./RegistryView.tsx";
import { InvariantsView } from "./InvariantsView.tsx";

/**
 * Built into the platform rather than generated, so these are declared
 * statically instead of being auto-discovered like `src/apps`.
 */
export const PLATFORM_VIEWS: AppDefinition[] = [
  {
    id: "approvals",
    name: "Approvals",
    description:
      "Decide invocations the runtime held for approval. Requesters can never approve their own.",
    requiredScopes: ["approvals:read", "approvals:decide"],
    surface: "platform approvals inbox",
    kind: "platform",
    render: (actorId) => <ApprovalsInbox actorId={actorId} />,
  },
  {
    id: "audit",
    name: "Audit log",
    description:
      "Every capability invocation — including denials — with actor, outcome, amount and timing.",
    requiredScopes: ["audit:read"],
    surface: "platform audit trail",
    kind: "platform",
    render: (actorId) => <AuditLog actorId={actorId} />,
  },
  {
    id: "registry",
    name: "Capability registry",
    description:
      "The reviewed surface apps are allowed to call: each capability with its declared scope, limits and approval tier.",
    requiredScopes: ["flags:write"],
    surface: "platform capability registry",
    kind: "platform",
    render: () => <RegistryView />,
  },
  {
    id: "invariants",
    name: "Invariants",
    description:
      "What the platform claims is always true, when it last proved it, and what it halted when a proof failed.",
    requiredScopes: ["invariants:read"],
    surface: "platform invariant reports",
    kind: "platform",
    render: (actorId) => <InvariantsView actorId={actorId} />,
  },
];
