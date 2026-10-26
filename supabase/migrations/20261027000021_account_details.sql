-- Correct the details and tags of accounts and deposits in one place: type (NRE/NRO/…), joint, last four digits, label, notes,
-- owner, bank, status, and a deposit's terms. Balances are never touched here (they change only through the monthly update).

create function public.save_account_details(p_household uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; a public.assets%rowtype; f public.fixed_deposits%rowtype;
  v_kind text; v_last4 text; v_linked text; v_ref text; v_status text; v_owner uuid; v_inst uuid;
  v_label text; v_notes text; v_holder text;
  v_rate numeric; v_booked date; v_maturity date; v_principal numeric; v_matamt numeric;
  n_acc int := 0; n_fd int := 0;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'rows must be an array'; end if;
  if jsonb_array_length(p_rows) > 500 then raise exception 'too many rows in one save (500 at most)'; end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      if jsonb_typeof(r) <> 'object' or not (r ? 'id') then raise exception 'every row needs an id'; end if;
      select * into a from public.assets where id = (r->>'id')::uuid and household_id = p_household;
      if not found then raise exception 'unknown account %', r->>'id'; end if;

      v_kind := a.account_kind; v_last4 := a.identifier_last4; v_linked := a.linked_last4; v_status := a.status;
      v_owner := a.owner_id; v_inst := a.institution_id; v_label := a.label; v_notes := a.notes; v_holder := a.holder_name;

      if r ? 'accountKind' then
        v_kind := nullif(r->>'accountKind', '');
        if v_kind is not null and v_kind not in ('NRE', 'NRO', 'FCNR', 'SB', 'resident', 'joint', 'other') then
          raise exception 'unknown account type "%" for %', v_kind, coalesce(a.label, a.nickname);
        end if;
      end if;
      if r ? 'last4' then
        v_last4 := nullif(r->>'last4', '');
        if v_last4 is not null and v_last4 !~ '^[A-Za-z0-9-]{1,4}$' then raise exception 'last four digits must be 1 to 4 letters or digits (%)', coalesce(a.label, a.nickname); end if;
      end if;
      if r ? 'linkedLast4' then
        v_linked := nullif(r->>'linkedLast4', '');
        if v_linked is not null and v_linked !~ '^[A-Za-z0-9-]{1,4}$' then raise exception 'linked account digits must be 1 to 4 letters or digits (%)', coalesce(a.label, a.nickname); end if;
      end if;
      if r ? 'label' then
        v_label := nullif(btrim(r->>'label'), '');
        if length(v_label) > 120 then raise exception 'the label is longer than 120 characters (%)', coalesce(a.label, a.nickname); end if;
      end if;
      if r ? 'notes' then
        v_notes := nullif(btrim(r->>'notes'), '');
        if length(v_notes) > 500 then raise exception 'the note is longer than 500 characters (%)', coalesce(a.label, a.nickname); end if;
      end if;
      if r ? 'holderName' then
        v_holder := nullif(btrim(r->>'holderName'), '');
        if length(v_holder) > 120 then raise exception 'the holder name is longer than 120 characters'; end if;
      end if;
      if r ? 'status' then
        v_status := r->>'status';
        if v_status not in ('active', 'matured', 'matured_unconfirmed', 'renewed', 'closed', 'stopped') then raise exception 'unknown status "%"', v_status; end if;
      end if;
      if r ? 'ownerId' then
        v_owner := (r->>'ownerId')::uuid;
        if not exists (select 1 from public.owners where id = v_owner and household_id = p_household) then raise exception 'unknown person'; end if;
      end if;
      if r ? 'institutionId' then
        v_inst := nullif(r->>'institutionId', '')::uuid;
        if v_inst is not null and not exists (select 1 from public.institutions where id = v_inst and household_id = p_household) then raise exception 'unknown bank'; end if;
      end if;

      update public.assets set
        account_kind = v_kind,
        identifier_last4 = v_last4,
        linked_last4 = v_linked,
        label = v_label,
        notes = v_notes,
        holder_name = v_holder,
        status = v_status,
        owner_id = v_owner,
        institution_id = v_inst,
        is_joint = case when r ? 'isJoint' then coalesce((r->>'isJoint')::boolean, false) else is_joint end
      where id = a.id;
      n_acc := n_acc + 1;

      if r ? 'fdRate' or r ? 'fdBookedOn' or r ? 'fdMaturityOn' or r ? 'fdPrincipal' or r ? 'fdMaturityAmount' or r ? 'fdRefLast4' then
        if a.type <> 'fixed_deposit' then raise exception '% is not a deposit', coalesce(a.label, a.nickname); end if;
        select * into f from public.fixed_deposits where asset_id = a.id;
        v_rate := f.rate; v_booked := f.booked_on; v_maturity := f.maturity_on; v_principal := f.principal;
        v_matamt := f.bank_maturity_amount; v_ref := f.fd_ref_last4;
        if r ? 'fdRate' then
          v_rate := (r->>'fdRate')::numeric;
          if v_rate is null or v_rate < 0 or v_rate > 0.3 then raise exception 'the rate must be between 0 and 30%% (%)', coalesce(a.label, a.nickname); end if;
        end if;
        if r ? 'fdBookedOn' then v_booked := (r->>'fdBookedOn')::date; end if;
        if r ? 'fdMaturityOn' then v_maturity := (r->>'fdMaturityOn')::date; end if;
        if v_maturity <= v_booked then raise exception 'the maturity date must be after the start date (%)', coalesce(a.label, a.nickname); end if;
        if r ? 'fdPrincipal' then
          v_principal := (r->>'fdPrincipal')::numeric;
          if v_principal is null or v_principal <= 0 then raise exception 'the amount invested must be more than zero (%)', coalesce(a.label, a.nickname); end if;
        end if;
        if r ? 'fdMaturityAmount' then
          v_matamt := nullif(r->>'fdMaturityAmount', '')::numeric;
          if v_matamt is not null and v_matamt <= 0 then raise exception 'the amount at maturity must be more than zero (%)', coalesce(a.label, a.nickname); end if;
        end if;
        if r ? 'fdRefLast4' then
          v_ref := nullif(r->>'fdRefLast4', '');
          if v_ref is not null and v_ref !~ '^[A-Za-z0-9-]{1,4}$' then raise exception 'the deposit number digits must be 1 to 4 letters or digits (%)', coalesce(a.label, a.nickname); end if;
        end if;
        update public.fixed_deposits set
          rate = v_rate, booked_on = v_booked, maturity_on = v_maturity, principal = v_principal,
          bank_maturity_amount = v_matamt, fd_ref_last4 = v_ref
        where asset_id = a.id;
        n_fd := n_fd + 1;
      end if;
    exception
      when unique_violation then
        raise exception 'another account with the same name already exists for that person at that bank (%)', coalesce(a.label, a.nickname);
      when invalid_text_representation or numeric_value_out_of_range or datetime_field_overflow or invalid_datetime_format then
        raise exception 'a value for % is not valid', coalesce(a.label, a.nickname, r->>'id');
    end;
  end loop;
  return jsonb_build_object('accounts', n_acc, 'deposits', n_fd);
end $$;
revoke all on function public.save_account_details(uuid, jsonb) from public, anon;
grant execute on function public.save_account_details(uuid, jsonb) to authenticated;

-- The same tag on many accounts at once. An empty or null kind clears the tag.
create function public.set_account_kind(p_household uuid, p_ids uuid[], p_kind text)
returns int language plpgsql security definer set search_path = public as $$
declare v_kind text := nullif(p_kind, ''); n int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_ids is null or cardinality(p_ids) = 0 then return 0; end if;
  if cardinality(p_ids) > 500 then raise exception 'too many accounts in one change (500 at most)'; end if;
  if v_kind is not null and v_kind not in ('NRE', 'NRO', 'FCNR', 'SB', 'resident', 'joint', 'other') then raise exception 'unknown account type "%"', v_kind; end if;
  if exists (select 1 from unnest(p_ids) x where not exists (select 1 from public.assets where id = x and household_id = p_household)) then
    raise exception 'one of the accounts does not belong to this household';
  end if;
  update public.assets set account_kind = v_kind where household_id = p_household and id = any (p_ids);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.set_account_kind(uuid, uuid[], text) from public, anon;
grant execute on function public.set_account_kind(uuid, uuid[], text) to authenticated;
