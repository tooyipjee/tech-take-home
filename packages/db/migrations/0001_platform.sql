-- Platform state: identity, capability registry, audit, approvals, idempotency.

create table if not exists platform_users (
  id            text primary key,
  email         text not null unique,
  name          text not null,
  role          text not null check (role in ('agent', 'supervisor', 'admin'))
);

create table if not exists capability_registry (
  name          text primary key,
  kind          text not null check (kind in ('read', 'write')),
  scope         text not null,
  summary       text not null,
  policy        jsonb not null,
  registered_at timestamptz not null default now()
);

create table if not exists approvals (
  id              text primary key,
  capability      text not null,
  input           jsonb not null,
  amount_cents    bigint,
  reason          text not null,
  requested_by    text not null references platform_users(id),
  status          text not null check (status in ('pending', 'approved', 'rejected', 'executed', 'failed')),
  decided_by      text references platform_users(id),
  decided_at      timestamptz,
  idempotency_key text not null,
  created_at      timestamptz not null default now()
);

create table if not exists idempotency_keys (
  capability   text not null,
  key          text not null,
  actor_id     text not null,
  response     jsonb not null,
  created_at   timestamptz not null default now(),
  primary key (capability, key)
);

create table if not exists audit_log (
  id            bigserial primary key,
  at            timestamptz not null default now(),
  actor_id      text not null,
  actor_role    text not null,
  capability    text not null,
  kind          text not null,
  outcome       text not null,
  input         jsonb not null,
  result        jsonb,
  amount_cents  bigint,
  approval_id   text,
  idempotency_key text,
  error         text,
  duration_ms   integer not null
);

create index if not exists audit_log_actor_capability_at_idx
  on audit_log (actor_id, capability, at desc);
