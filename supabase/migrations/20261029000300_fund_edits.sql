-- Fund edits by hand (docs/USER-GUIDE.md, "Changing a fund"):
--  1. edit_fund_transaction / delete_fund_transaction: correct or remove a line. The fund's unit count and amount invested move with it,
--     exactly undoing what the line had done. A line from a fund statement (source 'cas') is never edited (the next statement would put it
--     back as it was): it can be deleted, and the next statement that covers it brings it back. An estimated SIP instalment follows the
--     SIP plan and is changed through the SIP, not line by line. Every edit and delete is logged (audit_events), as is every line typed in.
--  2. schedule_sip / remove_sip_change: change, stop or pause a SIP from any date, with an optional date it starts again. The dated
--     history (mf_sip_changes) decides every instalment; the fund's own "SIP a month" follows the change in force today
--     (sync_sip_positions, also run by the daily job so a pause ends by itself).
--  3. add_fund_transaction learns "sell everything": the sale is for every unit held on its date, and the fund is closed with its SIP
--     stopped from that day.
--  4. mf_positions.sip_from_asset_id: the savings account a SIP is paid from, so its estimated balance goes down on each instalment date.

-- 4 ------------------------------------------------------------------------------------------------------------------------------
alter table public.mf_positions
  add column sip_from_asset_id uuid,
  add constraint mf_positions_sip_from_fk foreign key (sip_from_asset_id, household_id)
    references public.assets (id, household_id) on delete set null (sip_from_asset_id);

-- 1 ------------------------------------------------------------------------------------------------------------------------------
-- the logs: a line typed in, a line changed (its date, kind or figures), a line removed. Statement imports and the estimates the daily
-- job keeps are not logged line by line (they add and drop hundreds).
create trigger audit_mf_transactions_manual after insert on public.mf_transactions
  for each row when (new.source = 'manual') execute function public.audit_row();
create trigger audit_mf_transactions_edit after update on public.mf_transactions
  for each row when ((old.txn_on, old.kind, old.amount, old.units, old.nav) is distinct from (new.txn_on, new.kind, new.amount, new.units, new.nav))
  execute function public.audit_row();
create trigger audit_mf_transactions_delete after delete on public.mf_transactions
  for each row when (old.source <> 'estimate') execute function public.audit_row();

-- What a line did to the fund's units and amount invested, undone: buys come off, a sale's units and their cost go back. A sale took
-- the same share of the cost as of the units, so the cost per unit after it is the cost per unit it sold at (exact when units are known).
create function public.fund_line_undo(p_units numeric, p_invested numeric, p_kind text, p_amount numeric, p_line_units numeric)
returns numeric[] language plpgsql immutable as $$
declare v_units numeric := p_units; v_inv numeric := coalesce(p_invested, 0);
begin
  if v_units is not null then v_units := v_units - p_line_units; end if;
  if p_kind in ('purchase', 'sip', 'switch_in') then
    v_inv := greatest(0, v_inv - abs(p_amount));
  elsif p_kind in ('redeem', 'switch_out') and p_units is not null and p_units > 0 then
    v_inv := v_inv + (v_inv / p_units) * abs(p_line_units);
  end if;
  return array[v_units, v_inv];
end $$;

-- What a line does to the units and amount invested (the same rule as add_fund_transaction).
create function public.fund_line_apply(p_units numeric, p_invested numeric, p_kind text, p_amount numeric, p_line_units numeric)
returns numeric[] language plpgsql immutable as $$
declare v_units numeric := p_units; v_inv numeric := coalesce(p_invested, 0); v_sell boolean := p_kind in ('redeem', 'switch_out');
begin
  if v_sell and p_units is not null and abs(p_line_units) > p_units + 0.0001 then raise exception 'selling more units than are held'; end if;
  if v_sell then
    v_inv := case when coalesce(p_units, 0) > 0 then greatest(0, v_inv - v_inv * least(1, abs(p_line_units) / p_units)) else v_inv end;
  elsif p_kind in ('purchase', 'sip', 'switch_in') then
    v_inv := v_inv + abs(p_amount);
  end if;
  if v_units is not null then v_units := greatest(0, v_units + p_line_units); end if;
  return array[v_units, v_inv];
end $$;

