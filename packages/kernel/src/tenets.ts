import type { PgClient } from "@platform/db";
import { listCapabilities } from "./registry.ts";
import type { EffectDeclaration, WriteCapability } from "./types.ts";

/**
 * A tenet is a statement about the data that must be true at all times.
 *
 * Tenets are not a hand-written list of things somebody thought of. They come
 * from two places, and that is what makes the set complete rather than arbitrary:
 *
 *   1. **Axioms** — properties of the platform itself, true of every capability
 *      (an approval is decided by a second person).
 *   2. **Derivation from the declaration** — every field of a write policy that
 *      a human reviewed (`limits`, `approval`, `idempotent`) plus the effect it
 *      declares (where the row lands, what pool it draws down) generates the
 *      tenet that committed data obeys it.
 *
 * So a new money-moving capability gets its rules the moment it is declared, and
 * a rule cannot drift from the declaration it came from: they are the same
 * sentence, one enforced before the fact and one proved after it.
 *
 * Tenets are expressed as SQL over committed state rather than as assertions in
 * a handler, so the same statement is checkable by three mechanisms that do not
 * trust each other — as a postcondition inside the transaction making a change,
 * by the reconciler on a timer, and by a human with `psql`.
 *
 * `query` returns zero rows when the tenet holds, and one row per violation
 * otherwise, with a `subject` and a `detail` column.
 */
export interface Tenet {
  id: string;
  /** The claim, in the words you would use to defend it to an auditor. */
  statement: string;
  query: string;
  /** What this tenet was derived from, so a reader can check the derivation. */
  derivedFrom: string;
  /** Capabilities halted while this tenet is violated. */
  halts: string[];
  /** Checked inside the transaction of these capabilities, before commit. */
  postconditionFor: string[];
}

/**
 * Thresholds are read from `capability_registry`, which the runtime writes from
 * the declared policy at startup, so the query a human runs by hand is judged
 * against the same numbers the runtime enforces.
 */
const declared = (capability: string, expression: string) =>
  `(select ${expression} from capability_registry where name = '${capability}')`;

const ceiling = (capability: string) =>
  declared(capability, "(policy->'limits'->>'maxAmountCents')::bigint");

const perHour = (capability: string) => declared(capability, "(policy->'limits'->>'maxPerHour')::int");

const approvalThreshold = (capability: string) =>
  declared(capability, "(policy->'approval'->>'amountCents')::bigint");

const liveRows = (effect: EffectDeclaration) =>
  effect.live ? `e.${effect.live.column} = '${effect.live.equals}'` : "true";

/** Properties of the platform, independent of any capability that uses it. */
const AXIOMS: Tenet[] = [
  {
    id: "approvals.decided_by_a_second_person",
    statement: "No approval was decided by the person who requested it.",
    derivedFrom: "axiom: an approval is another person's judgement, or it is not one",
    query: `
      select id as subject, 'requested and decided by ' || requested_by as detail
        from approvals
       where decided_by is not null and decided_by = requested_by`,
    halts: [],
    postconditionFor: [],
  },
];

