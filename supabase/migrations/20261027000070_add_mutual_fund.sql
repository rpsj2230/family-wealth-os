-- Adds a mutual fund by hand from the Investments page ("Add a fund"): the fund as an asset for a person, its saved position (amount
-- invested, start date, SIP, plan) and, when the value is given, the first recorded value and the units held. The value and units go
-- through save_fund_update, so they are checked and recorded exactly as the monthly update records them.
-- p: { ownerId, name, invested, value, units?, startedOn?, sipMonthly?, planType? }
create function public.add_mutual_fund(p_household uuid, p jsonb)
returns uuid language plpgsql as $$
declare
  v_owner uuid := (p->>'ownerId')::uuid;
  v_name text := nullif(btrim(p->>'name'), '');
  v_invested numeric := coalesce(nullif(p->>'invested', '')::numeric, 0);
  v_value numeric := nullif(p->>'value', '')::numeric;
  v_units numeric := nullif(p->>'units', '')::numeric;
  v_started date := nullif(p->>'startedOn', '')::date;
  v_sip numeric := nullif(p->>'sipMonthly', '')::numeric;
  v_plan text := coalesce(nullif(p->>'planType', ''), 'regular_or_unknown');
  v_id uuid;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if v_name is null or length(v_name) > 120 then raise exception 'the fund needs a name of up to 120 characters'; end if;
  if not exists (select 1 from public.owners where id = v_owner and household_id = p_household) then raise exception 'unknown person'; end if;
  if v_plan not in ('direct', 'regular', 'regular_or_unknown') then raise exception 'unknown plan'; end if;
  if v_invested < 0 then raise exception 'the amount invested cannot be negative'; end if;
  if v_value is null or v_value <= 0 then raise exception 'the value now is needed'; end if;
  if v_units is not null and v_units < 0 then raise exception 'units cannot be negative'; end if;
  if v_sip is not null and v_sip <= 0 then raise exception 'the SIP must be more than zero'; end if;
  if v_started is not null and v_started > current_date then raise exception 'the start date must be today or earlier'; end if;
  if exists (select 1 from public.assets where household_id = p_household and owner_id = v_owner and type = 'mutual_fund' and nickname = v_name) then
    raise exception 'this person already has a fund called %', v_name;
  end if;

  insert into public.assets (household_id, type, owner_id, nickname, currency, status)
    values (p_household, 'mutual_fund', v_owner, v_name, 'INR', 'active')
    returning id into v_id;
  insert into public.mf_positions (asset_id, household_id, fund_name, plan_type, invested, started_on, sip_monthly, provenance)
    values (v_id, p_household, v_name, v_plan, v_invested, v_started, v_sip, 'manual');
  perform public.save_fund_update(p_household, jsonb_build_array(jsonb_build_object(
    'assetId', v_id, 'asOf', current_date, 'units', v_units, 'value', v_value, 'invested', v_invested)));
  return v_id;
end $$;
revoke all on function public.add_mutual_fund(uuid, jsonb) from public, anon;
grant execute on function public.add_mutual_fund(uuid, jsonb) to authenticated;
