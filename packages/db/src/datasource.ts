import type { PgClient } from "./pool.ts";

export type CaseStatus =
  | "pending_review"
  | "info_requested"
  | "escalated"
  | "awaiting_approval"
  | "approved"
  | "rejected";

export type RiskBand = "low" | "medium" | "high";

export interface MaskedIdentity {
  fullName: string;
  email: string;
  dateOfBirth: string;
  nationalId: string;
  address: string;
  masked: boolean;
}

export interface ScreeningHit {
  id: string;
  provider: string;
  list: string;
  matchedName: string;
  matchStrength: number;
  resolution: "unresolved" | "false_positive" | "confirmed";
}

export interface CaseDocument {
  id: string;
  type: string;
  uploadedAt: string;
  verification: string;
  note?: string;
}

export interface RiskSignal {
  label: string;
  points: number;
  detail: string;
}

export interface CaseEvent {
  id: string;
  at: string;
  actor: string;
  summary: string;
  capability?: string;
  auditId?: string;
}

export interface CaseSummary {
  id: string;
  reference: string;
  applicantName: string;
  country: string;
  status: CaseStatus;
  riskBand: RiskBand;
  riskScore: number;
  submittedAt: string;
  slaDueAt: string;
  assignedTo: string | null;
  unresolvedHits: number;
  revision: number;
}

export interface CaseDetail extends CaseSummary {
  identity: MaskedIdentity;
  documents: CaseDocument[];
  screeningHits: ScreeningHit[];
  riskSignals: RiskSignal[];
  timeline: CaseEvent[];
  productTier: string;
  expectedMonthlyVolumeUsd: number;
}

export interface FlagChange {
  id: string;
  at: string;
  actor: string;
  enabled: boolean;
  note: string;
}

export interface FeatureFlag {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  /** Gates payments, limits or a customer-facing money flow. */
  protected: boolean;
  revision: number;
  /** Most recent flips first, so a screen can show how the flag got here. */
  recentChanges: FlagChange[];
}

export interface CaseFilter {
  status?: CaseStatus | "all";
  riskBand?: RiskBand | "all";
  assignment?: "all" | "mine" | "unassigned";
  query?: string;
  actorId: string;
  limit: number;
}

/**
 * Thrown when the caller decided on a case that has since moved. It is a refusal, not
 * a crash: the runtime turns it into an outcome and an audit row, and no effect lands.
 */
export class StaleRevisionError extends Error {}

/**
 * The only door capability handlers have to business data. Handlers never see a
 * pool or a raw connection: the runtime binds this to the transaction it opened,
 * so every effect lands in the same transaction as its audit record.
 *
 * Note what is *not* here: no method returns unmasked PII except `revealIdentity`,
 * which writes a disclosure row as it does so. A handler cannot read the applicant's
 * national id without leaving a record that it did.
 */
export interface DataSource {
  listCases(filter: CaseFilter): Promise<CaseSummary[]>;
  getCase(caseId: string): Promise<CaseDetail | null>;
  /** Unmasks the applicant and records the disclosure and its justification. */
  revealIdentity(input: {
    caseId: string;
    justification: string;
    actorId: string;
  }): Promise<{ identity: MaskedIdentity; revealsInLastHour: number } | null>;
  claimCase(input: { caseId: string; revision: number; actorId: string }): Promise<CaseDetail>;
  requestInfo(input: {
    caseId: string;
    revision: number;
    items: string[];
    note: string;
    actorId: string;
  }): Promise<CaseDetail>;
  escalateCase(input: {
    caseId: string;
    revision: number;
    note: string;
    actorId: string;
  }): Promise<CaseDetail>;
  decideCase(input: {
    caseId: string;
    revision: number;
    decision: "approved" | "rejected";
    reasonCode: string | null;
    note: string;
    actorId: string;
    /** Set when this is the replay of an approved request; the revision was checked then. */
    enforceRevision: boolean;
  }): Promise<CaseDetail>;
  fileSar(input: {
    caseId: string;
    revision: number;
    narrative: string;
    actorId: string;
    enforceRevision: boolean;
  }): Promise<CaseDetail>;
  listFeatureFlags(input: { limit: number; changesPerFlag: number }): Promise<FeatureFlag[]>;
  /** Records the flip and moves the flag; the two are one transaction or neither happens. */
  flipFeatureFlag(input: {
    flagId: string;
    revision: number;
    enabled: boolean;
    note: string;
    actorId: string;
    /** Set when this is the replay of an approved request; the revision was checked then. */
    enforceRevision: boolean;
  }): Promise<FeatureFlag>;
}