create function public.edit_fund_transaction(p_household uuid, p_id uuid, p jsonb)
returns jsonb language plpgsql as $$
declare
  t public.mf_transactions%rowtype; pos public.mf_positions%rowtype; v numeric[];
  v_kind text := p->>'kind'; v_date date := (p->>'date')::date; v_amount numeric := abs((p->>'amount')::numeric);
  v_nav numeric := nullif(p->>'nav', '')::numeric; v_units numeric := abs(nullif(p->>'units', '')::numeric); v_sell boolean;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select * into t from public.mf_transactions where id = p_id and household_id = p_household and superseded_on is null;
  if not found then raise exception 'unknown transaction'; end if;
  if t.source = 'cas' then raise exception 'a line from a fund statement cannot be changed: the next statement would put it back. Delete it if it is wrong'; end if;
  if t.source = 'estimate' then raise exception 'an estimated SIP instalment follows the SIP plan: change the SIP instead'; end if;
  if v_kind not in ('purchase', 'sip', 'redeem', 'switch_in', 'switch_out', 'dividend_reinvest', 'bonus') then raise exception 'unknown kind'; end if;
  if v_date is null or v_date > current_date then raise exception 'the date must be today or earlier'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'an amount is needed'; end if;
  if v_nav is not null and v_nav <= 0 then raise exception 'price must be above zero'; end if;
  if v_units is null and v_nav is not null then v_units := round(v_amount / v_nav, 4); end if;
  if v_units is null or v_units <= 0 then raise exception 'units or a price are needed'; end if;
  v_sell := v_kind in ('redeem', 'switch_out');
  select * into pos from public.mf_positions where asset_id = t.asset_id for update;
  v := public.fund_line_undo(pos.units, pos.invested, t.kind, t.amount, t.units);
  v := public.fund_line_apply(v[1], v[2], v_kind, v_amount, case when v_sell then -v_units else v_units end);
  update public.mf_transactions set
    txn_on = v_date, kind = v_kind, amount = case when v_sell then -v_amount else v_amount end,
    units = case when v_sell then -v_units else v_units end, nav = v_nav, balance_units = null,
    source = 'manual', description = 'Entered by hand (corrected)'
  where id = p_id;
  update public.mf_positions set units = v[1], invested = round(v[2], 2) where asset_id = t.asset_id;
  return jsonb_build_object('units', v[1], 'invested', round(v[2], 2));
end $$;
revoke all on function public.edit_fund_transaction(uuid, uuid, jsonb) from public, anon;
grant execute on function public.edit_fund_transaction(uuid, uuid, jsonb) to authenticated;

create function public.delete_fund_transaction(p_household uuid, p_id uuid)
returns jsonb language plpgsql as $$
declare t public.mf_transactions%rowtype; pos public.mf_positions%rowtype; v numeric[];
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select * into t from public.mf_transactions where id = p_id and household_id = p_household and superseded_on is null;
  if not found then raise exception 'unknown transaction'; end if;
  if t.source = 'estimate' then raise exception 'an estimated SIP instalment follows the SIP plan: stop or change the SIP instead'; end if;
  select * into pos from public.mf_positions where asset_id = t.asset_id for update;
  v := public.fund_line_undo(pos.units, pos.invested, t.kind, t.amount, t.units);
  if v[1] is not null and v[1] < -0.0001 then raise exception 'removing this line would leave fewer than no units'; end if;
  delete from public.mf_transactions where id = p_id;
  update public.mf_positions set units = case when v[1] is null then null else greatest(0, v[1]) end, invested = round(v[2], 2)
    where asset_id = t.asset_id;
  return jsonb_build_object('units', v[1], 'invested', round(v[2], 2), 'fromStatement', t.source = 'cas');
end $$;
revoke all on function public.delete_fund_transaction(uuid, uuid) from public, anon;
grant execute on function public.delete_fund_transaction(uuid, uuid) to authenticated;

-- 2 ------------------------------------------------------------------------------------------------------------------------------
-- the dated schedule decides; the position's own amount and stopped flag only mirror the change in force today, so they are set without
-- writing another change (app.sip_schedule_sync)
create or replace function public.record_sip_change() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_old numeric := public.sip_effective(old.sip_monthly, old.sip_stopped);
  v_new numeric := public.sip_effective(new.sip_monthly, new.sip_stopped);
  v_on date := coalesce(nullif(current_setting('app.sip_effective_on', true), '')::date, current_date);
begin
  if coalesce(current_setting('app.sip_schedule_sync', true), '') = '1' then return new; end if;
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

-- the position mirrors the change in force today; p_asset null = every fund with a schedule (the daily job). Row-level security applies
-- to the caller, so a member only ever touches their own household's funds.
create function public.sync_sip_positions(p_asset uuid default null)
returns integer language plpgsql as $$
declare n integer;
begin
  perform set_config('app.sip_schedule_sync', '1', true);
  update public.mf_positions p set
    sip_monthly = case when c.monthly > 0 then c.monthly else p.sip_monthly end,
    sip_stopped = (c.monthly = 0)
  from (
    select distinct on (asset_id) asset_id, monthly from public.mf_sip_changes
    where effective_on <= current_date and (p_asset is null or asset_id = p_asset)
    order by asset_id, effective_on desc
  ) c
  where p.asset_id = c.asset_id
    and (p.sip_stopped is distinct from (c.monthly = 0) or (c.monthly > 0 and p.sip_monthly is distinct from c.monthly));
  get diagnostics n = row_count;
  perform set_config('app.sip_schedule_sync', '', true);
  return n;
