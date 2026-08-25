import { withClient } from "@platform/db";
import { ROLE_SCOPES } from "./auth.ts";
import { listCapabilities } from "./registry.ts";

export interface AuditEntry {
  id: number;
  at: string;
  actorId: string;
  actorRole: string;
  capability: string;
  kind: string;
  outcome: string;
  input: unknown;
  result: unknown;
  amountCents: number | null;
  approvalId: string | null;
  idempotencyKey: string | null;
  error: string | null;
  durationMs: number;
}

export async function listAuditLog(limit = 100): Promise<AuditEntry[]> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      "select * from audit_log order by at desc, id desc limit $1",
      [Math.min(limit, 500)],
    );
    return rows.map((row) => ({
      id: Number(row.id),
      at: row.at.toISOString(),
      actorId: row.actor_id,
      actorRole: row.actor_role,
      capability: row.capability,
      kind: row.kind,
      outcome: row.outcome,
      input: row.input,
      result: row.result,
      amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
      approvalId: row.approval_id,
      idempotencyKey: row.idempotency_key,
      error: row.error,
      durationMs: row.duration_ms,
    }));
  });
}

/**
 * Mirrors the in-code registry into Postgres at boot so the declared policy of
 * every capability is queryable by risk and compliance without reading TypeScript.
 *
 * The role → scope map goes with it, so an invariant can ask in SQL whether the person
 * who decided an approval actually held the scope it demanded.
 */
export async function syncRegistry(): Promise<number> {
  const capabilities = listCapabilities();
  await withClient(async (client) => {
    await client.query("delete from role_scopes");
    for (const [role, scopes] of Object.entries(ROLE_SCOPES)) {
      for (const scope of scopes) {
        await client.query("insert into role_scopes (role, scope) values ($1, $2)", [role, scope]);
      }
    }
    for (const capability of capabilities) {
      await client.query(
        `insert into capability_registry (name, kind, scope, summary, policy)
         values ($1, $2, $3, $4, $5)
         on conflict (name) do update
           set kind = excluded.kind, scope = excluded.scope,
               summary = excluded.summary, policy = excluded.policy,
               registered_at = now()`,
        [
          capability.name,
          capability.kind,
          capability.policy.scope,
          capability.summary,
          JSON.stringify(capability.policy),
        ],
      );
    }
  });
  return capabilities.length;
}
