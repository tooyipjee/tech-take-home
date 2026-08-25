-- Business data owned by the platform (system of record for this demo).
--
-- One product lives here: the KYC review queue. `kyc_cases` and its child tables are
-- the record being reviewed; the four *effect* tables at the bottom are where the
-- capabilities' writes land, one row per audited invocation.

create table if not exists kyc_cases (
  id                          text primary key,
  reference                   text not null unique,
  applicant_name              text not null,
  country                     text not null,
  status                      text not null check (status in
                                ('pending_review', 'info_requested', 'escalated',
                                 'awaiting_approval', 'approved', 'rejected')),
  risk_band                   text not null check (risk_band in ('low', 'medium', 'high')),
  risk_score                  integer not null check (risk_score between 0 and 100),
  submitted_at                timestamptz not null,
  sla_due_at                  timestamptz not null,
  assigned_to                 text references platform_users(id),
  -- Bumped by every write that changes the case, so a reviewer deciding on a stale
  -- screen is refused rather than silently overwriting someone else's work.
  revision                    integer not null default 1 check (revision > 0),
  product_tier                text not null,
  expected_monthly_volume_usd bigint not null check (expected_monthly_volume_usd >= 0),
  -- Applicant PII. Reads of these columns go through kyc.case.pii.reveal, which is a
  -- write capability so the disclosure is metered and audited like any other effect.
  full_name                   text not null,
  email                       text not null,
  date_of_birth               date not null,
  national_id                 text not null,
  address                     text not null,
  created_at                  timestamptz not null default now()
);

create table if not exists kyc_documents (
  id           text primary key,
  case_id      text not null references kyc_cases(id),
  type         text not null check (type in
                 ('passport', 'drivers_license', 'proof_of_address', 'source_of_funds')),
  uploaded_at  timestamptz not null,
  verification text not null check (verification in ('passed', 'failed', 'manual_review')),
  note         text
);

create index if not exists kyc_documents_case_idx on kyc_documents (case_id);

create table if not exists kyc_screening_hits (
  id             text primary key,
  case_id        text not null references kyc_cases(id),
  provider       text not null,
  list           text not null check (list in
                   ('OFAC_SDN', 'EU_CONSOLIDATED', 'UK_HMT', 'PEP', 'ADVERSE_MEDIA')),
  matched_name   text not null,
  match_strength numeric(3, 2) not null check (match_strength between 0 and 1),
  resolution     text not null check (resolution in ('unresolved', 'false_positive', 'confirmed'))
);

create index if not exists kyc_screening_hits_case_idx on kyc_screening_hits (case_id);

create table if not exists kyc_risk_signals (
  id      bigserial primary key,
  case_id text not null references kyc_cases(id),
  label   text not null,
  points  integer not null,
  detail  text not null
);

create index if not exists kyc_risk_signals_case_idx on kyc_risk_signals (case_id);

-- Effects. Every row in these tables is one audited invocation's doing: the columns
-- `invocation_id` and `capability` are stamped by the data layer, not by a handler,
-- and 0003 makes them mandatory and immutable.

create table if not exists kyc_case_events (
  id            bigserial primary key,
  case_id       text not null references kyc_cases(id),
  at            timestamptz not null default now(),
  actor_id      text not null references platform_users(id),
  summary       text not null
);

create index if not exists kyc_case_events_case_idx on kyc_case_events (case_id, at);

create table if not exists kyc_case_decisions (
  id          text primary key,
  case_id     text not null references kyc_cases(id),
  decision    text not null check (decision in ('approved', 'rejected')),
  reason_code text,
  note        text not null,
  decided_by  text not null references platform_users(id),
  at          timestamptz not null default now()
);

-- A case is onboarded or declined once. The invariant derived from
-- `effect.oncePerSubject` says the same thing; this is the layer that cannot be
-- talked out of it.
create unique index if not exists kyc_case_decisions_one_per_case on kyc_case_decisions (case_id);

create table if not exists kyc_pii_disclosures (
  id            text primary key,
  case_id       text not null references kyc_cases(id),
  justification text not null,
  actor_id      text not null references platform_users(id),
  at            timestamptz not null default now()
);

create index if not exists kyc_pii_disclosures_case_idx on kyc_pii_disclosures (case_id, at);

create table if not exists kyc_sars (
  id        text primary key,
  case_id   text not null references kyc_cases(id),
  narrative text not null,
  filed_by  text not null references platform_users(id),
  at        timestamptz not null default now()
);

-- There is no unfile capability, and a second SAR on the same case would be a second
-- filing to the regulator.
create unique index if not exists kyc_sars_one_per_case on kyc_sars (case_id);