end $$;
revoke all on function public.sync_sip_positions(uuid) from public, anon;
grant execute on function public.sync_sip_positions(uuid) to authenticated, service_role;

-- Change (p_monthly > 0) or stop (0) a SIP from p_from. With p_resume_on it is a pause: stopped from p_from, then back from p_resume_on
-- at the amount that ran just before the pause; any change dated inside the pause is replaced by it.
create function public.schedule_sip(p_household uuid, p_asset uuid, p_from date, p_monthly numeric, p_resume_on date default null)
returns jsonb language plpgsql as $$
declare pos public.mf_positions%rowtype; v_before numeric;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_from is null then raise exception 'the date the change applies from is needed'; end if;
  if p_monthly is null or p_monthly < 0 then raise exception 'the SIP amount must be zero or more'; end if;
  if p_from > current_date + 730 or (p_resume_on is not null and p_resume_on > current_date + 730) then raise exception 'date too far ahead (two years at most)'; end if;
  select * into pos from public.mf_positions where asset_id = p_asset and household_id = p_household for update;
  if not found then raise exception 'unknown fund'; end if;
  if pos.started_on is not null and p_from < pos.started_on then raise exception 'the date is before the SIP started'; end if;
  -- the first dated change also writes the amount that ran before it, from the day the SIP started
  if not exists (select 1 from public.mf_sip_changes where asset_id = p_asset) and pos.started_on is not null
     and public.sip_effective(pos.sip_monthly, pos.sip_stopped) > 0 and pos.started_on < p_from then
    insert into public.mf_sip_changes (household_id, asset_id, effective_on, monthly)
      values (p_household, p_asset, pos.started_on, public.sip_effective(pos.sip_monthly, pos.sip_stopped)) on conflict do nothing;
  end if;
  select monthly into v_before from public.mf_sip_changes where asset_id = p_asset and effective_on < p_from
    order by effective_on desc limit 1;
  v_before := coalesce(v_before, case when coalesce(pos.sip_monthly, 0) > 0 then pos.sip_monthly end);
  if p_resume_on is not null then
    if p_monthly <> 0 then raise exception 'a pause stops the SIP: leave the amount at zero'; end if;
    if p_resume_on <= p_from then raise exception 'the SIP must start again after the pause begins'; end if;
    if coalesce(v_before, 0) <= 0 then raise exception 'there is no running SIP amount to start again'; end if;
    delete from public.mf_sip_changes where asset_id = p_asset and effective_on > p_from and effective_on < p_resume_on;
    insert into public.mf_sip_changes (household_id, asset_id, effective_on, monthly) values (p_household, p_asset, p_resume_on, v_before)
      on conflict (asset_id, effective_on) do update set monthly = excluded.monthly;
  end if;
  insert into public.mf_sip_changes (household_id, asset_id, effective_on, monthly) values (p_household, p_asset, p_from, p_monthly)
    on conflict (asset_id, effective_on) do update set monthly = excluded.monthly;
  perform public.sync_sip_positions(p_asset);
  return jsonb_build_object('from', p_from, 'monthly', p_monthly, 'resumeOn', p_resume_on, 'resumeAmount', case when p_resume_on is not null then v_before end);
end $$;
revoke all on function public.schedule_sip(uuid, uuid, date, numeric, date) from public, anon;
grant execute on function public.schedule_sip(uuid, uuid, date, numeric, date) to authenticated;

-- Take back one dated change (a change entered by mistake, or a planned one no longer wanted). The first entry (the amount the SIP
-- started at) is kept while other changes depend on it.
create function public.remove_sip_change(p_household uuid, p_asset uuid, p_on date)
returns void language plpgsql as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if not exists (select 1 from public.mf_positions where asset_id = p_asset and household_id = p_household) then raise exception 'unknown fund'; end if;
  if (select min(effective_on) from public.mf_sip_changes where asset_id = p_asset) = p_on
     and (select count(*) from public.mf_sip_changes where asset_id = p_asset) > 1 then
    raise exception 'this is the amount the SIP started at; change it instead of removing it';
  end if;
  delete from public.mf_sip_changes where asset_id = p_asset and household_id = p_household and effective_on = p_on;
  if not found then raise exception 'no change on that date'; end if;
  perform public.sync_sip_positions(p_asset);
