import { withClient } from "./pool.ts";

const users = [
  { id: "u_agent", email: "avery@fin.example", name: "Avery (Support Agent)", role: "agent" },
  { id: "u_supervisor", email: "sam@fin.example", name: "Sam (Supervisor)", role: "supervisor" },
  { id: "u_admin", email: "robin@fin.example", name: "Robin (Platform Admin)", role: "admin" },
];

const customers = [
  { id: "cus_1001", name: "Nadia Okafor", email: "nadia@example.com", risk: "low" },
  { id: "cus_1002", name: "Marco Silva", email: "marco@example.com", risk: "medium" },
  { id: "cus_1003", name: "Priya Raman", email: "priya@example.com", risk: "low" },
  { id: "cus_1004", name: "Tom Becker", email: "tom@example.com", risk: "high" },
];

const payments = [
  { id: "pay_2001", cus: "cus_1001", amount: 4200, desc: "Pro plan - monthly" },
  { id: "pay_2002", cus: "cus_1002", amount: 18900, desc: "Hardware terminal" },
  { id: "pay_2003", cus: "cus_1003", amount: 75000, desc: "Annual plan - Team" },
  { id: "pay_2004", cus: "cus_1004", amount: 250000, desc: "Enterprise onboarding fee" },
  { id: "pay_2005", cus: "cus_1002", amount: 9900, desc: "Overage charges" },
];

const flags = [
  { key: "refunds.instant_payout", description: "Push refunds to instant rails", enabled: false, pct: 0 },
  { key: "console.bulk_actions", description: "Bulk actions in review queues", enabled: true, pct: 100 },
  { key: "risk.new_scoring_model", description: "v2 risk scoring for disputes", enabled: false, pct: 25 },
];

const reviewItems = [
  { id: "rq_1", cus: "cus_1004", pay: "pay_2004", kind: "kyc_mismatch", note: "Document name does not match account holder" },
  { id: "rq_2", cus: "cus_1002", pay: "pay_2002", kind: "chargeback_risk", note: "Customer disputed a similar charge last month" },
  { id: "rq_3", cus: "cus_1001", pay: null, kind: "manual_review", note: "Requested account closure with balance outstanding" },
];

export async function seed(): Promise<void> {
  await withClient(async (client) => {
    for (const user of users) {
      await client.query(
        `insert into platform_users (id, email, name, role) values ($1, $2, $3, $4)
         on conflict (id) do update set email = excluded.email, name = excluded.name, role = excluded.role`,
        [user.id, user.email, user.name, user.role],
      );
    }
    for (const customer of customers) {
      await client.query(
        `insert into customers (id, name, email, risk_tier) values ($1, $2, $3, $4)
         on conflict (id) do nothing`,
        [customer.id, customer.name, customer.email, customer.risk],
      );
    }
    for (const payment of payments) {
      await client.query(
        `insert into payments (id, customer_id, amount_cents, currency, status, description)
         values ($1, $2, $3, 'USD', 'settled', $4)
         on conflict (id) do nothing`,
        [payment.id, payment.cus, payment.amount, payment.desc],
      );
    }
    for (const flag of flags) {
      await client.query(
        `insert into feature_flags (key, description, enabled, rollout_pct)
         values ($1, $2, $3, $4) on conflict (key) do nothing`,
        [flag.key, flag.description, flag.enabled, flag.pct],
      );
    }
    for (const item of reviewItems) {
      await client.query(
        `insert into review_queue_items (id, customer_id, payment_id, kind, status, note)
         values ($1, $2, $3, $4, 'open', $5) on conflict (id) do nothing`,
        [item.id, item.cus, item.pay, item.kind, item.note],
      );
    }
  });
}

/** Truncates transactional state and re-seeds. Reference data survives. */
export async function resetAndSeed(): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `truncate audit_log, approvals, idempotency_keys, refunds, review_queue_items,
                payments, feature_flags, customers, capability_halts, tenet_runs
       restart identity cascade`,
    );
  });
  await seed();
}
