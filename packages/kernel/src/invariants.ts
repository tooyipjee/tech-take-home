import type { PgClient } from "@rangka/db";
import { listCapabilities } from "./registry.ts";
import type { EffectDeclaration, WriteCapability, WritePolicy } from "./types.ts";

/**
 * An invariant is a statement about the data that must be true at all times.
 *
 * Invariants are not a hand-written list of things somebody thought of. They come
 * from two places, and that is what makes the set complete rather than arbitrary:
 *
 *   1. **Axioms** — properties of the platform itself, true of every capability
 *      (an approval is decided by a second person).
 *   2. **Derivation from the declaration** — every field of a write policy that
 *      a human reviewed (`limits`, `approval`, `idempotent`) plus the effect it
 *      declares (where the row lands, what pool it draws down) generates the
 *      invariant that committed data obeys it.
 *
 * So a new money-moving capability gets its rules the moment it is declared, and
 * a rule cannot drift from the declaration it came from: they are the same
 * sentence, one enforced before the fact and one proved after it.
 *
 * Invariants are expressed as SQL over committed state rather than as assertions in
 * a handler, so the same statement is checkable by three mechanisms that do not
 * trust each other — as a postcondition inside the transaction making a change,
 * by the reconciler on a timer, and by a human with `psql`.
 *
 * `query` returns zero rows when the invariant holds, and one row per violation
 * otherwise, with a `subject` and a `detail` column.
 */