function deriveTenets(capability: WriteCapability): Tenet[] {
  const { name, policy } = capability;
  const effect = policy.effect;
  if (!effect) return [];

  const live = liveRows(effect);
  const amount = `e.${effect.amountColumn}`;
  const guards = { halts: [name], postconditionFor: [name] };
  const tenets: Tenet[] = [];

  // From the platform's attribution rule: an effect is one audited invocation's
  // doing, and moved exactly the amount that invocation recorded.
  tenets.push({
    id: `${name}.effects_are_attributed`,
    statement: `Every row in ${effect.table} was written by one audited ${name} invocation that recorded the same amount.`,
    derivedFrom: "axiom: an effect nobody audited did not legitimately happen",
    query: `
      select e.id::text as subject,
             case
               when a.id is null
                 then 'no ok audit of ${name} for invocation ' || coalesce(e.invocation_id::text, '(none)')
               else 'audited ' || coalesce(a.amount_cents, -1) || ' but moved ' || ${amount}
             end as detail
        from ${effect.table} e
        left join audit_log a
          on a.invocation_id = e.invocation_id and a.outcome = 'ok' and a.capability = '${name}'
       where ${live}
         and (a.id is null or a.amount_cents is distinct from ${amount})`,
    ...guards,
  });

  if (effect.conserves) {
    const pool = effect.conserves;
    tenets.push({
      id: `${name}.conserves_${pool.table}`,
      statement: `The ${effect.table} rows drawn against a ${pool.table} row never exceed it.`,
      derivedFrom: `policy.effect.conserves: ${effect.table}.${effect.amountColumn} draws down ${pool.table}.${pool.amountColumn}`,
      query: `
        select p.id::text as subject,
               'drew ' || sum(${amount}) || ' from a pool of ' || p.${pool.amountColumn} as detail
          from ${pool.table} p
          join ${effect.table} e on e.${pool.via} = p.id and ${live}
         group by p.id, p.${pool.amountColumn}
        having sum(${amount}) > p.${pool.amountColumn}`,
      ...guards,
    });
  }

  if (policy.limits.maxAmountCents !== null) {
    tenets.push({
      id: `${name}.respects_declared_ceiling`,
      statement: `No ${effect.table} row exceeds the per-invocation ceiling ${name} declares.`,
      derivedFrom: "policy.limits.maxAmountCents",
      query: `
        select e.id::text as subject,
               ${amount} || ' exceeds the declared ceiling ' || ${ceiling(name)} as detail
          from ${effect.table} e
         where ${live}
           and ${ceiling(name)} is not null
           and ${amount} > ${ceiling(name)}`,
      ...guards,
    });
  }

  if (policy.approval.mode !== "never") {
    const aboveThreshold =
      policy.approval.mode === "above_amount"
        ? `and ${approvalThreshold(name)} is not null and ${amount} > ${approvalThreshold(name)}`
        : "";
    tenets.push({
      id: `${name}.carries_the_declared_approval`,
      statement:
        policy.approval.mode === "above_amount"
          ? `Every ${effect.table} row above the threshold ${name} declares was granted by a second person for that same amount.`
          : `Every ${effect.table} row was granted by a second person for that same amount.`,
      derivedFrom: `policy.approval.mode = ${policy.approval.mode}`,
      query: `
        select e.id::text as subject,
               case
                 when ap.id is null then 'no approval for a ' || ${amount} || ' effect that required one'
                 when ap.decided_by is null then 'approval ' || ap.id || ' was never decided'
                 when ap.decided_by = ap.requested_by then 'approval ' || ap.id || ' was self-granted'
                 else 'approval ' || ap.id || ' was granted for ' || coalesce(ap.amount_cents, -1)
               end as detail
          from ${effect.table} e
          left join audit_log a on a.invocation_id = e.invocation_id
          left join approvals ap on ap.id = a.approval_id
         where ${live}
           ${aboveThreshold}
           and (ap.id is null
                or ap.decided_by is null
                or ap.decided_by = ap.requested_by
                or ap.amount_cents is distinct from ${amount})`,
      ...guards,
    });
  }

  tenets.push({
    id: `${name}.respects_declared_rate`,
    statement: `No actor was accepted for ${name} more often in an hour than it declares.`,
    derivedFrom: "policy.limits.maxPerHour",
    query: `
      select a.actor_id as subject,
             count(*) || ' accepted invocations in the hour to ' || a.at ||
               ', above the declared ' || ${perHour(name)} as detail
        from audit_log a
        join audit_log b
          on b.capability = a.capability
         and b.actor_id = a.actor_id
         and b.outcome in ('ok', 'pending_approval')
         and b.at <= a.at
         and b.at > a.at - interval '1 hour'
       where a.capability = '${name}'
         and a.outcome in ('ok', 'pending_approval')
         and ${perHour(name)} is not null
       group by a.id, a.actor_id, a.at
      having count(*) > ${perHour(name)}`,
    ...guards,
  });

  tenets.push({
    id: `${name}.is_idempotent`,
    statement: `No idempotency key for ${name} produced more than one row in ${effect.table}.`,
    derivedFrom: "policy.idempotent",
    query: `
      select a.idempotency_key as subject,
             'produced ' || count(*) || ' effects' as detail
        from audit_log a
        join ${effect.table} e on e.invocation_id = a.invocation_id
       where a.capability = '${name}'
         and a.idempotency_key is not null
         and ${live}
       group by a.idempotency_key
      having count(*) > 1`,
    ...guards,
  });

  return tenets;
}

/**
 * Every tenet currently in force: the axioms, plus those derived from the policy
 * of each registered write capability. Derived rather than stored, so the set
 * cannot fall behind the declarations it is supposed to be proving.
 */
export function tenets(): Tenet[] {
  const derived = listCapabilities()
    .filter((capability): capability is WriteCapability => capability.kind === "write")
    .flatMap(deriveTenets);
  return [...AXIOMS, ...derived];
}

export interface TenetViolation {
  tenetId: string;
  subject: string;
  detail: string;
}

export function getTenet(id: string): Tenet | undefined {
  return tenets().find((tenet) => tenet.id === id);
}

export function tenetsFor(capability: string): Tenet[] {
  return tenets().filter((tenet) => tenet.postconditionFor.includes(capability));
}

export function tenetsHalting(capability: string): Tenet[] {
  return tenets().filter((tenet) => tenet.halts.includes(capability));
}

/** Runs one tenet against whatever the given client can see. */
export async function checkTenet(client: PgClient, tenet: Tenet): Promise<TenetViolation[]> {
  const { rows } = await client.query<{ subject: string; detail: string }>(tenet.query);
  return rows.map((row) => ({
    tenetId: tenet.id,
    subject: String(row.subject),
    detail: String(row.detail),
  }));
}

/**
 * Postcondition check, run inside the writing transaction after the effect and
 * its audit record. A violation here aborts the transaction, so the money never
 * commits — the effect is undone and only the audited failure survives.
 */
export async function assertPostconditions(
  client: PgClient,
  capability: string,
): Promise<TenetViolation[]> {
  const violations: TenetViolation[] = [];
  for (const tenet of tenetsFor(capability)) {
    violations.push(...(await checkTenet(client, tenet)));
  }
  return violations;
}

export function describeViolations(violations: TenetViolation[]): string {
  return violations
    .map((violation) => `${violation.tenetId}: ${violation.subject} (${violation.detail})`)
    .join("; ");
}
