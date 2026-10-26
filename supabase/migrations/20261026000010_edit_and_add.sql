-- One source of truth: edit notes and deposit terms from the monthly sheet, and add a new deposit or account in place.

create or replace function public.save_monthly_update(p_household uuid, p_rows jsonb)
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

    if r ? 'interestRate' or r ? 'tdsRate' or r ? 'status' or r ? 'notes' then
      update public.assets set
        interest_rate = case when r ? 'interestRate' then (r->>'interestRate')::numeric else interest_rate end,
        tds_rate      = case when r ? 'tdsRate' then (r->>'tdsRate')::numeric else tds_rate end,
        status        = case when r ? 'status' then r->>'status' else status end,
        notes         = case when r ? 'notes' then nullif(left(r->>'notes', 500), '') else notes end
      where id = a.id;
      n_set := n_set + 1;
    end if;

    if a.type = 'fixed_deposit' and (r ? 'fdRate' or r ? 'fdMaturityOn' or r ? 'fdMaturityAmount' or r ? 'fdRefLast4') then
      update public.fixed_deposits set
        rate = case when r ? 'fdRate' then (r->>'fdRate')::numeric else rate end,
        maturity_on = case when r ? 'fdMaturityOn' then (r->>'fdMaturityOn')::date else maturity_on end,
        bank_maturity_amount = case when r ? 'fdMaturityAmount' then (r->>'fdMaturityAmount')::numeric else bank_maturity_amount end,
        fd_ref_last4 = case when r ? 'fdRefLast4' then nullif(r->>'fdRefLast4', '') else fd_ref_last4 end
      where asset_id = a.id;
      n_set := n_set + 1;
    end if;
  end loop;
  return jsonb_build_object('observations', n_obs, 'settings', n_set);
end $$;

-- Adds a savings account or a fixed deposit for a person at a bank. It is placed after the last row of that person's section
-- at that bank, so it appears where it belongs in your order.
create function public.add_bank_item(p_household uuid, p jsonb)
returns uuid language plpgsql as $$
declare
  v_type text := p->>'type';
  v_owner uuid := (p->>'ownerId')::uuid;
  v_inst uuid := (p->>'institutionId')::uuid;
  v_kind text := p->>'accountKind';
  v_joint boolean := coalesce((p->>'isJoint')::boolean, false);
  v_last4 text := nullif(p->>'last4', '');
  v_order numeric; v_id uuid; v_label text; v_nick text; v_n int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if v_type not in ('bank_account', 'fixed_deposit') then raise exception 'type must be bank_account or fixed_deposit'; end if;
  if v_kind is not null and v_kind not in ('NRE', 'NRO', 'SB', 'resident', 'other') then raise exception 'unknown account kind'; end if;
  if not exists (select 1 from public.owners where id = v_owner and household_id = p_household) then raise exception 'unknown owner'; end if;
  if not exists (select 1 from public.institutions where id = v_inst and household_id = p_household) then raise exception 'unknown bank'; end if;

  select coalesce(max(sort_order), 0) + 0.001 into v_order from public.assets
    where household_id = p_household and institution_id = v_inst and owner_id = v_owner and sort_order is not null;
  select count(*) + 1 into v_n from public.assets where household_id = p_household and institution_id = v_inst and owner_id = v_owner and type = v_type;
  v_label := (case when v_type = 'fixed_deposit' then 'FD' else 'Cash' end)
             || coalesce('-' || v_kind, '') || case when v_joint then ' JO' else '' end || coalesce('-' || v_last4, '');
  v_nick := v_label || ' #' || v_n || ' ' || to_char(now(), 'YYYYMMDDHH24MISS');

  insert into public.assets (household_id, type, owner_id, institution_id, nickname, label, sort_order, is_joint, account_kind,
                             identifier_last4, linked_last4, currency, status, notes)
  values (p_household, v_type, v_owner, v_inst, v_nick, v_label, v_order, v_joint, v_kind,
          case when v_type = 'bank_account' then v_last4 end, case when v_type = 'fixed_deposit' then v_last4 end,
          coalesce(p->>'currency', 'INR'), 'active', nullif(left(p->>'notes', 500), ''))
  returning id into v_id;

  if v_type = 'fixed_deposit' then
    insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount, fd_ref_last4)
    values (v_id, p_household, (p->>'principal')::numeric, (p->>'rate')::numeric, (p->>'bookedOn')::date, (p->>'maturityOn')::date,
            coalesce(p->>'compounding', 'quarterly'), nullif(p->>'maturityAmount', '')::numeric, nullif(p->>'refLast4', ''));
  end if;
  return v_id;
end $$;
revoke all on function public.add_bank_item(uuid, jsonb) from public, anon;
grant execute on function public.add_bank_item(uuid, jsonb) to authenticated;