export interface Invariant {
  id: string;
  /** The claim, in the words you would use to defend it to an auditor. */
  statement: string;
  query: string;
  /** What this invariant was derived from, so a reader can check the derivation. */
  derivedFrom: string;
  /** Capabilities halted while this invariant is violated. */
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

/**
 * Effect tables are shared: several capabilities append to `kyc_case_events`. Every
 * generated query is scoped to the capability that wrote the row, so one capability's
 * invariant never judges another's effects.
 */
const liveRows = (capability: string, effect: EffectDeclaration) =>
  [
    `e.capability = '${capability}'`,
    effect.live ? `e.${effect.live.column} = '${effect.live.equals}'` : null,
  ]
    .filter((clause): clause is string => clause !== null)
    .join(" and ");

/**
 * The approver scope a subject row requires, as a SQL expression over `s`: the same
 * clauses the runtime evaluates before holding the call, in the same order.
 */
const requiredApproverScope = (policy: WritePolicy): string | null => {
  if (policy.approval.mode === "never") return null;
  if (policy.approval.mode === "derived_from_subject") {
    const clauses = policy.approval.clauses
      .map((clause) => `when (${clause.when}) then '${clause.approverScope}'`)
      .join("\n               ");
    return `case ${clauses} else null end`;
  }
  return `'${policy.approverScope}'`;
};

/** Properties of the platform, independent of any capability that uses it. */
const AXIOMS: Invariant[] = [
  {
    id: "approvals.decided_by_a_holder_of_the_required_scope",
    statement:
      "Every decided approval was decided by someone whose role holds the scope the approval recorded.",
    derivedFrom: "axiom: the scope an approval demands is the scope its decider must hold",
    query: `
      select ap.id as subject,
             'decided by ' || ap.decided_by || ' (' || u.role || '), who does not hold '
               || ap.approver_scope as detail
        from approvals ap
        join platform_users u on u.id = ap.decided_by
       where ap.decided_by is not null
         and not exists (select 1 from role_scopes rs
                          where rs.role = u.role and rs.scope = ap.approver_scope)`,
    halts: [],
    postconditionFor: [],
  },
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

function deriveInvariants(capability: WriteCapability): Invariant[] {
  const { name, policy } = capability;
  const effect = policy.effect;
  if (!effect) return [];

  const live = liveRows(name, effect);
  const amount = effect.amountColumn ? `e.${effect.amountColumn}` : null;
  const guards = { halts: [name], postconditionFor: [name] };
  const invariants: Invariant[] = [];

  // From the platform's attribution rule: an effect is one audited invocation's
  // doing, and moved exactly the amount that invocation recorded.
  invariants.push({
    id: `${name}.effects_are_attributed`,
    statement: amount
      ? `Every ${name} row in ${effect.table} was written by one audited invocation that recorded the same amount.`
      : `Every ${name} row in ${effect.table} was written by one audited invocation.`,
    derivedFrom: "axiom: an effect nobody audited did not legitimately happen",
    query: `
      select e.id::text as subject,
             case
               when a.id is null
                 then 'no ok audit of ${name} for invocation ' || coalesce(e.invocation_id::text, '(none)')
               else ${amount ? `'audited ' || coalesce(a.amount_cents, -1) || ' but moved ' || ${amount}` : `'audited more than once'`}
             end as detail
        from ${effect.table} e
        left join audit_log a
          on a.invocation_id = e.invocation_id and a.outcome = 'ok' and a.capability = '${name}'
       where ${live}
         and (a.id is null${amount ? ` or a.amount_cents is distinct from ${amount}` : ""})`,
    ...guards,
  });

  if (effect.oncePerSubject) {
    invariants.push({
      id: `${name}.happens_at_most_once_per_subject`,
      statement: `No ${effect.subjectColumn} has more than one ${name} effect in ${effect.table}.`,
      derivedFrom: "policy.effect.oncePerSubject",
      query: `
        select e.${effect.subjectColumn}::text as subject,
               'has ' || count(*) || ' ${name} effects' as detail
          from ${effect.table} e
         where ${live}
         group by e.${effect.subjectColumn}
        having count(*) > 1`,
      ...guards,
    });
  }

  if (effect.conserves && amount) {
    const pool = effect.conserves;
    invariants.push({
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

  if (policy.limits.maxAmountCents !== null && amount) {
    invariants.push({
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

  const required = requiredApproverScope(policy);
  if (required) {
    // Which effects needed an approval, and which scope it had to carry. For a
    // data-derived rule this is a question about the subject row, so the subject is
    // joined in and the declared clauses are asked of it — the same clauses, in the
    // same order, that the runtime asked before letting the write through.
    const subjectJoin =
      policy.approval.mode === "derived_from_subject" && policy.subject
        ? `join ${policy.subject.table} s on s.id = e.${effect.subjectColumn}`
        : "";
    const amountMatches = amount ? ` or ap.amount_cents is distinct from ${amount}` : "";
    const aboveThreshold =
      policy.approval.mode === "above_amount" && amount
        ? `and ${approvalThreshold(name)} is not null and ${amount} > ${approvalThreshold(name)}`
        : "";
    invariants.push({
      id: `${name}.carries_the_declared_approval`,
      statement:
        policy.approval.mode === "derived_from_subject"
          ? `Every ${effect.table} row whose subject required approval carries one, decided by a second person holding the scope that subject demanded.`
          : policy.approval.mode === "above_amount"
            ? `Every ${effect.table} row above the threshold ${name} declares was granted by a second person for that same amount.`
            : `Every ${effect.table} row was granted by a second person holding ${policy.approverScope}.`,
      derivedFrom: `policy.approval.mode = ${policy.approval.mode}`,
      query: `
        select e.id::text as subject,
               case
                 when ap.id is null then 'no approval for an effect that required ' || (${required})
                 when ap.decided_by is null then 'approval ' || ap.id || ' was never decided'
                 when ap.decided_by = ap.requested_by then 'approval ' || ap.id || ' was self-granted'
                 when ap.approver_scope is distinct from (${required})
                   then 'approval ' || ap.id || ' carried ' || ap.approver_scope || ' but ' || (${required}) || ' was required'
                 else 'approval ' || ap.id || ' does not match the effect'
               end as detail
          from ${effect.table} e
          ${subjectJoin}
          left join audit_log a on a.invocation_id = e.invocation_id
          left join approvals ap on ap.id = a.approval_id
         where ${live}
           and (${required}) is not null
           ${aboveThreshold}
           and (ap.id is null
                or ap.decided_by is null
                or ap.decided_by = ap.requested_by
                or ap.approver_scope is distinct from (${required})${amountMatches})`,
      ...guards,
    });
  }

  if (effect.tracksState && policy.subject) {
    const tracked = effect.tracksState;
    const subject = policy.subject;
    // The effect table is the account of how the state got where it is, so two things
    // must hold of it: the row agrees with the last change recorded against it, and the
    // changes join up. A state moved by hand fails the first; moved by hand and moved
    // back fails the second, because the next recorded change starts from a state the
    // previous one did not leave.
    invariants.push({
      id: `${name}.state_matches_the_last_recorded_change`,
      statement: `Every ${subject.table}.${tracked.column} is the value the last ${name} change recorded for it.`,
      derivedFrom: `policy.effect.tracksState: ${effect.table}.${tracked.toColumn} is the authority for ${subject.table}.${tracked.column}`,
      // The join is inner on purpose: a subject with no recorded change has no
      // recorded state to be judged against, and inventing one would mean this
      // invariant asserting what the seed happened to say. The database trigger is
      // what covers that case — it refuses any state change with no matching row,
      // including the first.
      query: `
        select s.id::text as subject,
               'is ' || s.${tracked.column} || ' but the last recorded change left it '
                 || last.${tracked.toColumn} as detail
          from ${subject.table} s
          join lateral (select e.${tracked.toColumn}
                          from ${effect.table} e
                         where e.${effect.subjectColumn} = s.id and ${live}
                         order by e.at desc, e.id desc
                         limit 1) last on true
         where s.${tracked.column} is distinct from last.${tracked.toColumn}`,
      ...guards,
    });

    invariants.push({
      id: `${name}.records_every_state_change`,
      statement: `No ${name} change starts from a value the change before it did not leave, so no ${subject.table}.${tracked.column} moved without being recorded.`,
      derivedFrom: `policy.effect.tracksState: ${effect.table}.${tracked.fromColumn} continues the previous ${tracked.toColumn}`,
      query: `
        select changes.${effect.subjectColumn}::text as subject,
               'a change recorded a move from ' || changes.${tracked.fromColumn}
                 || ' after the previous one left it ' || changes.previous as detail
          from (select e.${effect.subjectColumn}, e.${tracked.fromColumn},
                       lag(e.${tracked.toColumn}) over (partition by e.${effect.subjectColumn}
                                                        order by e.at, e.id) as previous
                  from ${effect.table} e
                 where ${live}) changes
         where changes.previous is not null
           and changes.${tracked.fromColumn} is distinct from changes.previous`,
      ...guards,
    });
  }

  invariants.push({
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

  invariants.push({
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

  return invariants;
}

/**
 * Every invariant currently in force: the axioms, plus those derived from the policy
 * of each registered write capability. Derived rather than stored, so the set
 * cannot fall behind the declarations it is supposed to be proving.
 */
export function invariants(): Invariant[] {
  const derived = listCapabilities()
    .filter((capability): capability is WriteCapability => capability.kind === "write")
    .flatMap(deriveInvariants);
  return [...AXIOMS, ...derived];
}

export interface InvariantViolation {
  invariantId: string;
  subject: string;
  detail: string;
}

export function getInvariant(id: string): Invariant | undefined {
  return invariants().find((invariant) => invariant.id === id);
}

export function invariantsFor(capability: string): Invariant[] {
  return invariants().filter((invariant) => invariant.postconditionFor.includes(capability));
}

export function invariantsHalting(capability: string): Invariant[] {
  return invariants().filter((invariant) => invariant.halts.includes(capability));
}

/** Runs one invariant against whatever the given client can see. */
export async function checkInvariant(client: PgClient, invariant: Invariant): Promise<InvariantViolation[]> {
  const { rows } = await client.query<{ subject: string; detail: string }>(invariant.query);
  return rows.map((row) => ({
    invariantId: invariant.id,
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
): Promise<InvariantViolation[]> {
  const violations: InvariantViolation[] = [];
  for (const invariant of invariantsFor(capability)) {
    violations.push(...(await checkInvariant(client, invariant)));
  }
  return violations;
}

export function describeViolations(violations: InvariantViolation[]): string {
  return violations
    .map((violation) => `${violation.invariantId}: ${violation.subject} (${violation.detail})`)
    .join("; ");
}
