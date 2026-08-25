import { withClient } from "./pool.ts";

const users = [
  // Names are names: the role is a separate field, and every surface that needs to
  // show it reads it from there rather than from a string a human typed.
  { id: "u_agent", email: "avery@fin.example", name: "Avery Nolan", role: "agent" },
  { id: "u_supervisor", email: "sam@fin.example", name: "Sam Okafor", role: "supervisor" },
  { id: "u_admin", email: "robin@fin.example", name: "Robin Vale", role: "admin" },
  // Four-eyes needs two holders of every approver scope, or an approval only one
  // person can raise is an approval nobody can decide.
  { id: "u_admin_2", email: "dana@fin.example", name: "Dana Whitfield", role: "admin" },
];

interface SeedCase {
  id: string;
  reference: string;
  applicantName: string;
  country: string;
  status: string;
  riskBand: string;
  riskScore: number;
  submittedHoursAgo: number;
  slaInHours: number;
  assignedTo: string | null;
  productTier: string;
  volume: number;
  fullName: string;
  email: string;
  dateOfBirth: string;
  nationalId: string;
  address: string;
  documents: { id: string; type: string; verification: string; note?: string }[];
  hits: {
    id: string;
    provider: string;
    list: string;
    matchedName: string;
    strength: number;
    resolution: string;
  }[];
  signals: { label: string; points: number; detail: string }[];
}

/**
 * Six onboarding cases spanning the decisions the queue exists to make: a clean one that
 * needs nobody, a weak adverse-media hit, an unresolved PEP, a case waiting on documents,
 * a strong sanctions match that only compliance can decide, and a low-risk case already
 * being worked. No case is seeded in a terminal state: a decision is an effect, and an
 * effect with no audited invocation behind it is exactly what the invariants forbid.
 */
