-- SIP amount history. A SIP can be raised, lowered, stopped and restarted; the instalments already made must not change when it does.
-- Every change of mf_positions.sip_monthly / sip_stopped is recorded here with the date it takes effect. 0 means stopped from that date.
create table public.mf_sip_changes (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  asset_id     uuid not null,
  effective_on date not null,
  monthly      numeric(18,2) not null check (monthly >= 0),
  created_at   timestamptz not null default now(),
  unique (asset_id, effective_on),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index mf_sip_changes_asset_idx on public.mf_sip_changes (household_id, asset_id, effective_on);
alter table public.mf_sip_changes enable row level security;
create policy mf_sip_changes_all on public.mf_sip_changes for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.mf_sip_changes from anon, authenticated;
grant select, insert, update, delete on public.mf_sip_changes to authenticated;
create trigger audit_mf_sip_changes after insert or update or delete on public.mf_sip_changes for each row execute function public.audit_row();

-- The amount a position pays now: 0 when stopped or when it has no SIP.
create function public.sip_effective(p_monthly numeric, p_stopped boolean) returns numeric
language sql immutable as $$ select case when coalesce(p_stopped, false) then 0 else coalesce(p_monthly, 0) end $$;

-- When the amount or the stopped flag changes, write the change down. The date is today unless the caller set app.sip_effective_on
-- (set_sip does, so a change can be dated). The first change also writes the amount that ran before it, from the day the SIP started.
create function public.record_sip_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old numeric := public.sip_effective(old.sip_monthly, old.sip_stopped);
  v_new numeric := public.sip_effective(new.sip_monthly, new.sip_stopped);
  v_on date := coalesce(nullif(current_setting('app.sip_effective_on', true), '')::date, current_date);
begin
  if v_old = v_new then return new; end if;
  if not exists (select 1 from public.mf_sip_changes where asset_id = new.asset_id) and v_old > 0 and old.started_on is not null then
    insert into public.mf_sip_changes (household_id, asset_id, effective_on, monthly)
      values (new.household_id, new.asset_id, old.started_on, v_old) on conflict do nothing;
  end if;
  insert into public.mf_sip_changes (household_id, asset_id, effective_on, monthly)
    values (new.household_id, new.asset_id, v_on, v_new)
    on conflict (asset_id, effective_on) do update set monthly = excluded.monthly;
  return new;
end $$;
create trigger mf_positions_sip_change after update of sip_monthly, sip_stopped on public.mf_positions
  for each row execute function public.record_sip_change();

-- Change, stop or restart a SIP from a given date (default today). p_monthly = 0 stops it.
create function public.set_sip(p_household uuid, p_asset uuid, p_monthly numeric, p_effective_on date default null)
returns void language plpgsql as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_monthly is null or p_monthly < 0 then raise exception 'the SIP amount must be zero or more'; end if;
  if p_effective_on is not null and p_effective_on > current_date + 31 then raise exception 'date too far ahead'; end if;
  perform set_config('app.sip_effective_on', coalesce(p_effective_on::text, ''), true);
  update public.mf_positions set
    sip_monthly = case when p_monthly > 0 then p_monthly else sip_monthly end,
    sip_stopped = (p_monthly = 0)
  where asset_id = p_asset and household_id = p_household;
  if not found then raise exception 'unknown fund'; end if;
  perform set_config('app.sip_effective_on', '', true);
end $$;
revoke all on function public.set_sip(uuid, uuid, numeric, date) from public, anon;
grant execute on function public.set_sip(uuid, uuid, numeric, date) to authenticated;

-- Instalments assumed from the plan are kept in the ledger as estimates (source 'estimate', source_ref 'est:<date>'), so lots, returns and
-- graphs agree with the valuation. A real line replaces them: once a statement or entry covers a date, the estimates up to it are removed.
create function public.drop_estimates_on_real() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source <> 'estimate' then
    delete from public.mf_transactions where asset_id = new.asset_id and source = 'estimate' and txn_on <= new.txn_on;
  end if;
  return new;
end $$;
create trigger mf_transactions_drop_estimates after insert on public.mf_transactions
  for each row execute function public.drop_estimates_on_real();

create function public.drop_estimates_on_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.units_as_of is not null and new.units_as_of is distinct from old.units_as_of then
    delete from public.mf_transactions where asset_id = new.asset_id and source = 'estimate' and txn_on <= new.units_as_of;
  end if;
  return new;
end $$;
create trigger mf_positions_drop_estimates after update of units_as_of on public.mf_positions
  for each row execute function public.drop_estimates_on_count();