interface FlagRow {
  id: string;
  key: string;
  description: string;
  enabled: boolean;
  protected: boolean;
  revision: number;
}

interface CaseRow {
  id: string;
  reference: string;
  applicant_name: string;
  country: string;
  status: CaseStatus;
  risk_band: RiskBand;
  risk_score: number;
  submitted_at: Date;
  sla_due_at: Date;
  assigned_to: string | null;
  revision: number;
  unresolved_hits: string;
  awaiting_approval: boolean;
  product_tier: string;
  expected_monthly_volume_usd: string;
  full_name: string;
  email: string;
  date_of_birth: Date;
  national_id: string;
  address: string;
}

/**
 * A case is `awaiting_approval` exactly while a request against it is pending. That is
 * derived from the approvals table rather than stored, so the queue cannot show a case
 * as held when nothing is holding it, or as free when something is.
 */
const caseSelect = `
  select c.*,
         (select count(*) from kyc_screening_hits h
           where h.case_id = c.id and h.resolution = 'unresolved') as unresolved_hits,
         exists (select 1 from approvals a
                  where a.status = 'pending' and a.input->>'caseId' = c.id) as awaiting_approval
    from kyc_cases c
`;

const maskName = (name: string) =>
  name
    .split(" ")
    .map((part) => (part.length > 1 ? `${part[0]}${"•".repeat(part.length - 1)}` : part))
    .join(" ");

