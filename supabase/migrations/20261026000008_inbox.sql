-- Bank-email inbox: a log of every message the reader looked at, and write-only storage for the AI key.
--
-- inbox_messages: one row per email. `outcome` says what happened:
--   applied       a rule-based reading from the bank's own address matched exactly one account and was recorded
--   needs_review  a reading exists but is not safe to apply alone (AI-read, unverified sender, no or several accounts)
--   ignored       not a balance or statement email
--   error         the reader failed on this message (reason says why)
create table public.inbox_messages (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  message_id   text not null check (length(message_id) between 1 and 500),
  received_on  date,
  from_domain  text,
  subject      text check (subject is null or length(subject) <= 300),
  outcome      text not null check (outcome in ('applied','needs_review','ignored','error')),
  reason       text check (reason is null or length(reason) <= 500),
  reading      jsonb,
  asset_id     uuid,
  resolved_at  timestamptz,
  created_at   timestamptz not null default now(),
  unique (household_id, message_id),
  foreign key (asset_id, household_id) references public.assets (id, household_id)
);
create index inbox_messages_review_idx on public.inbox_messages (household_id, created_at desc) where outcome = 'needs_review' and resolved_at is null;

-- Integration settings. The AI key can be written by a member but never read back through the app:
-- only the reader job (service role) can select it. `ai_key_set` tells the page whether a key exists.
create table public.integration_settings (
  household_id uuid primary key references public.households on delete cascade,
  ai_provider  text check (ai_provider in ('groq','gemini')),
  ai_api_key   text check (ai_api_key is null or length(ai_api_key) between 8 and 300),
  ai_key_set   boolean generated always as (ai_api_key is not null) stored,
  inbox_label  text not null default 'FWOS/Inbox' check (length(inbox_label) between 1 and 100),
  updated_at   timestamptz not null default now()
);

alter table public.inbox_messages       enable row level security;
alter table public.integration_settings enable row level security;
create policy inbox_read   on public.inbox_messages for select using (public.is_member(household_id));
create policy inbox_review on public.inbox_messages for update using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy integration_all on public.integration_settings for all using (public.is_member(household_id)) with check (public.is_member(household_id));

revoke all on public.inbox_messages, public.integration_settings from anon, authenticated;
grant select on public.inbox_messages to authenticated;
grant update (resolved_at) on public.inbox_messages to authenticated;
grant select (household_id, ai_provider, ai_key_set, inbox_label, updated_at) on public.integration_settings to authenticated;
-- No direct insert or update: writes go through save_integrations, which checks membership and never returns the key.
create function public.save_integrations(p_household uuid, p_provider text, p_key text, p_label text, p_clear boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.integration_settings (household_id, ai_provider, ai_api_key, inbox_label)
    values (p_household,
            case when p_clear then null else p_provider end,
            case when p_clear then null else nullif(p_key, '') end,
            coalesce(nullif(p_label, ''), 'FWOS/Inbox'))
  on conflict (household_id) do update set
    ai_provider = case when p_clear then null else coalesce(p_provider, public.integration_settings.ai_provider) end,
    ai_api_key  = case when p_clear then null else coalesce(nullif(p_key, ''), public.integration_settings.ai_api_key) end,
    inbox_label = coalesce(nullif(p_label, ''), public.integration_settings.inbox_label),
    updated_at  = now();
end $$;
revoke all on function public.save_integrations(uuid, text, text, text, boolean) from public, anon;
grant execute on function public.save_integrations(uuid, text, text, text, boolean) to authenticated;

create trigger audit_inbox after insert or update or delete on public.inbox_messages for each row execute function public.audit_row();
-- Deliberately no audit trigger on integration_settings: the audit log would copy the key.
