-- Invariants enforced by the database itself.
--
-- Everything here holds even if the kernel has a bug, a migration is run by
-- hand, or someone reaches the database with psql. These are the statements the
-- platform is allowed to assume are true; nothing above this layer can weaken
-- them without a migration, which is a tier-2 change.

-- 1. Every invocation the runtime performs is identified, and the identifier is
--    unique, so an effect can be tied to exactly one audited invocation.
alter table audit_log add column if not exists invocation_id uuid;

create unique index if not exists audit_log_invocation_id_key on audit_log (invocation_id);

-- 2. Money-moving rows must name the invocation that produced them. The foreign
--    key is deferred because the runtime writes the effect before the audit row,
--    inside one transaction: at commit time both exist or neither does. A refund
--    that nobody audited cannot be committed.
alter table refunds add column if not exists invocation_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'refunds_invocation_fk') then
    alter table refunds
      add constraint refunds_invocation_fk
      foreign key (invocation_id) references audit_log (invocation_id)
      deferrable initially deferred;
  end if;
end $$;

create or replace function require_invocation_id() returns trigger as $$
begin
  if new.invocation_id is null then
    raise exception 'invariant violation: % rows must be written by an audited invocation', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end $$ language plpgsql;

drop trigger if exists refunds_require_invocation on refunds;
create trigger refunds_require_invocation
  before insert on refunds
  for each row execute function require_invocation_id();

-- 3. The audit log is append-only and effects are immutable. History cannot be
--    rewritten to make a violation disappear.
create or replace function reject_mutation() returns trigger as $$
begin
  raise exception 'invariant violation: % is append-only (attempted %)', tg_table_name, tg_op
    using errcode = 'check_violation';
end $$ language plpgsql;

drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_mutation();

drop trigger if exists refunds_immutable on refunds;
create trigger refunds_immutable
  before update or delete on refunds
  for each row execute function reject_mutation();

-- 4. Refunds can never exceed the payment they refund. Enforced per statement so
--    it holds for concurrent transactions too: the row is locked before the sum
--    is taken.
create or replace function enforce_refund_conservation() returns trigger as $$
declare
  payment_amount bigint;
  refunded bigint;
begin
  select amount_cents into payment_amount from payments where id = new.payment_id for update;
  if payment_amount is null then
    raise exception 'invariant violation: refund references unknown payment %', new.payment_id
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_cents), 0) into refunded
    from refunds where payment_id = new.payment_id and status = 'issued';

  if refunded > payment_amount then
    raise exception
      'invariant violation: refunds on % total % which exceeds the payment amount %',
      new.payment_id, refunded, payment_amount
      using errcode = 'check_violation';
  end if;
  return null;
end $$ language plpgsql;

drop trigger if exists refunds_conservation on refunds;
create constraint trigger refunds_conservation
  after insert on refunds
  deferrable initially immediate
  for each row execute function enforce_refund_conservation();

-- 5. Reconciliation state. Invariants are re-checked continuously; a violated invariant
--    halts the capabilities it guards until a human clears it.
create table if not exists invariant_runs (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  invariant_id    text not null,
  violations  integer not null,
  detail      text,
  duration_ms integer not null
);

create index if not exists invariant_runs_invariant_at_idx on invariant_runs (invariant_id, at desc);

create table if not exists capability_halts (
  id          bigserial primary key,
  capability  text not null,
  invariant_id    text not null,
  detail      text not null,
  halted_at   timestamptz not null default now(),
  cleared_at  timestamptz,
  cleared_by  text references platform_users(id)
);

-- A capability has at most one active halt, so clearing is unambiguous.
create unique index if not exists capability_halts_active_key
  on capability_halts (capability) where cleared_at is null;
