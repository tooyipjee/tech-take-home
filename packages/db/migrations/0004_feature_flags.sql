-- Feature flags: product switches that can be turned on and off without a deploy.
--
-- A flag is reference data with one mutable field, which makes it unlike anything
-- else here: a case accumulates effects, a flag *is* a state that effects move. So
-- the history table is the effect and the flag row is a projection of it, and the
-- statements below exist to keep those two from disagreeing.

create table if not exists feature_flags (
  id          text primary key,
  key         text not null unique,
  description text not null,
  enabled     boolean not null default false,
  -- Protected means the flag gates payments, limits or a customer-facing money flow.
  -- It is a property of the flag rather than of the caller's input, which is what lets
  -- the approval requirement be derived from the record and re-proved afterwards.
  protected   boolean not null default false,
  revision    integer not null default 1 check (revision > 0),
  created_at  timestamptz not null default now()
);

-- One row per accepted flip: which flag, from what to what, by whom, when, and the
-- invocation that did it. Append-only, like every other effect table.
create table if not exists feature_flag_changes (
  id            text primary key,
  flag_id       text not null references feature_flags(id),
  from_enabled  boolean not null,
  to_enabled    boolean not null,
  note          text not null default '',
  flipped_by    text not null references platform_users(id),
  at            timestamptz not null default now(),
  invocation_id uuid,
  capability    text
);

create index if not exists feature_flag_changes_flag_at_idx
  on feature_flag_changes (flag_id, at desc, id desc);

-- The effect-table contract from 0003, applied to the new table by name: an effect
-- names the audited invocation that produced it (deferred, because the effect is
-- written before its audit row inside one transaction) and can never be edited.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feature_flag_changes_invocation_fk') then
    alter table feature_flag_changes
      add constraint feature_flag_changes_invocation_fk foreign key (invocation_id)
        references audit_log (invocation_id) deferrable initially deferred;
  end if;
end $$;

drop trigger if exists feature_flag_changes_require_invocation on feature_flag_changes;
create trigger feature_flag_changes_require_invocation
  before insert on feature_flag_changes
  for each row execute function require_invocation_id();

drop trigger if exists feature_flag_changes_immutable on feature_flag_changes;
create trigger feature_flag_changes_immutable
  before update or delete on feature_flag_changes
  for each row execute function reject_mutation();

-- A flag's state only moves by a flip that was recorded. Checked at commit rather
-- than per statement, because the runtime writes the history row and updates the flag
-- in the same transaction and either order must be allowed. `update feature_flags set
-- enabled = ...` by hand, with no matching change row, fails here — so the audit trail
-- cannot be bypassed by reaching the database directly.
create or replace function enforce_flag_state_is_audited() returns trigger as $$
declare
  last_to boolean;
begin
  select c.to_enabled into last_to
    from feature_flag_changes c
   where c.flag_id = new.id
   order by c.at desc, c.id desc
   limit 1;

  if last_to is distinct from new.enabled then
    raise exception 'invariant violation: feature flag % changed state with no recorded flip', new.key
      using errcode = 'check_violation';
  end if;
  return null;
end $$ language plpgsql;

drop trigger if exists feature_flags_state_is_audited on feature_flags;
create constraint trigger feature_flags_state_is_audited
  after update on feature_flags
  deferrable initially deferred
  for each row
  when (old.enabled is distinct from new.enabled)
  execute function enforce_flag_state_is_audited();
