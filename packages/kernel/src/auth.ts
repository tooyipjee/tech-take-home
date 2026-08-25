import type { PgClient } from "@rangka/db";
import type { Principal, Role } from "./types.ts";

/**
 * Role to scope mapping. Scopes, not roles, are what capabilities declare, so a
 * new role never requires touching capability code.
 */
export const ROLE_SCOPES: Record<Role, string[]> = {
  agent: [
    "kyc:read",
    "kyc:pii",
    "kyc:review",
    // Which features are on is not a secret from the people working under them, so
    // every role can read the flags; only an admin holds the scope that moves one.
    "flags:read",
    // Invariant health is readable by everyone: a halted capability must be
    // explainable to the person whose work just stopped.
    "invariants:read",
  ],
  supervisor: [
    "kyc:read",
    "kyc:pii",
    "kyc:review",
    "kyc:decide",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "flags:read",
    "invariants:read",
  ],
  admin: [
    "kyc:read",
    "kyc:pii",
    "kyc:review",
    "kyc:decide",
    "kyc:sar",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "flags:read",
    // Turning a product feature on or off without a deploy. Two admins hold it, so a
    // protected flag always has a second signature available and never a self-granted one.
    "flags:write",
    "invariants:read",
    // Resuming a halted capability is an admin act, and only possible once the
    // invariant passes again.
    "invariants:clear",
  ],
};

/**
 * Development identity: the console sends the acting user's id in a header.
 * Swapping this for OIDC changes this function only; nothing downstream knows
 * how the principal was established.
 */
export async function resolvePrincipal(client: PgClient, userId: string): Promise<Principal | null> {
  const { rows } = await client.query<{ id: string; email: string; name: string; role: Role }>(
    "select id, email, name, role from platform_users where id = $1",
    [userId],
  );
  const row = rows[0];
  if (!row) return null;
  return { ...row, scopes: ROLE_SCOPES[row.role] };
}

export async function listPrincipals(client: PgClient): Promise<Principal[]> {
  const { rows } = await client.query<{ id: string; email: string; name: string; role: Role }>(
    "select id, email, name, role from platform_users order by role",
  );
  return rows.map((row) => ({ ...row, scopes: ROLE_SCOPES[row.role] }));
}