const maskEmail = (email: string) => {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(1, local.length - 2))}@${domain}`;
};

function maskedIdentity(row: CaseRow): MaskedIdentity {
  return {
    fullName: maskName(row.full_name),
    email: maskEmail(row.email),
    dateOfBirth: `${row.date_of_birth.toISOString().slice(0, 4)}-••-••`,
    nationalId: `•••••${row.national_id.slice(-3)}`,
    address: `${row.address.split(",").slice(-1)[0]?.trim() ?? ""} (masked)`,
    masked: true,
  };
}

function clearIdentity(row: CaseRow): MaskedIdentity {
  return {
    fullName: row.full_name,
    email: row.email,
    dateOfBirth: row.date_of_birth.toISOString().slice(0, 10),
    nationalId: row.national_id,
    address: row.address,
    masked: false,
  };
}

function toSummary(row: CaseRow): CaseSummary {
  return {
    id: row.id,
    reference: row.reference,
    applicantName: maskName(row.applicant_name),
    country: row.country,
    status: row.awaiting_approval ? "awaiting_approval" : row.status,
    riskBand: row.risk_band,
    riskScore: row.risk_score,
    submittedAt: row.submitted_at.toISOString(),
    slaDueAt: row.sla_due_at.toISOString(),
    assignedTo: row.assigned_to,
    unresolvedHits: Number(row.unresolved_hits),
    revision: row.revision,
  };
}

/**
 * Bound to one transaction *and* one invocation: the invocation id and the capability
 * name are stamped onto every effect by this layer, not by the capability handler, so
 * a handler cannot write a row that isn't attributable to an audited invocation.
 */
export function createDataSource(
  client: PgClient,
  invocationId: string,
  capability: string,
): DataSource {
  /** Locks the case, checks the revision the caller was looking at, and returns the row. */
  async function lockCase(caseId: string, revision: number | null): Promise<CaseRow> {
    const { rows } = await client.query<CaseRow>(`${caseSelect} where c.id = $1 for update of c`, [
      caseId,
    ]);
    const row = rows[0];
    if (!row) throw new StaleRevisionError(`unknown case: ${caseId}`);
    if (revision !== null && row.revision !== revision) {
      throw new StaleRevisionError(
        `case moved on (you saw r${revision}, current is r${row.revision}); reload before deciding`,
      );
    }
    return row;
  }

  async function appendEvent(caseId: string, actorId: string, summary: string): Promise<void> {
    await client.query(
      `insert into kyc_case_events (case_id, actor_id, summary, invocation_id, capability)
       values ($1, $2, $3, $4, $5)`,
      [caseId, actorId, summary, invocationId, capability],
    );
  }

  async function bumpRevision(
    caseId: string,
    patch: { status?: CaseStatus; assignedTo?: string },
  ): Promise<void> {
    await client.query(
      `update kyc_cases
          set revision = revision + 1,
              status = coalesce($2, status),
              assigned_to = coalesce($3, assigned_to)
        where id = $1`,
      [caseId, patch.status ?? null, patch.assignedTo ?? null],
    );
  }

  async function detail(caseId: string): Promise<CaseDetail> {
    const found = await api.getCase(caseId);
    if (!found) throw new StaleRevisionError(`unknown case: ${caseId}`);
    return found;
  }

  const api: DataSource = {
    async listCases(filter) {
      const { rows } = await client.query<CaseRow>(
        `${caseSelect}
          where ($1::text is null or c.status = $1)
            and ($2::text is null or c.risk_band = $2)
            and ($3::text is null or c.assigned_to = $3)
            and ($4::boolean is false or c.assigned_to is null)
            and ($5::text is null or lower(c.reference || ' ' || c.applicant_name || ' ' || c.country) like $5)
          order by c.sla_due_at asc
          limit $6`,
        [
          filter.status && filter.status !== "all" ? filter.status : null,
          filter.riskBand && filter.riskBand !== "all" ? filter.riskBand : null,
          filter.assignment === "mine" ? filter.actorId : null,
          filter.assignment === "unassigned",
          filter.query ? `%${filter.query.trim().toLowerCase()}%` : null,
          filter.limit,
        ],
      );
      return rows.map(toSummary);
    },

    async getCase(caseId) {
      const { rows } = await client.query<CaseRow>(`${caseSelect} where c.id = $1`, [caseId]);
      const row = rows[0];
      if (!row) return null;

      const [documents, hits, signals, events] = await Promise.all([
        client.query<{
          id: string;
          type: string;
          uploaded_at: Date;
          verification: string;
          note: string | null;
        }>("select * from kyc_documents where case_id = $1 order by uploaded_at", [caseId]),
        client.query<{
          id: string;
          provider: string;
          list: string;
          matched_name: string;
          match_strength: string;
          resolution: ScreeningHit["resolution"];
        }>("select * from kyc_screening_hits where case_id = $1 order by id", [caseId]),
        client.query<{ label: string; points: number; detail: string }>(
          "select label, points, detail from kyc_risk_signals where case_id = $1 order by id",
          [caseId],
        ),
        client.query<{
          id: string;
          at: Date;
          summary: string;
          capability: string | null;
          actor_name: string;
          audit_id: string | null;
        }>(
          `select e.id, e.at, e.summary, e.capability, u.name as actor_name,
                  (select a.id::text from audit_log a where a.invocation_id = e.invocation_id
                    and a.outcome = 'ok' limit 1) as audit_id
             from kyc_case_events e
             join platform_users u on u.id = e.actor_id
            where e.case_id = $1
            order by e.at, e.id`,
          [caseId],
        ),
      ]);

      return {
        ...toSummary(row),
        identity: maskedIdentity(row),
        productTier: row.product_tier,
        expectedMonthlyVolumeUsd: Number(row.expected_monthly_volume_usd),
        documents: documents.rows.map((doc) => ({
          id: doc.id,
          type: doc.type,
          uploadedAt: doc.uploaded_at.toISOString(),
          verification: doc.verification,
          ...(doc.note ? { note: doc.note } : {}),
        })),
        screeningHits: hits.rows.map((hit) => ({
          id: hit.id,
          provider: hit.provider,
          list: hit.list,
          matchedName: hit.matched_name,
          matchStrength: Number(hit.match_strength),
          resolution: hit.resolution,
        })),
        riskSignals: signals.rows.map((signal) => ({
          label: signal.label,
          points: signal.points,
          detail: signal.detail,
        })),
        // The submission is not an effect of any capability — it happened before the
        // case reached the queue — so it is derived from the case row rather than
        // stored as an event nobody can attribute to an invocation.
        timeline: [
          {
            id: `${row.id}_submitted`,
            at: row.submitted_at.toISOString(),
            actor: "system",
            summary: `Application submitted; automated screening scored ${row.risk_score} (${row.risk_band}).`,
          },
          ...events.rows.map((event) => ({
            id: String(event.id),
            at: event.at.toISOString(),
            actor: event.actor_name,
            summary: event.summary,
            ...(event.capability ? { capability: event.capability } : {}),
            ...(event.audit_id ? { auditId: event.audit_id } : {}),
          })),
        ],
      };
    },

    async revealIdentity({ caseId, justification, actorId }) {
      const { rows } = await client.query<CaseRow>(`${caseSelect} where c.id = $1`, [caseId]);
      const row = rows[0];
      if (!row) return null;

      await client.query(
        `insert into kyc_pii_disclosures (id, case_id, justification, actor_id, invocation_id, capability)
         values ($1, $2, $3, $4, $5, $6)`,
        [`pii_${invocationId.slice(0, 12)}`, caseId, justification, actorId, invocationId, capability],
      );
      await appendEvent(caseId, actorId, `Revealed applicant PII. Justification: "${justification}"`);

      const { rows: counted } = await client.query<{ count: string }>(
        `select count(*) from kyc_pii_disclosures
          where actor_id = $1 and at > now() - interval '1 hour'`,
        [actorId],
      );
      return {
        identity: clearIdentity(row),
        revealsInLastHour: Number(counted[0]?.count ?? 0),
      };
    },

    async claimCase({ caseId, revision, actorId }) {
      const row = await lockCase(caseId, revision);
      if (row.assigned_to && row.assigned_to !== actorId) {
        throw new StaleRevisionError("another reviewer already owns this case");
      }
      await bumpRevision(caseId, { assignedTo: actorId });
      await appendEvent(caseId, actorId, "Claimed the case.");
      return detail(caseId);
    },

    async requestInfo({ caseId, revision, items, note, actorId }) {
      await lockCase(caseId, revision);
      await bumpRevision(caseId, { status: "info_requested" });
      await appendEvent(
        caseId,
        actorId,
        `Requested more information: ${items.join(", ")}. ${note}`.trim(),
      );
      return detail(caseId);
    },

    async escalateCase({ caseId, revision, note, actorId }) {
      await lockCase(caseId, revision);
      await bumpRevision(caseId, { status: "escalated" });
      await appendEvent(caseId, actorId, `Escalated to enhanced due diligence: ${note}`);
      return detail(caseId);
    },

    async decideCase({ caseId, revision, decision, reasonCode, note, actorId, enforceRevision }) {
      const row = await lockCase(caseId, enforceRevision ? revision : null);
      // The database refuses a second decision too; refusing here makes it a conflict
      // the reviewer can understand rather than a constraint violation.
      if (row.status === "approved" || row.status === "rejected") {
        throw new StaleRevisionError(`case ${row.reference} was already ${row.status}`);
      }
      await client.query(
        `insert into kyc_case_decisions
           (id, case_id, decision, reason_code, note, decided_by, invocation_id, capability)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `dec_${invocationId.slice(0, 12)}`,
          caseId,
          decision,
          reasonCode,
          note,
          actorId,
          invocationId,
          capability,
        ],
      );
      await bumpRevision(caseId, { status: decision });
      await appendEvent(
        caseId,
        actorId,
        `${decision === "approved" ? "Approved" : "Rejected"}: ${note}`,
      );
      return detail(caseId);
    },

    async listFeatureFlags({ limit, changesPerFlag }) {
      const { rows } = await client.query<FlagRow>(
        "select * from feature_flags order by protected desc, key asc limit $1",
        [limit],
      );
      // The recent history of a flag is the effect table read back: the flag row says
      // what is true now, the change rows say who made it true and when.
      const { rows: changes } = await client.query<{
        id: string;
        flag_id: string;
        at: Date;
        to_enabled: boolean;
        note: string;
        actor_name: string;
      }>(
        `select c.id, c.flag_id, c.at, c.to_enabled, c.note, u.name as actor_name
           from feature_flag_changes c
           join platform_users u on u.id = c.flipped_by
          where c.flag_id = any($1::text[])
          order by c.at desc, c.id desc`,
        [rows.map((row) => row.id)],
      );

      return rows.map((row) => ({
        id: row.id,
        key: row.key,
        description: row.description,
        enabled: row.enabled,
        protected: row.protected,
        revision: row.revision,
        recentChanges: changes
          .filter((change) => change.flag_id === row.id)
          .slice(0, changesPerFlag)
          .map((change) => ({
            id: change.id,
            at: change.at.toISOString(),
            actor: change.actor_name,
            enabled: change.to_enabled,
            note: change.note,
          })),
      }));
    },

    async flipFeatureFlag({ flagId, revision, enabled, note, actorId, enforceRevision }) {
      const { rows } = await client.query<FlagRow>(
        "select * from feature_flags where id = $1 for update",
        [flagId],
      );
      const row = rows[0];
      if (!row) throw new StaleRevisionError(`unknown feature flag: ${flagId}`);
      if (enforceRevision && row.revision !== revision) {
        throw new StaleRevisionError(
          `${row.key} moved on (you saw r${revision}, current is r${row.revision}); reload before flipping`,
        );
      }
      if (row.enabled === enabled) {
        throw new StaleRevisionError(`${row.key} is already ${enabled ? "on" : "off"}`);
      }

      await client.query(
        `insert into feature_flag_changes
           (id, flag_id, from_enabled, to_enabled, note, flipped_by, invocation_id, capability)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          `flg_${invocationId.slice(0, 12)}`,
          flagId,
          row.enabled,
          enabled,
          note,
          actorId,
          invocationId,
          capability,
        ],
      );
      await client.query(
        "update feature_flags set enabled = $2, revision = revision + 1 where id = $1",
        [flagId, enabled],
      );

      const flags = await api.listFeatureFlags({ limit: 500, changesPerFlag: 5 });
      const updated = flags.find((flag) => flag.id === flagId);
      if (!updated) throw new StaleRevisionError(`unknown feature flag: ${flagId}`);
      return updated;
    },

    async fileSar({ caseId, revision, narrative, actorId, enforceRevision }) {
      await lockCase(caseId, enforceRevision ? revision : null);
      await client.query(
        `insert into kyc_sars (id, case_id, narrative, filed_by, invocation_id, capability)
         values ($1, $2, $3, $4, $5, $6)`,
        [`sar_${invocationId.slice(0, 12)}`, caseId, narrative, actorId, invocationId, capability],
      );
      await bumpRevision(caseId, { status: "escalated" });
      await appendEvent(caseId, actorId, `Filed a suspicious activity report: ${narrative}`);
      return detail(caseId);
    },
  };

  return api;
}
