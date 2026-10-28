-- Funds without a price source: matching a fund to its official scheme from the Match funds tab.
--
--  - mf_positions.no_price_source: the person has said "this is not a listed fund" (a fund that has no official scheme, so no daily
--    price). The fund keeps its last recorded value, labelled "no price source", and is no longer counted as waiting for a match. Nothing
--    else changes; matching it to a scheme later clears the mark.
--  - store_scheme_navs: when a fund is matched, the app fetches that one scheme's price history once so the value is there at once
--    instead of after tonight's job. The price tables are written only by the scheduled job (service role), so this function lets a
--    member of a household that HOLDS the scheme add price rows for it, and nothing else: rows are only added (a day already stored is
--    never changed), only for a scheme one of the household's funds is matched to, a bounded number at a time.
alter table public.mf_positions add column if not exists no_price_source boolean not null default false;

create function public.store_scheme_navs(p_household uuid, p_code text, p_rows jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if not exists (select 1 from public.mf_positions where household_id = p_household and amfi_code = p_code) then
    raise exception 'none of this household''s funds is matched to that scheme';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then raise exception 'the prices must be a list'; end if;
  if jsonb_array_length(p_rows) > 5000 then raise exception 'too many prices in one call (5000 at most)'; end if;
  insert into public.mf_navs (amfi_code, nav_date, nav, source)
  select p_code, (r->>'nav_date')::date, (r->>'nav')::numeric, 'mfapi'
  from jsonb_array_elements(p_rows) r
  where (r->>'nav')::numeric > 0
  on conflict (amfi_code, nav_date) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.store_scheme_navs(uuid, text, jsonb) from public;
grant execute on function public.store_scheme_navs(uuid, text, jsonb) to authenticated;
