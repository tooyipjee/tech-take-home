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
  -- The scope the decider must hold, resolved from the capability's declaration (and,
  -- for a data-derived rule, from the record) at the moment the request was raised.
  -- Stored rather than re-derived so the approval is judged by the rule in force then.
  approver_scope  text not null,
  decided_by      text references platform_users(id),
  decided_at      timestamptz,
  idempotency_key text not null,
  created_at      timestamptz not null default now()
);

-- Role → scope, written from the kernel's own map at boot. It is here so that an
-- invariant can ask in SQL whether the person who decided an approval actually held
-- the scope it required, instead of trusting that the runtime checked.
create table if not exists role_scopes (
  role  text not null,
  scope text not null,
  primary key (role, scope)
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
