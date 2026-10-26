-- Monthly update: per-account interest assumptions and an all-or-nothing batch save of new balances/values.

alter table public.assets
  add column interest_rate numeric(9,6) check (interest_rate is null or (interest_rate >= 0 and interest_rate < 1)),
  add column tds_rate      numeric(9,6) check (tds_rate is null or (tds_rate >= 0 and tds_rate < 1));

comment on column public.assets.interest_rate is 'Annual interest on savings-type balances (decimal). NULL = use the app default assumption.';
comment on column public.assets.tds_rate is 'Tax deducted at source on that interest (decimal). NULL = use the app default assumption.';

-- p_rows: [{ "assetId": uuid, "amount": number?, "asOf": "YYYY-MM-DD"?, "fxRate": number?, "note": text?,
--            "interestRate": number?|null, "tdsRate": number?|null, "status": text? }]
-- Observations are appended (history is preserved); asset settings are updated in place and audited.
create function public.save_monthly_update(p_household uuid, p_rows jsonb)
returns jsonb language plpgsql as $$
declare
  r jsonb; a public.assets%rowtype;
  n_obs int := 0; n_set int := 0; v_amount numeric; v_asof date; v_fx numeric; v_kind text;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'too many rows in one save'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    select * into a from public.assets where id = (r->>'assetId')::uuid and household_id = p_household;
    if not found then raise exception 'unknown asset %', r->>'assetId'; end if;

    if r ? 'amount' and r->>'amount' is not null then
      v_amount := (r->>'amount')::numeric;
      if v_amount < 0 then raise exception 'negative value for %', a.nickname; end if;
      v_asof := coalesce((r->>'asOf')::date, current_date);
      if v_asof > current_date then raise exception 'date in the future for %', a.nickname; end if;
      v_fx := (r->>'fxRate')::numeric;
      if a.currency <> 'INR' and (v_fx is null or v_fx <= 0) then raise exception 'exchange rate required for % (%)', a.nickname, a.currency; end if;
      v_kind := case when a.type = 'bank_account' then 'balance' else 'valuation' end;
      insert into public.observations (household_id, asset_id, kind, amount, currency, fx_rate, as_of, source, confidence, note)
      values (p_household, a.id, v_kind, v_amount, a.currency, case when a.currency <> 'INR' then v_fx end, v_asof,
              'manual', 'manual_confirmed', nullif(r->>'note', ''));
      n_obs := n_obs + 1;
    end if;

    if r ? 'interestRate' or r ? 'tdsRate' or r ? 'status' then
      update public.assets set
        interest_rate = case when r ? 'interestRate' then (r->>'interestRate')::numeric else interest_rate end,
        tds_rate      = case when r ? 'tdsRate' then (r->>'tdsRate')::numeric else tds_rate end,
        status        = case when r ? 'status' then r->>'status' else status end
      where id = a.id;
      n_set := n_set + 1;
    end if;
  end loop;
  return jsonb_build_object('observations', n_obs, 'settings', n_set);
end $$;

revoke all on function public.save_monthly_update(uuid, jsonb) from public;
grant execute on function public.save_monthly_update(uuid, jsonb) to authenticated;
