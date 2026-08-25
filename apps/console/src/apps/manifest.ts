/**
 * The app catalog. Every tile on the landing page is declared here: what the
 * app is, and which scopes a principal needs before the launcher will offer it.
 *
 * The scope list is a courtesy, not a control. The runtime re-checks every
 * capability invocation server-side, so hiding a tile is UX — a principal who
 * reaches an app another way still cannot do anything their scopes forbid.
 */
export interface AppManifestEntry {
  id: string;
  name: string;
  description: string;
  /** Scopes a principal must hold for the launcher to offer the app. */
  requiredScopes: string[];
  /** Which capabilities / platform surfaces the app talks to, for the tile. */
  surface: string;
  kind: "app" | "platform";
  /** Standalone apps launch in a new tab instead of rendering in the shell. */
  external?: { url: string; note: string };
}

export const APP_MANIFEST: AppManifestEntry[] = [
  {
    id: "refunds",
    name: "Refunds",
    description:
      "Issue refunds against settled payments. Small amounts execute instantly; large ones are parked for approval by the runtime.",
    requiredScopes: ["refunds:read", "refunds:write"],
    surface: "refunds.listRefundable · refunds.issue",
    kind: "app",
  },
  {
    id: "queue",
    name: "Review queue",
    description:
      "Work through open review items — KYC mismatches, chargeback risk, manual reviews — and resolve or escalate them.",
    requiredScopes: ["queue:read"],
    surface: "queue.list · queue.resolve",
    kind: "app",
  },
  {
    id: "kyc",
    name: "KYC review",
    description:
      "Case-based KYC review with PII reveal, four-eyes approvals and SAR filing. Runs standalone against its own mock kernel today.",
    requiredScopes: ["queue:read"],
    surface: "kyc.* (standalone)",
    kind: "app",
    external: {
      url: "http://localhost:5174",
      note: "opens in a new tab — start it with: npm run dev -w @align/kyc-review",
    },
  },
  {
    id: "approvals",
    name: "Approvals",
    description:
      "Decide invocations the runtime held for approval. Requesters can never approve their own.",
    requiredScopes: ["approvals:read", "approvals:decide"],
    surface: "platform approvals inbox",
    kind: "platform",
  },
  {
    id: "audit",
    name: "Audit log",
    description:
      "Every capability invocation — including denials — with actor, outcome, amount and timing.",
    requiredScopes: ["audit:read"],
    surface: "platform audit trail",
    kind: "platform",
  },
  {
    id: "registry",
    name: "Capability registry",
    description:
      "The reviewed surface apps are allowed to call: each capability with its declared scope, limits and approval tier.",
    requiredScopes: ["flags:write"],
    surface: "platform capability registry",
    kind: "platform",
  },
];

export function missingScopes(entry: AppManifestEntry, held: string[]): string[] {
  return entry.requiredScopes.filter((scope) => !held.includes(scope));
}
