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

export interface CaseFilter {
  status?: CaseStatus | "all";
  riskBand?: RiskBand | "all";
  assignment?: "all" | "mine" | "unassigned";
  query?: string;
  actorId: string;
  limit: number;
}

export interface PaymentSummary {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  /** Live refunds already issued against this payment. */
  refundedCents: number;
  /** What is left of the payment: the pool a further refund draws from. */
  remainingCents: number;
  refundCount: number;
  instrument: string;
  descriptor: string;
  status: string;
  capturedAt: string;
}

/** One refund already issued against a payment, and who is answerable for it. */
export interface RefundRecord {
  id: string;
  amountCents: number;
  reason: string;
  at: string;
  requestedBy: string;
  approvedBy: string | null;
  status: string;
}

export interface PaymentDetail extends PaymentSummary {
  customerEmail: string;
  refunds: RefundRecord[];
  /** The rest of this customer's payments, so a refund is judged in context. */
  customerPayments: PaymentSummary[];
}

export interface PaymentFilter {
  query?: string;
  customerId?: string;
  limit: number;
}

/**
 * Thrown when the caller decided on a case that has since moved. It is a refusal, not
 * a crash: the runtime turns it into an outcome and an audit row, and no effect lands.
 */
export class StaleRevisionError extends Error {}

/**
 * Thrown when the record the caller named does not exist. Also a refusal rather than a
 * crash: "there is no such payment" is an answer, and one worth having in the audit log
 * under its own outcome instead of hidden among genuine failures.
 */
export class NotFoundError extends Error {}

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
  listPayments(filter: PaymentFilter): Promise<PaymentSummary[]>;
  getPayment(paymentId: string): Promise<PaymentDetail | null>;
  /**
   * Records the intent to refund. Refuses, rather than trimming, a refund that would
   * take the payment past its own amount: the caller was looking at a balance that has
   * since moved, and silently refunding less than asked is its own incident.
   */
  issueRefund(input: {
    paymentId: string;
    amountCents: number;
    reason: string;
    actorId: string;
  }): Promise<PaymentDetail>;
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

interface PaymentRow {
  id: string;
  reference: string;
  customer_id: string;
  customer_name: string;
  customer_email: string;
  amount_cents: string;
  instrument: string;
  descriptor: string;
  status: string;
  captured_at: Date;
  refunded_cents: string;
  refund_count: string;
}

/**
 * What a payment has left is derived from the live refunds against it, never stored:
 * a balance column and a refund table are two answers to one question, and the day
 * they disagree is the day the ceiling stops meaning anything.
 */
const paymentSelect = `
  select p.*,
         coalesce((select sum(r.amount_cents) from refunds r
                    where r.payment_id = p.id and r.status = 'issued'), 0) as refunded_cents,
         (select count(*) from refunds r
           where r.payment_id = p.id and r.status = 'issued') as refund_count
    from payments p
`;

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function toPayment(row: PaymentRow): PaymentSummary {
  const amountCents = Number(row.amount_cents);
  const refundedCents = Number(row.refunded_cents);
  return {
    id: row.id,
    reference: row.reference,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amountCents,
    refundedCents,
    remainingCents: amountCents - refundedCents,
    refundCount: Number(row.refund_count),
    instrument: row.instrument,
    descriptor: row.descriptor,
    status: row.status,
    capturedAt: row.captured_at.toISOString(),
  };
}

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

    async listPayments({ query, customerId, limit }) {
      const { rows } = await client.query<PaymentRow>(
        `${paymentSelect}
          where ($1::text is null or p.customer_id = $1)
            and ($2::text is null or lower(p.reference || ' ' || p.customer_name || ' '
                                           || p.customer_email || ' ' || p.descriptor) like $2)
          order by p.captured_at desc
          limit $3`,
        [
          customerId ?? null,
          query ? `%${query.trim().toLowerCase()}%` : null,
          limit,
        ],
      );
      return rows.map(toPayment);
    },

    async getPayment(paymentId) {
      const { rows } = await client.query<PaymentRow>(`${paymentSelect} where p.id = $1`, [
        paymentId,
      ]);
      const row = rows[0];
      if (!row) return null;

      // Who approved a refund is not stored on the refund: it is the approval the
      // audited invocation carried, so it is read back through the audit row rather
      // than duplicated where a handler could write anything it liked.
      const [refunds, history] = await Promise.all([
        client.query<{
          id: string;
          amount_cents: string;
          reason: string;
          at: Date;
          status: string;
          requested_by_name: string;
          approved_by_name: string | null;
        }>(
          `select r.id, r.amount_cents, r.reason, r.at, r.status,
                  u.name as requested_by_name,
                  (select d.name from audit_log a
                     join approvals ap on ap.id = a.approval_id
                     join platform_users d on d.id = ap.decided_by
                    where a.invocation_id = r.invocation_id
                    limit 1) as approved_by_name
             from refunds r
             join platform_users u on u.id = r.requested_by
            where r.payment_id = $1
            order by r.at, r.id`,
          [paymentId],
        ),
        client.query<PaymentRow>(
          `${paymentSelect} where p.customer_id = $1 and p.id <> $2 order by p.captured_at desc limit 20`,
          [row.customer_id, paymentId],
        ),
      ]);

      return {
        ...toPayment(row),
        customerEmail: row.customer_email,
        refunds: refunds.rows.map((refund) => ({
          id: refund.id,
          amountCents: Number(refund.amount_cents),
          reason: refund.reason,
          at: refund.at.toISOString(),
          status: refund.status,
          requestedBy: refund.requested_by_name,
          approvedBy: refund.approved_by_name,
        })),
        customerPayments: history.rows.map(toPayment),
      };
    },

    async issueRefund({ paymentId, amountCents, reason, actorId }) {
      // The payment row is taken first and on its own, so a second refund arriving at
      // the same payment waits here. The balance is then read in a later statement,
      // which under read committed sees whatever the refund ahead of it committed —
      // reading both at once would let the waiter act on the snapshot it queued with
      // and hand two agents the same headroom.
      const locked = await client.query<{ id: string; reference: string; amount_cents: string }>(
        "select id, reference, amount_cents from payments where id = $1 for update",
        [paymentId],
      );
      const row = locked.rows[0];
      if (!row) throw new NotFoundError(`unknown payment: ${paymentId}`);

      const drawn = await client.query<{ refunded_cents: string }>(
        `select coalesce(sum(amount_cents), 0) as refunded_cents from refunds
          where payment_id = $1 and status = 'issued'`,
        [paymentId],
      );
      const remaining = Number(row.amount_cents) - Number(drawn.rows[0]?.refunded_cents ?? 0);
      if (amountCents > remaining) {
        throw new StaleRevisionError(
          remaining <= 0
            ? `${row.reference} is already refunded in full`
            : `only ${dollars(remaining)} of ${row.reference} is left to refund`,
        );
      }

      await client.query(
        `insert into refunds
           (id, payment_id, amount_cents, reason, status, requested_by, invocation_id, capability)
         values ($1, $2, $3, $4, 'issued', $5, $6, $7)`,
        [
          `ref_${invocationId.slice(0, 12)}`,
          paymentId,
          amountCents,
          reason,
          actorId,
          invocationId,
          capability,
        ],
      );

      const updated = await api.getPayment(paymentId);
      if (!updated) throw new NotFoundError(`unknown payment: ${paymentId}`);
      return updated;
    },
  };

  return api;
}
