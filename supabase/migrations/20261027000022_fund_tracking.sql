-- Mutual funds, tracked properly: units held, a dated history of units / price / value / amount invested for every fund, and two
-- batch-safe ways to keep them current by hand (the monthly fund update, and one transaction at a time).
alter table public.mf_positions
  add column units       numeric(18,4) check (units is null or units >= 0),
  add column units_as_of date;

create table public.mf_snapshots (
  asset_id     uuid not null,
  household_id uuid not null,
  as_of        date not null,
  units        numeric(18,4) check (units is null or units >= 0),
  nav          numeric(18,4) check (nav is null or nav > 0),
  value        numeric(18,2) not null check (value >= 0),
  invested     numeric(18,2) check (invested is null or invested >= 0),
  source       text not null check (source in ('manual', 'daily', 'cas')),
  created_at   timestamptz not null default now(),
  primary key (asset_id, as_of),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index mf_snapshots_household_idx on public.mf_snapshots (household_id, as_of);
alter table public.mf_snapshots enable row level security;
create policy mf_snapshots_all on public.mf_snapshots for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.mf_snapshots from anon, authenticated;
grant select, insert, update, delete on public.mf_snapshots to authenticated;

-- p_rows: [{ assetId, units, invested, asOf?, nav?, value, sipMonthly?|null, sipStopped? }]
-- Sets the units and the amount invested on the date, records the value as a new valuation (history is kept) and the day's snapshot.
create function public.save_fund_update(p_household uuid, p_rows jsonb)
returns jsonb language plpgsql as $$
declare
  r jsonb; a public.assets%rowtype; n int := 0;
  v_units numeric; v_inv numeric; v_val numeric; v_nav numeric; v_asof date;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'too many rows in one save'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    select * into a from public.assets where id = (r->>'assetId')::uuid and household_id = p_household and type = 'mutual_fund';
    if not found then raise exception 'unknown fund %', r->>'assetId'; end if;
    v_units := nullif(r->>'units', '')::numeric;
    v_inv   := nullif(r->>'invested', '')::numeric;
    v_val   := (r->>'value')::numeric;
    v_nav   := nullif(r->>'nav', '')::numeric;
    v_asof  := coalesce(nullif(r->>'asOf', '')::date, current_date);
    if v_val is null or v_val < 0 then raise exception 'a value is needed for %', a.nickname; end if;
    if v_units is not null and v_units < 0 then raise exception 'negative units for %', a.nickname; end if;
    if v_inv is not null and v_inv < 0 then raise exception 'negative amount invested for %', a.nickname; end if;
    if v_nav is not null and v_nav <= 0 then raise exception 'price must be above zero for %', a.nickname; end if;
    if v_asof > current_date then raise exception 'date in the future for %', a.nickname; end if;
    update public.mf_positions set
      units = case when v_units is not null then v_units else units end,
      units_as_of = case when v_units is not null then v_asof else units_as_of end,
      invested = coalesce(v_inv, invested),
      sip_monthly = case when r ? 'sipMonthly' then nullif(r->>'sipMonthly', '')::numeric else sip_monthly end,
      sip_stopped = case when r ? 'sipStopped' then coalesce((r->>'sipStopped')::boolean, false) else sip_stopped end
    where asset_id = a.id;
    insert into public.observations (household_id, asset_id, kind, amount, currency, as_of, source, confidence, note)
      values (p_household, a.id, 'valuation', v_val, 'INR', v_asof, 'manual', 'manual_confirmed',
              case when v_units is not null and v_nav is not null then 'Monthly update: ' || v_units || ' units at ' || v_nav end);
    insert into public.mf_snapshots (asset_id, household_id, as_of, units, nav, value, invested, source)
      values (a.id, p_household, v_asof, v_units, v_nav, v_val, v_inv, 'manual')
      on conflict (asset_id, as_of) do update set units = excluded.units, nav = excluded.nav, value = excluded.value,
        invested = excluded.invested, source = 'manual', created_at = now();
    n := n + 1;
  end loop;
  return jsonb_build_object('funds', n);
end $$;
revoke all on function public.save_fund_update(uuid, jsonb) from public, anon;
grant execute on function public.save_fund_update(uuid, jsonb) to authenticated;

-- p: { date, kind, amount, units?, nav? }  units = amount / nav when only the price is given.
-- Buys add to the units and the amount invested; sales take out the same share of both.
create function public.add_fund_transaction(p_household uuid, p_asset uuid, p jsonb)
returns jsonb language plpgsql as $$
declare
  a public.assets%rowtype; pos public.mf_positions%rowtype;
  v_kind text := p->>'kind'; v_date date := (p->>'date')::date; v_amount numeric := abs((p->>'amount')::numeric);
  v_nav numeric := nullif(p->>'nav', '')::numeric; v_units numeric := abs(nullif(p->>'units', '')::numeric);
  v_sell boolean; v_before numeric; v_new_units numeric; v_new_inv numeric;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select * into a from public.assets where id = p_asset and household_id = p_household and type = 'mutual_fund';
  if not found then raise exception 'unknown fund'; end if;
  select * into pos from public.mf_positions where asset_id = p_asset;
  if v_kind not in ('purchase', 'sip', 'redeem', 'switch_in', 'switch_out', 'dividend_reinvest', 'bonus') then raise exception 'unknown kind'; end if;
  if v_date is null or v_date > current_date then raise exception 'the date must be today or earlier'; end if;
  if v_amount is null or v_amount <= 0 then raise exception 'an amount is needed'; end if;
  if v_nav is not null and v_nav <= 0 then raise exception 'price must be above zero'; end if;
  if v_units is null and v_nav is not null then v_units := round(v_amount / v_nav, 4); end if;
  if v_units is null or v_units <= 0 then raise exception 'units or a price are needed'; end if;
  v_sell := v_kind in ('redeem', 'switch_out');
  v_before := pos.units;
  if v_sell and v_before is not null and v_units > v_before + 0.0001 then raise exception 'selling more units than are held'; end if;
  insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, description, source, source_ref)
    values (p_household, p_asset, v_date, v_kind, case when v_sell then -v_amount else v_amount end, case when v_sell then -v_units else v_units end,
            v_nav, 'Entered by hand', 'manual', 'manual:' || gen_random_uuid());
  v_new_units := case when v_before is null then null else greatest(0, v_before + case when v_sell then -v_units else v_units end) end;
  v_new_inv := case
    when v_sell then case when coalesce(v_before, 0) > 0 then greatest(0, pos.invested - pos.invested * least(1, v_units / v_before)) else pos.invested end
    when v_kind in ('purchase', 'sip', 'switch_in') then pos.invested + v_amount
    else pos.invested end;
  update public.mf_positions set units = v_new_units, units_as_of = case when v_new_units is not null then v_date else units_as_of end,
    invested = round(v_new_inv, 2) where asset_id = p_asset;
  return jsonb_build_object('units', v_new_units, 'invested', round(v_new_inv, 2), 'unitsKnown', v_before is not null);
end $$;
revoke all on function public.add_fund_transaction(uuid, uuid, jsonb) from public, anon;
grant execute on function public.add_fund_transaction(uuid, uuid, jsonb) to authenticated;
