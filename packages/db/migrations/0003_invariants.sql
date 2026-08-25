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

-- 2. Effect rows must name the invocation that produced them and the capability
--    that was invoked. The foreign key is deferred because the runtime writes the
--    effect before the audit row, inside one transaction: at commit time both exist
--    or neither does. An effect nobody audited cannot be committed.
--
--    Applied to every effect table by name, so adding one is a deliberate, reviewed
--    act rather than something a handler can arrange for itself.
create or replace function require_invocation_id() returns trigger as $$
begin
  if new.invocation_id is null or new.capability is null then
    raise exception 'invariant violation: % rows must be written by an audited invocation', tg_table_name
      using errcode = 'check_violation';
  end if;
  return new;
end $$ language plpgsql;

create or replace function reject_mutation() returns trigger as $$
begin
  raise exception 'invariant violation: % is append-only (attempted %)', tg_table_name, tg_op
    using errcode = 'check_violation';
end $$ language plpgsql;

do $$
declare
  effect_table text;
begin
  foreach effect_table in array array['kyc_case_events', 'kyc_case_decisions',
                                      'kyc_pii_disclosures', 'kyc_sars']
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

    -- 3. Effects are immutable: a decision, a disclosure or a SAR cannot be edited
    --    or deleted afterwards to make a violation disappear.
    execute format('drop trigger if exists %I on %I', effect_table || '_immutable', effect_table);
    execute format(
      'create trigger %I before update or delete on %I
         for each row execute function reject_mutation()',
      effect_table || '_immutable', effect_table);
  end loop;
end $$;

-- The audit log is append-only for the same reason, and it is the one table whose
-- immutability every other guarantee rests on.
drop trigger if exists audit_log_append_only on audit_log;
create trigger audit_log_append_only
  before update or delete on audit_log
  for each row execute function reject_mutation();

-- 4. A case reaches a terminal state once. Enforced per statement so it holds for
--    concurrent transactions too: the case row is locked before the decisions are
--    counted, which the unique index alone would not do for the SAR/decision pair.
create or replace function enforce_single_terminal_decision() returns trigger as $$
declare
  decided integer;
begin
  perform 1 from kyc_cases where id = new.case_id for update;
  if not found then
    raise exception 'invariant violation: decision references unknown case %', new.case_id
      using errcode = 'check_violation';
  end if;

  select count(*) into decided from kyc_case_decisions where case_id = new.case_id;
  if decided > 1 then
    raise exception 'invariant violation: case % already has a terminal decision', new.case_id
      using errcode = 'check_violation';
  end if;
  return null;
end $$ language plpgsql;

drop trigger if exists kyc_case_decisions_single on kyc_case_decisions;
create constraint trigger kyc_case_decisions_single
  after insert on kyc_case_decisions
  deferrable initially immediate
  for each row execute function enforce_single_terminal_decision();

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
