import type { PgClient } from "./pool.ts";

export interface Payment {
  id: string;
  customerId: string;
  customerName: string;
  amountCents: number;
  refundedCents: number;
  currency: string;
  status: string;
  description: string;
  createdAt: string;
}

export interface Refund {
  id: string;
  paymentId: string;
  amountCents: number;
  reason: string;
  status: string;
  issuedBy: string;
  createdAt: string;
}

export interface FeatureFlag {
  key: string;
  description: string;
  enabled: boolean;
  rolloutPct: number;
  updatedBy: string | null;
  updatedAt: string;
}

export interface ReviewItem {
  id: string;
  customerId: string;
  customerName: string;
  paymentId: string | null;
  kind: string;
  status: string;
  note: string;
  createdAt: string;
}

/**
 * The only door capability handlers have to business data. Handlers never see a
 * pool or a raw connection: the runtime binds this to the transaction it opened,
 * so every effect lands in the same transaction as its audit record.
 */
export interface DataSource {
  listPayments(limit: number): Promise<Payment[]>;
  getPayment(id: string): Promise<Payment | null>;
  listRefundsForPayment(paymentId: string): Promise<Refund[]>;
  insertRefund(refund: {
    id: string;
    paymentId: string;
    amountCents: number;
    reason: string;
    issuedBy: string;
  }): Promise<Refund>;
  listFlags(): Promise<FeatureFlag[]>;
  setFlag(input: {
    key: string;
    enabled: boolean;
    rolloutPct: number;
    updatedBy: string;
  }): Promise<FeatureFlag>;
  listReviewQueue(status: string, limit: number): Promise<ReviewItem[]>;
  resolveReviewItem(id: string): Promise<ReviewItem | null>;
}

const paymentSelect = `
  select p.id,
         p.customer_id,
         c.name as customer_name,
         p.amount_cents,
         coalesce((select sum(r.amount_cents) from refunds r
                    where r.payment_id = p.id and r.status = 'issued'), 0) as refunded_cents,
         p.currency,
         p.status,
         p.description,
         p.created_at
    from payments p
    join customers c on c.id = p.customer_id
`;

type PaymentRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  amount_cents: string;
  refunded_cents: string;
  currency: string;
  status: string;
  description: string;
  created_at: Date;
};

function toPayment(row: PaymentRow): Payment {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    amountCents: Number(row.amount_cents),
    refundedCents: Number(row.refunded_cents),
    currency: row.currency,
    status: row.status,
    description: row.description,
    createdAt: row.created_at.toISOString(),
  };
}

type RefundRow = {
  id: string;
  payment_id: string;
  amount_cents: string;
  reason: string;
  status: string;
  issued_by: string;
  created_at: Date;
};

function toRefund(row: RefundRow): Refund {
  return {
    id: row.id,
    paymentId: row.payment_id,
    amountCents: Number(row.amount_cents),
    reason: row.reason,
    status: row.status,
    issuedBy: row.issued_by,
    createdAt: row.created_at.toISOString(),
  };
}

type FlagRow = {
  key: string;
  description: string;
  enabled: boolean;
  rollout_pct: number;
  updated_by: string | null;
  updated_at: Date;
};

function toFlag(row: FlagRow): FeatureFlag {
  return {
    key: row.key,
    description: row.description,
    enabled: row.enabled,
    rolloutPct: row.rollout_pct,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
  };
}

type ReviewRow = {
  id: string;
  customer_id: string;
  customer_name: string;
  payment_id: string | null;
  kind: string;
  status: string;
  note: string;
  created_at: Date;
};

function toReviewItem(row: ReviewRow): ReviewItem {
  return {
    id: row.id,
    customerId: row.customer_id,
    customerName: row.customer_name,
    paymentId: row.payment_id,
    kind: row.kind,
    status: row.status,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

/**
 * Bound to one transaction *and* one invocation: the invocation id is stamped
 * onto every effect by this layer, not by the capability handler, so a handler
 * cannot write a row that isn't attributable to an audited invocation.
 */
export function createDataSource(client: PgClient, invocationId: string): DataSource {
  return {
    async listPayments(limit) {
      const { rows } = await client.query<PaymentRow>(
        `${paymentSelect} order by p.created_at desc limit $1`,
        [limit],
      );
      return rows.map(toPayment);
    },

    async getPayment(id) {
      const { rows } = await client.query<PaymentRow>(`${paymentSelect} where p.id = $1`, [id]);
      const row = rows[0];
      return row ? toPayment(row) : null;
    },

    async listRefundsForPayment(paymentId) {
      const { rows } = await client.query<RefundRow>(
        "select * from refunds where payment_id = $1 order by created_at desc",
        [paymentId],
      );
      return rows.map(toRefund);
    },

    async insertRefund(refund) {
      const { rows } = await client.query<RefundRow>(
        `insert into refunds (id, payment_id, amount_cents, reason, status, issued_by, invocation_id)
         values ($1, $2, $3, $4, 'issued', $5, $6)
         returning *`,
        [refund.id, refund.paymentId, refund.amountCents, refund.reason, refund.issuedBy, invocationId],
      );
      await client.query(
        `update payments p
            set status = case
                           when coalesce((select sum(r.amount_cents) from refunds r
                                           where r.payment_id = p.id and r.status = 'issued'), 0) >= p.amount_cents
                           then 'refunded'
                           else 'partially_refunded'
                         end
          where p.id = $1`,
        [refund.paymentId],
      );
      return toRefund(rows[0]!);
    },

    async listFlags() {
      const { rows } = await client.query<FlagRow>("select * from feature_flags order by key");
      return rows.map(toFlag);
    },

    async setFlag(input) {
      const { rows } = await client.query<FlagRow>(
        `update feature_flags
            set enabled = $2, rollout_pct = $3, updated_by = $4, updated_at = now()
          where key = $1
          returning *`,
        [input.key, input.enabled, input.rolloutPct, input.updatedBy],
      );
      const row = rows[0];
      if (!row) throw new Error(`unknown feature flag: ${input.key}`);
      return toFlag(row);
    },

    async listReviewQueue(status, limit) {
      const { rows } = await client.query<ReviewRow>(
        `select q.id, q.customer_id, c.name as customer_name, q.payment_id, q.kind, q.status, q.note, q.created_at
           from review_queue_items q
           join customers c on c.id = q.customer_id
          where q.status = $1
          order by q.created_at asc
          limit $2`,
        [status, limit],
      );
      return rows.map(toReviewItem);
    },

    async resolveReviewItem(id) {
      const { rows } = await client.query<{ id: string }>(
        "update review_queue_items set status = 'resolved' where id = $1 returning id",
        [id],
      );
      if (!rows[0]) return null;
      const { rows: full } = await client.query<ReviewRow>(
        `select q.id, q.customer_id, c.name as customer_name, q.payment_id, q.kind, q.status, q.note, q.created_at
           from review_queue_items q join customers c on c.id = q.customer_id where q.id = $1`,
        [id],
      );
      return full[0] ? toReviewItem(full[0]) : null;
    },
  };
}
