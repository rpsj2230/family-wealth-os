-- Several AI keys per household, with a priority, an on/off switch and a status each.
--
-- Until now one key lived in integration_settings. Now each provider (anthropic, openrouter, groq, gemini) can have one key here.
-- The jobs and the Settings actions try the enabled keys in priority order (1 first) and go to the next one when a provider fails.
--
-- Same pattern as the other secrets: the key is write-only. Members cannot select the api_key column (the grant leaves it out);
-- they write through the functions below, which check membership and never return the key; server code fetches the ordered keys through
-- ai_keys_for_server, which only household members can call. The jobs (service role) read the table directly.
-- Deliberately no audit trigger: the audit log would copy the key.
create table public.ai_keys (
  household_id      uuid not null references public.households on delete cascade,
  provider          text not null check (provider in ('anthropic','openrouter','groq','gemini')),
  api_key           text not null check (length(api_key) between 8 and 300),
  -- 1 is tried first; the functions below keep the numbers 1..n without gaps
  priority          smallint not null check (priority between 1 and 99),
  enabled           boolean not null default true,
  label             text check (label is null or length(label) between 1 and 60),
  -- what the last real use of this key did
  last_ok_at        timestamptz,
  last_model        text check (last_model is null or length(last_model) <= 100),
  last_error_at     timestamptz,
  last_error_status smallint,
  last_error        text check (last_error is null or length(last_error) <= 300),
  -- what the last test did
  tested_at         timestamptz,
  test_ok           boolean,
  test_note         text check (test_note is null or length(test_note) <= 300),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (household_id, provider)
);
create index ai_keys_order_idx on public.ai_keys (household_id, priority);

alter table public.ai_keys enable row level security;
create policy ai_keys_read on public.ai_keys for select using (public.is_member(household_id));
revoke all on public.ai_keys from anon, authenticated;
grant select (household_id, provider, priority, enabled, label, last_ok_at, last_model, last_error_at, last_error_status, last_error,
              tested_at, test_ok, test_note, created_at, updated_at)
  on public.ai_keys to authenticated;

-- Moves the single key of the old design here, as the first choice. Safe to run again: it only moves a key that is still there.
-- Kept as a function so the SQL tests exercise the same statements. Internal: not callable by users.
create function public.ai_keys_adopt_legacy()
returns void language sql security definer set search_path = public as $$
  insert into public.ai_keys (household_id, provider, api_key, priority, enabled, tested_at, test_ok, test_note)
  select household_id, ai_provider, ai_api_key, 1, true, ai_tested_at, ai_test_ok, ai_test_note
    from public.integration_settings
   where ai_api_key is not null and ai_provider is not null
  on conflict (household_id, provider) do nothing;
  update public.integration_settings
     set ai_api_key = null, ai_provider = null, ai_tested_at = null, ai_test_ok = null, ai_test_note = null
   where ai_api_key is not null;
$$;
revoke all on function public.ai_keys_adopt_legacy() from public, anon, authenticated;
select public.ai_keys_adopt_legacy();

comment on column public.integration_settings.ai_provider is 'Legacy: the AI keys now live in public.ai_keys.';
comment on column public.integration_settings.ai_api_key is 'Legacy: the AI keys now live in public.ai_keys.';
comment on column public.integration_settings.ai_key_set is 'Legacy: the AI keys now live in public.ai_keys.';

-- Internal: numbers a household's keys 1..n in their current order. Not callable by users.
create function public.ai_keys_renumber(p_household uuid)
returns void language sql security definer set search_path = public as $$
  update public.ai_keys k set priority = r.n
    from (select provider, row_number() over (order by priority, created_at, provider)::smallint as n
            from public.ai_keys where household_id = p_household) r
   where k.household_id = p_household and k.provider = r.provider and k.priority <> r.n;
$$;
revoke all on function public.ai_keys_renumber(uuid) from public, anon, authenticated;

