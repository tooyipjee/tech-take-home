-- Refunds: a second product on the platform, and the first one that moves money.
--
-- `payments` is the record being acted on — settled card payments the platform did not
-- create and no capability writes to. `refunds` is the effect table: one row per audited
-- invocation, and the payments team's record of intent. Nothing here talks to a card
-- processor; the row *is* the instruction, which is why it has to be attributable.
--
-- Additive: no existing table, trigger or constraint is touched.

create table if not exists payments (
  id            text primary key,
  reference     text not null unique,
  customer_id   text not null,
  customer_name text not null,
  customer_email text not null,
  -- The pool a refund draws down. Positive, so an empty pool cannot be arranged by
  -- seeding a zero or negative payment.
  amount_cents  bigint not null check (amount_cents > 0),
  currency      text not null check (currency = 'USD'),
  instrument    text not null,
  descriptor    text not null,
  status        text not null check (status in ('settled', 'disputed')),
  captured_at   timestamptz not null,
  created_at    timestamptz not null default now()
);

create index if not exists payments_customer_idx on payments (customer_id, captured_at desc);

-- The effect. `invocation_id` and `capability` are added below by the same loop 0003
-- uses, so a refund row that no audited invocation produced cannot be committed.
create table if not exists refunds (
  id           text primary key,
  payment_id   text not null references payments(id),
  amount_cents bigint not null check (amount_cents > 0),
  reason       text not null,
  -- There is no capability that voids a refund yet; the column exists because the
  -- declaration names it as what makes a row live, and the invariants that draw the
  -- pool down count only live rows.
  status       text not null check (status in ('issued')),
  requested_by text not null references platform_users(id),
  at           timestamptz not null default now()
);

create index if not exists refunds_payment_idx on refunds (payment_id, at);

-- Attribution and immutability, exactly as 0003 applies them to the KYC effect tables:
-- named explicitly, so adding an effect table stays a reviewed act.
do $$
declare
  effect_table text;
begin
  foreach effect_table in array array['refunds']
  loop
    execute format('alter table %I add column if not exists invocation_id uuid', effect_table);
    execute format('alter table %I add column if not exists capability text', effect_table);

    if not exists (select 1 from pg_constraint where conname = effect_table || '_invocation_fk') then
      execute format(
        'alter table %I add constraint %I foreign key (invocation_id)
           references audit_log (invocation_id) deferrable initially deferred',
        effect_table, effect_table || '_invocation_fk');
    end if;

    execute format('drop trigger if exists %I on %I',
                   effect_table || '_require_invocation', effect_table);
    execute format(
      'create trigger %I before insert on %I
         for each row execute function require_invocation_id()',
      effect_table || '_require_invocation', effect_table);

    execute format('drop trigger if exists %I on %I', effect_table || '_immutable', effect_table);
    execute format(
      'create trigger %I before update or delete on %I
         for each row execute function reject_mutation()',
      effect_table || '_immutable', effect_table);
  end loop;
end $$;

-- Conservation, and the ceiling, in the database.
--
-- Two statements, both of which the runtime also enforces before the fact and the
-- derived invariants re-prove after it. They are here because they are the two that
-- would be catastrophic to get wrong, and because psql is a way into this table:
--
--   1. The refunds issued against a payment never total more than the payment. The
--      payment row is locked first, so two concurrent partial refunds that are each
--      within the remaining balance cannot both commit past it.
--   2. No refund exceeds the ceiling its capability declares. The number is read from
--      `capability_registry` — written from the declaration at boot — rather than
--      copied here, so the ceiling cannot drift from the one that was reviewed.
create or replace function enforce_refund_conservation() returns trigger as $$
declare
  pool     bigint;
  drawn    bigint;
  declared bigint;
begin
  select amount_cents into pool from payments where id = new.payment_id for update;
  if not found then
    raise exception 'invariant violation: refund references unknown payment %', new.payment_id
      using errcode = 'check_violation';
  end if;

  select coalesce(sum(amount_cents), 0) into drawn
    from refunds where payment_id = new.payment_id and status = 'issued';

  if drawn > pool then
    raise exception 'invariant violation: refunds against payment % total %, above the payment amount %',
      new.payment_id, drawn, pool using errcode = 'check_violation';
  end if;

  select (policy->'limits'->>'maxAmountCents')::bigint into declared
    from capability_registry where name = new.capability;

  if declared is not null and new.amount_cents > declared then
    raise exception 'invariant violation: refund of % exceeds the ceiling % declares (%)',
      new.amount_cents, new.capability, declared using errcode = 'check_violation';
  end if;

  return null;
end $$ language plpgsql;

drop trigger if exists refunds_conservation on refunds;
create constraint trigger refunds_conservation
  after insert on refunds
  deferrable initially immediate
  for each row execute function enforce_refund_conservation();
