-- The Settings page can test the AI connection. The key still never leaves the server: the test runs in the app's server code,
-- which receives the key through a function that only household members can call, uses it once and returns only the outcome.
alter table public.integration_settings
  add column ai_tested_at timestamptz,
  add column ai_test_ok boolean,
  add column ai_test_note text check (ai_test_note is null or length(ai_test_note) <= 300);
grant select (ai_tested_at, ai_test_ok, ai_test_note) on public.integration_settings to authenticated;

create function public.ai_credentials_for_test(p_household uuid)
returns table (provider text, api_key text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  return query select s.ai_provider, s.ai_api_key from public.integration_settings s
    where s.household_id = p_household and s.ai_api_key is not null and s.ai_provider is not null;
end $$;
revoke all on function public.ai_credentials_for_test(uuid) from public, anon;
grant execute on function public.ai_credentials_for_test(uuid) to authenticated;

create function public.record_ai_test(p_household uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.integration_settings
     set ai_tested_at = now(), ai_test_ok = p_ok, ai_test_note = left(coalesce(p_note, ''), 300)
   where household_id = p_household;
end $$;
revoke all on function public.record_ai_test(uuid, boolean, text) from public, anon;
grant execute on function public.record_ai_test(uuid, boolean, text) to authenticated;
