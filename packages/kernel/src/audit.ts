import { withClient } from "@platform/db";
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
 */
export async function syncRegistry(): Promise<number> {
  const capabilities = listCapabilities();
  await withClient(async (client) => {
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
