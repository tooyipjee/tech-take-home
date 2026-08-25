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
    // A support agent may look at any payment and ask for a refund. How much they can
    // move without a second person is the capability's business, not the role's: the
    // scope grants the act, the declared threshold decides when it waits.
    "refunds:read",
    "refunds:issue",
    // Invariant health is readable by everyone: a halted capability must be
    // explainable to the person whose work just stopped.
    "invariants:read",
  ],
  supervisor: [
    "kyc:read",
    "kyc:pii",
    "kyc:review",
    "kyc:decide",
    "refunds:read",
    "refunds:issue",
    // Signing off a refund above the threshold. A supervisor holds it as well as
    // `refunds:issue`, and the platform still refuses a self-approval, so a supervisor
    // who raises one needs another supervisor or an admin to sign it.
    "refunds:approve",
    "approvals:read",
    "approvals:decide",
    "audit:read",
    "invariants:read",
  ],
  admin: [
    "kyc:read",
    "kyc:pii",
    "kyc:review",
    "kyc:decide",
    "kyc:sar",
    // A compliance officer signs refunds off and reads the history behind them, but
    // does not raise them: the refunds desk is support's work, and an officer who both
    // asked and signed would leave the four-eyes rule with nobody to enforce it against.
    // This is why the refunds tile is locked for an officer while the approvals inbox
    // in the console is not.
    "refunds:read",
    "refunds:approve",
    "approvals:read",
    "approvals:decide",
    "audit:read",
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
