import { withClient } from "@rangka/db";
import type { PgClient } from "@rangka/db";
import { checkInvariant, describeViolations, getInvariant, invariants, invariantsHalting } from "./invariants.ts";
import type { Invariant, InvariantViolation } from "./invariants.ts";
import type { Principal } from "./types.ts";

export interface InvariantStatus {
  id: string;
  statement: string;
  derivedFrom: string;
  halts: string[];
  postconditionFor: string[];
  lastRunAt: string | null;
  violations: number;
  detail: string | null;
}

export interface HaltRow {
  id: number;
  capability: string;
  invariantId: string;
  detail: string;
  haltedAt: string;
}

export interface ReconciliationResult {
  checkedAt: string;
  violations: InvariantViolation[];
  halted: string[];
}

/**
 * Re-derives every invariant from committed state and halts the capabilities a
 * violated invariant guards.
 *
 * The runtime already refuses to commit a transaction that breaks an invariant, so
 * anything this finds arrived by a path the runtime never saw — a manual UPDATE,
 * a migration, a restore from backup, a bug in the kernel itself. That is
 * exactly the class of problem an audit log alone cannot tell you about, which
 * is why this runs on a timer rather than only in tests.
 */
export async function reconcile(): Promise<ReconciliationResult> {
  const violations: InvariantViolation[] = [];
  const halted: string[] = [];

  await withClient(async (client) => {
    for (const invariant of invariants()) {
      const started = Date.now();
      const found = await checkInvariant(client, invariant);
      violations.push(...found);
      await client.query(
        "insert into invariant_runs (invariant_id, violations, detail, duration_ms) values ($1, $2, $3, $4)",
        [invariant.id, found.length, found.length ? describeViolations(found) : null, Date.now() - started],
      );
      if (found.length > 0) {
        halted.push(...(await haltCapabilities(client, invariant, found)));
      }
    }
  });

  return { checkedAt: new Date().toISOString(), violations, halted };
}

async function haltCapabilities(
  client: PgClient,
  invariant: Invariant,
  violations: InvariantViolation[],
): Promise<string[]> {
  const halted: string[] = [];
  for (const capability of invariant.halts) {
    const { rowCount } = await client.query(
      `insert into capability_halts (capability, invariant_id, detail)
       values ($1, $2, $3)
       on conflict do nothing`,
      [capability, invariant.id, describeViolations(violations).slice(0, 2000)],
    );
    if (rowCount) halted.push(capability);
  }
  return halted;
}

export async function activeHalt(client: PgClient, capability: string): Promise<HaltRow | null> {
  const { rows } = await client.query(
    `select id, capability, invariant_id, detail, halted_at
       from capability_halts where capability = $1 and cleared_at is null`,
    [capability],
  );
  const row = rows[0];
  return row
    ? {
        id: Number(row.id),
        capability: row.capability,
        invariantId: row.invariant_id,
        detail: row.detail,
        haltedAt: row.halted_at.toISOString(),
      }
    : null;
}

export async function listHalts(): Promise<HaltRow[]> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `select id, capability, invariant_id, detail, halted_at
         from capability_halts where cleared_at is null order by halted_at desc`,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      capability: row.capability,
      invariantId: row.invariant_id,
      detail: row.detail,
      haltedAt: row.halted_at.toISOString(),
    }));
  });
}

export async function listInvariantStatus(): Promise<InvariantStatus[]> {
  return withClient(async (client) => {
    const { rows } = await client.query(
      `select distinct on (invariant_id) invariant_id, at, violations, detail
         from invariant_runs order by invariant_id, at desc`,
    );
    const latest = new Map(rows.map((row) => [row.invariant_id, row]));
    return invariants().map((invariant) => {
      const run = latest.get(invariant.id);
      return {
        id: invariant.id,
        statement: invariant.statement,
        derivedFrom: invariant.derivedFrom,
        halts: invariant.halts,
        postconditionFor: invariant.postconditionFor,
        lastRunAt: run ? run.at.toISOString() : null,
        violations: run ? Number(run.violations) : 0,
        detail: run?.detail ?? null,
      };
    });
  });
}

export interface ClearHaltResult {
  cleared: boolean;
  message: string;
}

/**
 * Clearing is a human decision, but not a way to make a violation disappear:
 * the invariant is re-run first and the halt stays if the data is still wrong.
 */
export async function clearHalt(capability: string, principal: Principal): Promise<ClearHaltResult> {
  if (!principal.scopes.includes("invariants:clear")) {
    return { cleared: false, message: `${principal.role} cannot clear a halt` };
  }

  return withClient(async (client) => {
    const halt = await activeHalt(client, capability);
    if (!halt) return { cleared: false, message: `${capability} is not halted` };

    // Every invariant guarding this capability is re-run, not just the one that
    // tripped: resuming on a green light from one statement while another is
    // broken would be the same mistake as not checking at all.
    const guarding = invariantsHalting(capability);
    for (const invariant of guarding.length > 0 ? guarding : [getInvariant(halt.invariantId)]) {
      if (!invariant) continue;
      const stillBroken = await checkInvariant(client, invariant);
      if (stillBroken.length > 0) {
        return {
          cleared: false,
          message: `${invariant.id} is still violated: ${describeViolations(stillBroken)}`,
        };
      }
    }

    await client.query(
      "update capability_halts set cleared_at = now(), cleared_by = $2 where id = $1",
      [halt.id, principal.id],
    );
    return { cleared: true, message: `${capability} resumed by ${principal.name}` };
  });
}

/** Starts the reconciler loop; returns a stop function. */
export function startReconciler(intervalMs: number): () => void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const result = await reconcile();
      if (result.violations.length > 0) {
        console.error(
          `[reconciler] ${result.violations.length} violation(s): ${describeViolations(result.violations)}`,
        );
      }
    } catch (error) {
      console.error("[reconciler] run failed", error);
    }
  };
  void tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