const cases: SeedCase[] = [
  {
    id: "case_1041",
    reference: "KYC-1041",
    applicantName: "Marcus Delgado",
    country: "US",
    status: "pending_review",
    riskBand: "low",
    riskScore: 22,
    submittedHoursAgo: 5,
    slaInHours: 19,
    assignedTo: null,
    productTier: "Business Checking",
    volume: 18_000,
    fullName: "Marcus Delgado",
    email: "marcus.delgado@northlinehvac.com",
    dateOfBirth: "1986-03-14",
    nationalId: "431-88-4821",
    address: "2140 Rockwell Ave, Cleveland, OH 44113",
    documents: [
      { id: "doc_1", type: "passport", verification: "passed" },
      { id: "doc_2", type: "proof_of_address", verification: "passed" },
    ],
    hits: [],
    signals: [
      { label: "Device reputation", points: 4, detail: "Known-good device, no VPN" },
      { label: "Business age", points: 8, detail: "Registered 6 years ago in OH" },
      { label: "Expected volume", points: 10, detail: "$18k/mo is typical for segment" },
    ],
  },
  {
    id: "case_1042",
    reference: "KYC-1042",
    applicantName: "Ana Sofía Ferreira",
    country: "PT",
    status: "pending_review",
    riskBand: "medium",
    riskScore: 48,
    submittedHoursAgo: 22,
    slaInHours: 2,
    assignedTo: null,
    productTier: "Cross-border Payouts",
    volume: 140_000,
    fullName: "Ana Sofía Ferreira",
    email: "a.ferreira@vialusa.pt",
    dateOfBirth: "1979-11-02",
    nationalId: "PT-90114-7733",
    address: "Rua do Almada 214, 4050-032 Porto",
    documents: [
      { id: "doc_3", type: "passport", verification: "passed" },
      {
        id: "doc_4",
        type: "source_of_funds",
        verification: "manual_review",
        note: "Bank statements in Portuguese; totals reconcile",
      },
    ],
    hits: [
      {
        id: "hit_1",
        provider: "ComplyAdvantage",
        list: "ADVERSE_MEDIA",
        matchedName: "Ana S. Ferreira",
        strength: 0.61,
        resolution: "unresolved",
      },
    ],
    signals: [
      { label: "Cross-border corridor", points: 18, detail: "PT → BR payouts" },
      { label: "Expected volume", points: 20, detail: "$140k/mo, above segment median" },
      { label: "Adverse media", points: 10, detail: "Weak name match, 2019 article" },
    ],
  },
  {
    id: "case_1043",
    reference: "KYC-1043",
    applicantName: "Viktor Osei",
    country: "AE",
    status: "pending_review",
    riskBand: "high",
    riskScore: 81,
    submittedHoursAgo: 30,
    slaInHours: -6,
    assignedTo: null,
    productTier: "Treasury",
    volume: 900_000,
    fullName: "Viktor Osei",
    email: "v.osei@meridiantrade.ae",
    dateOfBirth: "1974-06-19",
    nationalId: "AE-7741-20993",
    address: "Office 1204, Burj Al Salam, Sheikh Zayed Rd, Dubai",
    documents: [
      { id: "doc_5", type: "passport", verification: "passed" },
      {
        id: "doc_6",
        type: "source_of_funds",
        verification: "manual_review",
        note: "Trade invoices from three unrelated counterparties",
      },
      {
        id: "doc_7",
        type: "proof_of_address",
        verification: "failed",
        note: "Utility bill older than 90 days",
      },
    ],
    hits: [
      {
        id: "hit_2",
        provider: "Dow Jones",
        list: "PEP",
        matchedName: "Viktor Osei",
        strength: 0.88,
        resolution: "unresolved",
      },
    ],
    signals: [
      { label: "PEP association", points: 30, detail: "Close associate of a regional official" },
      { label: "Expected volume", points: 26, detail: "$900k/mo treasury flows" },
      { label: "Document quality", points: 15, detail: "Proof of address failed verification" },
      { label: "Corridor risk", points: 10, detail: "AE → multiple high-risk jurisdictions" },
    ],
  },
  {
    id: "case_1044",
    reference: "KYC-1044",
    applicantName: "Lena Vogt",
    country: "DE",
    status: "info_requested",
    riskBand: "medium",
    riskScore: 44,
    submittedHoursAgo: 50,
    slaInHours: 26,
    assignedTo: "u_agent",
    productTier: "Business Checking",
    volume: 62_000,
    fullName: "Lena Vogt",
    email: "lena@vogtdesign.de",
    dateOfBirth: "1991-01-27",
    nationalId: "DE-5521-88410",
    address: "Kastanienallee 12, 10435 Berlin",
    documents: [{ id: "doc_8", type: "drivers_license", verification: "passed" }],
    hits: [],
    signals: [
      { label: "Missing documents", points: 22, detail: "No proof of address on file" },
      { label: "Expected volume", points: 12, detail: "$62k/mo" },
    ],
  },
  {
    id: "case_1045",
    reference: "KYC-1045",
    applicantName: "Ibrahim Nasser",
    country: "LB",
    status: "pending_review",
    riskBand: "high",
    riskScore: 93,
    submittedHoursAgo: 12,
    slaInHours: 12,
    assignedTo: null,
    productTier: "Cross-border Payouts",
    volume: 310_000,
    fullName: "Ibrahim Nasser",
    email: "i.nasser@levantexport.lb",
    dateOfBirth: "1968-09-08",
    nationalId: "LB-3390-11284",
    address: "Rue Verdun 44, Beirut",
    documents: [{ id: "doc_9", type: "passport", verification: "passed" }],
    hits: [
      {
        id: "hit_3",
        provider: "Refinitiv",
        list: "OFAC_SDN",
        matchedName: "Ibrahim Nassr",
        strength: 0.94,
        resolution: "unresolved",
      },
      {
        id: "hit_4",
        provider: "Refinitiv",
        list: "EU_CONSOLIDATED",
        matchedName: "I. Nasser",
        strength: 0.77,
        resolution: "unresolved",
      },
    ],
    signals: [
      { label: "Sanctions match", points: 50, detail: "Strong OFAC SDN name + DOB match" },
      { label: "Jurisdiction", points: 25, detail: "FATF increased-monitoring jurisdiction" },
      { label: "Expected volume", points: 18, detail: "$310k/mo" },
    ],
  },
  {
    id: "case_1046",
    reference: "KYC-1046",
    applicantName: "Grace Lindqvist",
    country: "SE",
    status: "pending_review",
    riskBand: "low",
    riskScore: 16,
    submittedHoursAgo: 72,
    slaInHours: -48,
    assignedTo: "u_supervisor",
    productTier: "Business Checking",
    volume: 9_500,
    fullName: "Grace Lindqvist",
    email: "grace@lindqvistceramics.se",
    dateOfBirth: "1994-04-30",
    nationalId: "SE-19940430-2214",
    address: "Sveavägen 88, 113 59 Stockholm",
    documents: [
      { id: "doc_10", type: "passport", verification: "passed" },
      { id: "doc_11", type: "proof_of_address", verification: "passed" },
    ],
    hits: [],
    signals: [{ label: "Low volume domestic", points: 6, detail: "Sole trader, SEK domestic only" }],
  },
];

