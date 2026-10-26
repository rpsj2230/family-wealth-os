-- Sync with Google Sheet. The household keeps a Google Sheet with one tab per month; the app can write its figures into the month's tab
-- through a Google service account (free). Two things are stored per household:
--   gsheet_id    the spreadsheet's id (the long text in its address). Not a secret: it can be read back and shown.
--   gsheet_key   the service account's JSON key. Write-only like the AI key: a member can save it, no page can read it back. It is
--                fetched once, in server code, by a function only household members can call.
-- Deliberately no audit trigger on integration_settings: the audit log would copy the key.
alter table public.integration_settings
  add column gsheet_id         text check (gsheet_id is null or gsheet_id ~ '^[A-Za-z0-9_-]{20,120}$'),
  add column gsheet_email      text check (gsheet_email is null or (length(gsheet_email) <= 200 and gsheet_email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][^@[:space:]]+$')),
  add column gsheet_key        text check (gsheet_key is null or length(gsheet_key) between 200 and 20000),
  add column gsheet_key_set    boolean generated always as (gsheet_key is not null) stored,
  add column gsheet_tested_at  timestamptz,
  add column gsheet_test_ok    boolean,
  add column gsheet_test_note  text check (gsheet_test_note is null or length(gsheet_test_note) <= 300),
  add column gsheet_synced_at  timestamptz,
  add column gsheet_sync_ok    boolean,
  add column gsheet_sync_month text check (gsheet_sync_month is null or length(gsheet_sync_month) <= 40),
  add column gsheet_sync_note  text check (gsheet_sync_note is null or length(gsheet_sync_note) <= 300),
  add column gsheet_syncing_at timestamptz;

-- The key and the "a sync is running" marker are not granted: every other column is readable by members (row level security applies).
grant select (gsheet_id, gsheet_email, gsheet_key_set, gsheet_tested_at, gsheet_test_ok, gsheet_test_note,
              gsheet_synced_at, gsheet_sync_ok, gsheet_sync_month, gsheet_sync_note)
  on public.integration_settings to authenticated;

-- Saves the spreadsheet id and/or the key. An empty value keeps what is saved. A new id or key clears the last test result.
-- p_clear removes the whole connection.
create function public.save_gsheet(p_household uuid, p_sheet_id text, p_key text, p_email text, p_clear boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.integration_settings (household_id, gsheet_id, gsheet_key, gsheet_email)
    values (p_household,
            case when p_clear then null else nullif(p_sheet_id, '') end,
            case when p_clear then null else nullif(p_key, '') end,
            case when p_clear then null else nullif(p_email, '') end)
  on conflict (household_id) do update set
    gsheet_id    = case when p_clear then null else coalesce(nullif(p_sheet_id, ''), public.integration_settings.gsheet_id) end,
    gsheet_key   = case when p_clear then null else coalesce(nullif(p_key, ''), public.integration_settings.gsheet_key) end,
    gsheet_email = case when p_clear then null
                        when nullif(p_key, '') is not null then nullif(p_email, '')
                        else public.integration_settings.gsheet_email end,
    gsheet_tested_at = case when p_clear or nullif(p_key, '') is not null or nullif(p_sheet_id, '') is not null then null else public.integration_settings.gsheet_tested_at end,
    gsheet_test_ok   = case when p_clear or nullif(p_key, '') is not null or nullif(p_sheet_id, '') is not null then null else public.integration_settings.gsheet_test_ok end,
    gsheet_test_note = case when p_clear or nullif(p_key, '') is not null or nullif(p_sheet_id, '') is not null then null else public.integration_settings.gsheet_test_note end,
    gsheet_synced_at  = case when p_clear then null else public.integration_settings.gsheet_synced_at end,
    gsheet_sync_ok    = case when p_clear then null else public.integration_settings.gsheet_sync_ok end,
    gsheet_sync_month = case when p_clear then null else public.integration_settings.gsheet_sync_month end,
    gsheet_sync_note  = case when p_clear then null else public.integration_settings.gsheet_sync_note end,
    gsheet_syncing_at = case when p_clear then null else public.integration_settings.gsheet_syncing_at end,
    updated_at = now();
end $$;
revoke all on function public.save_gsheet(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.save_gsheet(uuid, text, text, text, boolean) to authenticated;

-- The saved id and key, for the test and the sync. Called from server code only, used once, never returned to the browser.
create function public.gsheet_credentials(p_household uuid)
returns table (sheet_id text, service_key text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  return query select s.gsheet_id, s.gsheet_key from public.integration_settings s
    where s.household_id = p_household and s.gsheet_id is not null and s.gsheet_key is not null;
end $$;
revoke all on function public.gsheet_credentials(uuid) from public, anon;
grant execute on function public.gsheet_credentials(uuid) to authenticated;

create function public.record_gsheet_test(p_household uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.integration_settings
     set gsheet_tested_at = now(), gsheet_test_ok = p_ok, gsheet_test_note = left(coalesce(p_note, ''), 300)
   where household_id = p_household;
end $$;
revoke all on function public.record_gsheet_test(uuid, boolean, text) from public, anon;
grant execute on function public.record_gsheet_test(uuid, boolean, text) to authenticated;

-- Only one sync runs at a time: a second press (or a second person) is told to wait. The claim lapses after two minutes, longer than the
-- 60 seconds a page may run, so a sync that was cut off never blocks the next one for long.
create function public.claim_gsheet_sync(p_household uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare claimed int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.integration_settings
     set gsheet_syncing_at = now()
   where household_id = p_household and gsheet_key is not null
     and (gsheet_syncing_at is null or gsheet_syncing_at < now() - interval '2 minutes');
  get diagnostics claimed = row_count;
  return claimed > 0;
end $$;
revoke all on function public.claim_gsheet_sync(uuid) from public, anon;
grant execute on function public.claim_gsheet_sync(uuid) to authenticated;

-- Ends a sync (done or failed): remembers when, for which month and how it went, and lets the next one start.
create function public.record_gsheet_sync(p_household uuid, p_ok boolean, p_month text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.integration_settings
     set gsheet_synced_at = now(), gsheet_sync_ok = p_ok, gsheet_sync_month = left(coalesce(p_month, ''), 40),
         gsheet_sync_note = left(coalesce(p_note, ''), 300), gsheet_syncing_at = null
   where household_id = p_household;
end $$;
revoke all on function public.record_gsheet_sync(uuid, boolean, text, text) from public, anon;
grant execute on function public.record_gsheet_sync(uuid, boolean, text, text) to authenticated;