-- Adds a key (as the last choice, switched on) or replaces the key of that provider (keeping its place and switch; its status starts over).
-- An empty key on a saved provider only changes the label.
create function public.save_ai_key(p_household uuid, p_provider text, p_key text, p_label text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if nullif(p_key, '') is null then
    update public.ai_keys
       set label = coalesce(nullif(p_label, ''), label), updated_at = now()
     where household_id = p_household and provider = p_provider;
    if not found then raise exception 'paste the key to add this provider' using errcode = '22023'; end if;
    return;
  end if;
  insert into public.ai_keys (household_id, provider, api_key, priority, label)
    values (p_household, p_provider, p_key,
            coalesce((select max(priority) from public.ai_keys where household_id = p_household), 0) + 1,
            nullif(p_label, ''))
  on conflict (household_id, provider) do update set
    api_key = excluded.api_key,
    label = coalesce(nullif(p_label, ''), public.ai_keys.label),
    last_ok_at = null, last_model = null, last_error_at = null, last_error_status = null, last_error = null,
    tested_at = null, test_ok = null, test_note = null,
    updated_at = now();
end $$;
revoke all on function public.save_ai_key(uuid, text, text, text) from public, anon;
grant execute on function public.save_ai_key(uuid, text, text, text) to authenticated;

create function public.set_ai_key_enabled(p_household uuid, p_provider text, p_enabled boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.ai_keys set enabled = p_enabled, updated_at = now() where household_id = p_household and provider = p_provider;
  if not found then raise exception 'no key is saved for this provider' using errcode = '22023'; end if;
end $$;
revoke all on function public.set_ai_key_enabled(uuid, text, boolean) from public, anon;
grant execute on function public.set_ai_key_enabled(uuid, text, boolean) to authenticated;

-- Swaps a key with its neighbour: 'up' makes it tried earlier, 'down' later. At either end nothing changes.
create function public.move_ai_key(p_household uuid, p_provider text, p_direction text)
returns void language plpgsql security definer set search_path = public as $$
declare cur smallint; target smallint;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_direction not in ('up', 'down') then raise exception 'direction must be up or down' using errcode = '22023'; end if;
  perform public.ai_keys_renumber(p_household);
  select priority into cur from public.ai_keys where household_id = p_household and provider = p_provider;
  if not found then raise exception 'no key is saved for this provider' using errcode = '22023'; end if;
  target := case when p_direction = 'up' then cur - 1 else cur + 1 end;
  if not exists (select 1 from public.ai_keys where household_id = p_household and priority = target) then return; end if;
  update public.ai_keys
     set priority = case when provider = p_provider then target else cur end, updated_at = now()
   where household_id = p_household and (provider = p_provider or priority = target);
end $$;
revoke all on function public.move_ai_key(uuid, text, text) from public, anon;
grant execute on function public.move_ai_key(uuid, text, text) to authenticated;

create function public.remove_ai_key(p_household uuid, p_provider text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  delete from public.ai_keys where household_id = p_household and provider = p_provider;
  perform public.ai_keys_renumber(p_household);
end $$;
revoke all on function public.remove_ai_key(uuid, text) from public, anon;
grant execute on function public.remove_ai_key(uuid, text) to authenticated;

-- For server code only (the app's actions): the keys in the order they are tried. By default only the ones switched on.
-- The key goes to the server code that uses it once; it is never sent to the page.
create function public.ai_keys_for_server(p_household uuid, p_all boolean default false)
returns table (provider text, api_key text, priority smallint, enabled boolean) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  return query select k.provider, k.api_key, k.priority, k.enabled from public.ai_keys k
    where k.household_id = p_household and (p_all or k.enabled)
    order by k.priority, k.created_at, k.provider;
end $$;
revoke all on function public.ai_keys_for_server(uuid, boolean) from public, anon;
grant execute on function public.ai_keys_for_server(uuid, boolean) to authenticated;

-- What a real use of the key did. A key removed meanwhile is simply not found.
create function public.record_ai_key_use(p_household uuid, p_provider text, p_ok boolean, p_status integer, p_reason text, p_model text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if p_ok then
    update public.ai_keys set last_ok_at = now(), last_model = left(p_model, 100)
     where household_id = p_household and provider = p_provider;
  else
    update public.ai_keys
       set last_error_at = now(), last_error_status = greatest(least(coalesce(p_status, 0), 999), 0), last_error = left(coalesce(p_reason, ''), 300)
     where household_id = p_household and provider = p_provider;
  end if;
end $$;
revoke all on function public.record_ai_key_use(uuid, text, boolean, integer, text, text) from public, anon;
grant execute on function public.record_ai_key_use(uuid, text, boolean, integer, text, text) to authenticated;

create function public.record_ai_key_test(p_household uuid, p_provider text, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  update public.ai_keys set tested_at = now(), test_ok = p_ok, test_note = left(coalesce(p_note, ''), 300)
   where household_id = p_household and provider = p_provider;
end $$;
revoke all on function public.record_ai_key_test(uuid, text, boolean, text) from public, anon;
grant execute on function public.record_ai_key_test(uuid, text, boolean, text) to authenticated;

-- Compatibility with the single-key functions: the label still lives in integration_settings; a key passed here is saved in ai_keys,
-- and "clear" removes the key of that provider (every key when no provider is given).
create or replace function public.save_integrations(p_household uuid, p_provider text, p_key text, p_label text, p_clear boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.integration_settings (household_id, inbox_label)
    values (p_household, coalesce(nullif(p_label, ''), 'FWOS/Inbox'))
  on conflict (household_id) do update set
    inbox_label = coalesce(nullif(p_label, ''), public.integration_settings.inbox_label),
    updated_at  = now();
  if p_clear then
    delete from public.ai_keys where household_id = p_household and (p_provider is null or provider = p_provider);
    perform public.ai_keys_renumber(p_household);
  elsif nullif(p_key, '') is not null then
    perform public.save_ai_key(p_household, p_provider, p_key, null);
  end if;
end $$;

-- The key of the first choice among those switched on (what the single-key test used).
create or replace function public.ai_credentials_for_test(p_household uuid)
returns table (provider text, api_key text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  return query select k.provider, k.api_key from public.ai_keys k
    where k.household_id = p_household and k.enabled
    order by k.priority, k.created_at, k.provider limit 1;
end $$;

create or replace function public.record_ai_test(p_household uuid, p_ok boolean, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare first_provider text;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select k.provider into first_provider from public.ai_keys k
    where k.household_id = p_household and k.enabled order by k.priority, k.created_at, k.provider limit 1;
  if first_provider is not null then
    perform public.record_ai_key_test(p_household, first_provider, p_ok, p_note);
  end if;
end $$;
