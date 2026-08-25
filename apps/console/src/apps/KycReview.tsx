import type { AppDefinition } from "./manifest.ts";

/**
 * A tile for an app that is not hosted in this shell: the KYC review queue
 * runs standalone against its own mock kernel today. The launcher still lists
 * it so the catalog is the one place people find internal tools.
 */
export const app: AppDefinition = {
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
};
