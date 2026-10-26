-- Automatic daily summary on Telegram (free, no phone number or business account needed). The bot token is write-only like the AI key:
-- a member can save it, only the scheduled job can read it. The chat ids (a person, or a family group) can be read back.
alter table public.integration_settings
  add column telegram_bot_token text check (telegram_bot_token is null or length(telegram_bot_token) between 20 and 200),
  add column telegram_chat_ids  text check (telegram_chat_ids is null or telegram_chat_ids ~ '^-?[0-9]+(,-?[0-9]+)*$' and length(telegram_chat_ids) <= 200),
  add column telegram_set       boolean generated always as (telegram_bot_token is not null and telegram_chat_ids is not null) stored;

grant select (telegram_chat_ids, telegram_set) on public.integration_settings to authenticated;

alter table public.digest_log drop constraint digest_log_channel_check;
alter table public.digest_log add constraint digest_log_channel_check check (channel in ('email', 'telegram'));

create function public.save_telegram(p_household uuid, p_token text, p_chat_ids text, p_clear boolean default false)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.integration_settings (household_id, telegram_bot_token, telegram_chat_ids)
    values (p_household, case when p_clear then null else nullif(p_token, '') end, case when p_clear then null else nullif(p_chat_ids, '') end)
  on conflict (household_id) do update set
    telegram_bot_token = case when p_clear then null else coalesce(nullif(p_token, ''), public.integration_settings.telegram_bot_token) end,
    telegram_chat_ids  = case when p_clear then null else coalesce(nullif(p_chat_ids, ''), public.integration_settings.telegram_chat_ids) end,
    updated_at = now();
end $$;
revoke all on function public.save_telegram(uuid, text, text, boolean) from public, anon;
grant execute on function public.save_telegram(uuid, text, text, boolean) to authenticated;
