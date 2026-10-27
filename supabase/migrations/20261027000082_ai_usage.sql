-- AI usage log: one row per real call to an AI service (answered or not), with the tokens it used, so the AI cost page can show
-- what was spent, by day, by purpose and by model. Cost is worked out when the page is shown, from the prices in Settings, so a changed
-- price re-prices the whole history. Only counts and words are kept: never a key, never the text that was sent or received.
create table public.ai_usage (
  id                 uuid primary key default gen_random_uuid(),
  household_id       uuid not null references public.households on delete cascade,
  at                 timestamptz not null default now(),
  provider           text not null check (provider in ('anthropic','openrouter','groq','gemini')),
  model              text check (model is null or length(model) <= 120),
  purpose            text not null check (purpose in ('inbox_email','inbox_statement','rates_refresh','rates_check','rates_paste','tax_file','ai_test','other')),
  ok                 boolean not null,
  status             integer not null default 0 check (status between 0 and 999),
  input_tokens       integer not null default 0 check (input_tokens >= 0),
  output_tokens      integer not null default 0 check (output_tokens >= 0),
  cache_read_tokens  integer not null default 0 check (cache_read_tokens >= 0),
  cache_write_tokens integer not null default 0 check (cache_write_tokens >= 0),
  tokens_known       boolean not null default false,
  ms                 integer check (ms is null or ms >= 0),
  note               text check (note is null or length(note) <= 200)
);
create index ai_usage_household_at_idx on public.ai_usage (household_id, at desc);

alter table public.ai_usage enable row level security;
create policy ai_usage_read on public.ai_usage for select using (public.is_member(household_id));
revoke all on public.ai_usage from anon, authenticated;
grant select on public.ai_usage to authenticated;

-- Jobs (service role) insert directly. A signed-in member's server code records through this function, which checks membership.
create function public.record_ai_usage(
  p_household uuid, p_provider text, p_model text, p_purpose text, p_ok boolean, p_status integer,
  p_input integer, p_output integer, p_cache_read integer, p_cache_write integer, p_known boolean, p_ms integer, p_note text
) returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.ai_usage (household_id, provider, model, purpose, ok, status, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, tokens_known, ms, note)
  values (p_household, p_provider, left(p_model, 120), p_purpose, p_ok, greatest(0, least(coalesce(p_status, 0), 999)),
          greatest(0, coalesce(p_input, 0)), greatest(0, coalesce(p_output, 0)), greatest(0, coalesce(p_cache_read, 0)), greatest(0, coalesce(p_cache_write, 0)),
          coalesce(p_known, false), greatest(0, p_ms), left(p_note, 200));
end $$;
revoke all on function public.record_ai_usage(uuid, text, text, text, boolean, integer, integer, integer, integer, integer, boolean, integer, text) from public, anon;
grant execute on function public.record_ai_usage(uuid, text, text, text, boolean, integer, integer, integer, integer, integer, boolean, integer, text) to authenticated;

-- A rate page whose text has not changed since it was last read is not read again (no AI cost): the hash of what the reader was given,
-- and the day it was last read.
alter table public.rate_sources
  add column page_hash text check (page_hash is null or length(page_hash) <= 80),
  add column read_on date;