interface SeedPayment {
  id: string;
  reference: string;
  customerId: string;
  customerName: string;
  customerEmail: string;
  amountCents: number;
  instrument: string;
  descriptor: string;
  status: string;
  capturedHoursAgo: number;
}

/**
 * Settled payments for the refunds desk, chosen so every branch of the refund policy
 * is reachable from the seed: amounts an agent can refund alone, amounts that must wait
 * for a supervisor, and amounts no approver can get past the ceiling. Two customers have
 * several payments so a history is worth reading before refunding.
 *
 * No refund is seeded: a refund is an effect, and an effect with no audited invocation
 * behind it is exactly what the invariants forbid.
 */
const payments: SeedPayment[] = [
  {
    id: "pay_5001",
    reference: "PAY-5001",
    customerId: "cus_hollis",
    customerName: "Priya Raman",
    customerEmail: "priya.raman@hollisandco.com",
    amountCents: 12_400,
    instrument: "Visa •••• 4242",
    descriptor: "Annual plan — Hollis & Co",
    status: "settled",
    capturedHoursAgo: 30,
  },
  {
    id: "pay_5002",
    reference: "PAY-5002",
    customerId: "cus_hollis",
    customerName: "Priya Raman",
    customerEmail: "priya.raman@hollisandco.com",
    amountCents: 48_000,
    instrument: "Visa •••• 4242",
    descriptor: "Seat upgrade (12) — Hollis & Co",
    status: "settled",
    capturedHoursAgo: 8,
  },
  {
    id: "pay_5003",
    reference: "PAY-5003",
    customerId: "cus_northline",
    customerName: "Marcus Delgado",
    customerEmail: "marcus.delgado@northlinehvac.com",
    amountCents: 96_500,
    instrument: "Mastercard •••• 8813",
    descriptor: "Hardware bundle — Northline HVAC",
    status: "settled",
    capturedHoursAgo: 52,
  },
  {
    id: "pay_5004",
    reference: "PAY-5004",
    customerId: "cus_northline",
    customerName: "Marcus Delgado",
    customerEmail: "marcus.delgado@northlinehvac.com",
    amountCents: 24_000,
    instrument: "Mastercard •••• 8813",
    descriptor: "Onboarding fee — Northline HVAC",
    status: "disputed",
    capturedHoursAgo: 96,
  },
  {
    id: "pay_5005",
    reference: "PAY-5005",
    customerId: "cus_vialusa",
    customerName: "Ana Sofía Ferreira",
    customerEmail: "a.ferreira@vialusa.pt",
    amountCents: 185_000,
    instrument: "Amex •••• 1009",
    descriptor: "Enterprise licence — Vialusa",
    status: "settled",
    capturedHoursAgo: 14,
  },
  {
    // Above the ceiling in full, so the refusal that no approver can override is one
    // click away in a demo.
    id: "pay_5006",
    reference: "PAY-5006",
    customerId: "cus_brightside",
    customerName: "Dominic Osei",
    customerEmail: "dominic@brightsidelabs.io",
    amountCents: 341_000,
    instrument: "Visa •••• 6677",
    descriptor: "Implementation services — Brightside Labs",
    status: "settled",
    capturedHoursAgo: 20,
  },
  {
    id: "pay_5007",
    reference: "PAY-5007",
    customerId: "cus_brightside",
    customerName: "Dominic Osei",
    customerEmail: "dominic@brightsidelabs.io",
    amountCents: 7_900,
    instrument: "Visa •••• 6677",
    descriptor: "Overage — Brightside Labs",
    status: "settled",
    capturedHoursAgo: 3,
  },
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

    for (const item of cases) {
      await client.query(
        `insert into kyc_cases
           (id, reference, applicant_name, country, status, risk_band, risk_score,
            submitted_at, sla_due_at, assigned_to, product_tier, expected_monthly_volume_usd,
            full_name, email, date_of_birth, national_id, address)
         values ($1, $2, $3, $4, $5, $6, $7,
                 now() - ($8 || ' hours')::interval, now() + ($9 || ' hours')::interval, $10, $11, $12,
                 $13, $14, $15, $16, $17)
         on conflict (id) do nothing`,
        [
          item.id,
          item.reference,
          item.applicantName,
          item.country,
          item.status,
          item.riskBand,
          item.riskScore,
          String(item.submittedHoursAgo),
          String(item.slaInHours),
          item.assignedTo,
          item.productTier,
          item.volume,
          item.fullName,
          item.email,
          item.dateOfBirth,
          item.nationalId,
          item.address,
        ],
      );

      for (const doc of item.documents) {
        await client.query(
          `insert into kyc_documents (id, case_id, type, uploaded_at, verification, note)
           values ($1, $2, $3, now() - ($4 || ' hours')::interval, $5, $6)
           on conflict (id) do nothing`,
          [doc.id, item.id, doc.type, String(item.submittedHoursAgo), doc.verification, doc.note ?? null],
        );
      }

      for (const hit of item.hits) {
        await client.query(
          `insert into kyc_screening_hits
             (id, case_id, provider, list, matched_name, match_strength, resolution)
           values ($1, $2, $3, $4, $5, $6, $7) on conflict (id) do nothing`,
          [hit.id, item.id, hit.provider, hit.list, hit.matchedName, hit.strength, hit.resolution],
        );
      }

      for (const signal of item.signals) {
        await client.query(
          `insert into kyc_risk_signals (case_id, label, points, detail)
           select $1, $2, $3, $4
            where not exists (select 1 from kyc_risk_signals
                               where case_id = $1 and label = $2)`,
          [item.id, signal.label, signal.points, signal.detail],
        );
      }
    }

    for (const payment of payments) {
      await client.query(
        `insert into payments
           (id, reference, customer_id, customer_name, customer_email, amount_cents,
            currency, instrument, descriptor, status, captured_at)
         values ($1, $2, $3, $4, $5, $6, 'USD', $7, $8, $9,
                 now() - ($10 || ' hours')::interval)
         on conflict (id) do nothing`,
        [
          payment.id,
          payment.reference,
          payment.customerId,
          payment.customerName,
          payment.customerEmail,
          payment.amountCents,
          payment.instrument,
          payment.descriptor,
          payment.status,
          String(payment.capturedHoursAgo),
        ],
      );
    }
  });
}

/** Truncates transactional state and re-seeds. Reference data survives. */
export async function resetAndSeed(): Promise<void> {
  await withClient(async (client) => {
    // Effect tables are append-only by trigger; truncate is DDL, so a reset is a
    // deliberate administrative act rather than something a capability could do.
    await client.query(
      `truncate audit_log, approvals, idempotency_keys,
                kyc_case_events, kyc_case_decisions, kyc_pii_disclosures, kyc_sars,
                kyc_documents, kyc_screening_hits, kyc_risk_signals, kyc_cases,
                refunds, payments,
                capability_halts, invariant_runs
       restart identity cascade`,
    );
  });
  await seed();
}