end $$;
revoke all on function public.remove_sip_change(uuid, uuid, date) from public, anon;
grant execute on function public.remove_sip_change(uuid, uuid, date) to authenticated;

-- 3 ------------------------------------------------------------------------------------------------------------------------------
-- p: { date, kind, amount, units?, nav?, all? }. With all = true on a sale, the units are every unit held on the date (the lines up to
-- it when the fund has lines, else the recorded count), and the fund is closed with its SIP stopped from that day.
create or replace function public.add_fund_transaction(p_household uuid, p_asset uuid, p jsonb)
returns jsonb language plpgsql as $$
declare
  a public.assets%rowtype; pos public.mf_positions%rowtype;
  v_kind text := p->>'kind'; v_date date := (p->>'date')::date; v_amount numeric := abs((p->>'amount')::numeric);
  v_nav numeric := nullif(p->>'nav', '')::numeric; v_units numeric := abs(nullif(p->>'units', '')::numeric);
  v_all boolean := coalesce((p->>'all')::boolean, false);
  v_sell boolean; v_before numeric; v_new_units numeric; v_new_inv numeric; v_lines numeric; v_has_lines boolean;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select * into a from public.assets where id = p_asset and household_id = p_household and type = 'mutual_fund';
  if not found then raise exception 'unknown fund'; end if;
  select * into pos from public.mf_positions where asset_id = p_asset;
  if v_kind not in ('purchase', 'sip', 'redeem', 'switch_in', 'switch_out', 'dividend_reinvest', 'bonus') then raise exception 'unknown kind'; end if;
  if v_date is null or v_date > current_date then raise exception 'the date must be today or earlier'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'an amount is needed'; end if;
  if v_nav is not null and v_nav <= 0 then raise exception 'price must be above zero'; end if;
  v_sell := v_kind in ('redeem', 'switch_out');
  if v_all then
    if not v_sell then raise exception 'only a sale can be for every unit'; end if;
    -- the real lines only: the estimates up to the sale are dropped as soon as a real line is written
    select count(*) > 0, coalesce(sum(units), 0) into v_has_lines, v_lines
      from public.mf_transactions where asset_id = p_asset and superseded_on is null and source <> 'estimate' and txn_on <= v_date;
    v_units := case when v_has_lines then round(v_lines, 4) else pos.units end;
    if v_units is null or v_units <= 0 then raise exception 'no units are held on that date to sell'; end if;
  end if;
  if v_units is null and v_nav is not null then v_units := round(v_amount / v_nav, 4); end if;
  if v_units is null or v_units <= 0 then raise exception 'units or a price are needed'; end if;
  v_before := pos.units;
  if v_sell and v_before is not null and not v_all and v_units > v_before + 0.0001 then raise exception 'selling more units than are held'; end if;
  insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, description, source, source_ref)
    values (p_household, p_asset, v_date, v_kind, case when v_sell then -v_amount else v_amount end, case when v_sell then -v_units else v_units end,
            coalesce(v_nav, round(v_amount / v_units, 4)), case when v_all then 'Entered by hand: every unit sold' else 'Entered by hand' end,
            'manual', 'manual:' || gen_random_uuid());
  if v_all then
    v_new_units := 0; v_new_inv := 0;
  else
    v_new_units := case when v_before is null then null else greatest(0, v_before + case when v_sell then -v_units else v_units end) end;
    v_new_inv := case
      when v_sell then case when coalesce(v_before, 0) > 0 then greatest(0, pos.invested - pos.invested * least(1, v_units / v_before)) else pos.invested end
      when v_kind in ('purchase', 'sip', 'switch_in') then pos.invested + v_amount
      else pos.invested end;
  end if;
  update public.mf_positions set units = v_new_units, units_as_of = case when v_new_units is not null then v_date else units_as_of end,
    invested = round(v_new_inv, 2) where asset_id = p_asset;
  if v_all then
    if public.sip_effective(pos.sip_monthly, pos.sip_stopped) > 0 or exists (select 1 from public.mf_sip_changes where asset_id = p_asset and effective_on > v_date) then
      delete from public.mf_sip_changes where asset_id = p_asset and effective_on > v_date;
      perform public.schedule_sip(p_household, p_asset, greatest(v_date, coalesce(pos.started_on, v_date)), 0, null);
    end if;
    update public.assets set status = 'closed' where id = p_asset and household_id = p_household;
  end if;
  return jsonb_build_object('units', v_new_units, 'invested', round(v_new_inv, 2), 'unitsKnown', v_before is not null, 'closed', v_all, 'unitsSold', v_units);
end $$;
