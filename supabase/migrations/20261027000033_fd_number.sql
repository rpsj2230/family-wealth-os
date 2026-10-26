-- The full deposit (FD) number, kept next to its last four digits. Only deposit numbers: account numbers and PANs stay masked.
alter table public.fixed_deposits
  add column fd_ref text check (fd_ref is null or fd_ref ~ '^[A-Za-z0-9-]{4,40}$');

-- A deposit number that no longer ends in the last four digits recorded for it is stale: it is dropped rather than shown wrongly.
create function public.fd_ref_consistent() returns trigger language plpgsql as $$
begin
  if new.fd_ref is not null
     and new.fd_ref_last4 is not null
     and right(regexp_replace(new.fd_ref, '[^0-9]', '', 'g'), 4) <> right(regexp_replace(new.fd_ref_last4, '[^0-9]', '', 'g'), 4)
     and (tg_op = 'INSERT' or new.fd_ref_last4 is distinct from old.fd_ref_last4) then
    new.fd_ref := null;
  end if;
  return new;
end $$;
create trigger fixed_deposits_fd_ref before insert or update on public.fixed_deposits
  for each row execute function public.fd_ref_consistent();

-- p_rows: [{ fdRef, assetId } | { fdRef, institutionId, last4 } | { fdRef, bank, last4 }]. Sets the full number on the matching deposit
-- (and its last four digits when none is recorded). Members only; returns how many deposits were updated.
create function public.set_fd_numbers(p_household uuid, p_rows jsonb)
returns jsonb language plpgsql as $$
declare
  r jsonb; v_ref text; v_last4 text; n int := 0; c int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 500 then raise exception 'rows must be a list of at most 500'; end if;
  for r in select * from jsonb_array_elements(p_rows) loop
    v_ref := nullif(trim(r->>'fdRef'), '');
    if v_ref is null or v_ref !~ '^[A-Za-z0-9-]{4,40}$' then raise exception 'a deposit number is 4 to 40 letters, digits or dashes'; end if;
    v_last4 := right(regexp_replace(split_part(v_ref, '-', 1), '[^0-9]', '', 'g'), 4);
    if r ? 'assetId' then
      update public.fixed_deposits f set fd_ref = v_ref, fd_ref_last4 = coalesce(f.fd_ref_last4, nullif(v_last4, ''))
       where f.household_id = p_household and f.asset_id = (r->>'assetId')::uuid;
    else
      update public.fixed_deposits f set fd_ref = v_ref
        from public.assets a left join public.institutions i on i.id = a.institution_id
       where f.household_id = p_household and a.id = f.asset_id and a.household_id = p_household
         and f.fd_ref_last4 = coalesce(nullif(r->>'last4', ''), v_last4)
         and ((r ? 'institutionId' and a.institution_id = (r->>'institutionId')::uuid)
              or (r ? 'bank' and lower(trim(i.name)) = lower(trim(r->>'bank'))));
    end if;
    get diagnostics c = row_count;
    n := n + c;
  end loop;
  return jsonb_build_object('updated', n);
end $$;
revoke all on function public.set_fd_numbers(uuid, jsonb) from public, anon;
grant execute on function public.set_fd_numbers(uuid, jsonb) to authenticated;
