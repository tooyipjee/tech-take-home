-- Business data owned by the platform (system of record for this demo).

create table if not exists customers (
  id         text primary key,
  name       text not null,
  email      text not null,
  risk_tier  text not null check (risk_tier in ('low', 'medium', 'high'))
);

create table if not exists payments (
  id           text primary key,
  customer_id  text not null references customers(id),
  amount_cents bigint not null check (amount_cents > 0),
  currency     text not null default 'USD',
  status       text not null check (status in ('settled', 'refunded', 'partially_refunded', 'disputed')),
  description  text not null,
  created_at   timestamptz not null default now()
);

create table if not exists refunds (
  id           text primary key,
  payment_id   text not null references payments(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason       text not null,
  status       text not null check (status in ('issued', 'failed')),
  issued_by    text not null references platform_users(id),
  created_at   timestamptz not null default now()
);

create index if not exists refunds_payment_idx on refunds (payment_id);

create table if not exists feature_flags (
  key          text primary key,
  description  text not null,
  enabled      boolean not null default false,
  rollout_pct  integer not null default 0 check (rollout_pct between 0 and 100),
  updated_by   text references platform_users(id),
  updated_at   timestamptz not null default now()
);

create table if not exists review_queue_items (
  id            text primary key,
  customer_id   text not null references customers(id),
  payment_id    text references payments(id),
  kind          text not null,
  status        text not null check (status in ('open', 'resolved')),
  note          text not null,
  created_at    timestamptz not null default now()
);
