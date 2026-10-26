-- A log of every change to a rate (what it was, what it became, who or what changed it and why), and what the refresh learns
-- when you correct a rate it read wrongly.
alter table public.rate_offers
  add column ai_rate         numeric(7,5) check (ai_rate is null or (ai_rate > 0 and ai_rate < 0.3)),
  add column correction_reason text check (correction_reason is null or correction_reason in ('senior_citizen', 'wrong_tenure', 'wrong_slab', 'nro_nre', 'outdated', 'other')),
  add column corrected_on    date,
  add column page_rate       numeric(7,5) check (page_rate is null or (page_rate > 0 and page_rate < 0.3)),
  add column page_seen_on    date,
  add column misread_count   int not null default 0 check (misread_count >= 0);

create table public.rate_events (
  id                 bigint generated always as identity primary key,
  household_id       uuid not null references public.households on delete cascade,
  at                 timestamptz not null default now(),
  bank               text not null,
  product            text not null check (product in ('savings', 'fd')),
  account_kind       text not null,
  tenure_from_months int not null default 0,
  tenure_to_months   int not null default 0,
  balance_from       numeric(16,2),
  balance_to         numeric(16,2),
  kind               text not null check (kind in ('added', 'changed', 'corrected', 'confirmed', 'removed')),
  old_rate           numeric(7,5),
  new_rate           numeric(7,5),
  source             text not null check (source in ('manual', 'ai')),
  reason             text,
  by_user            uuid default auth.uid()
);
create index rate_events_bank_idx on public.rate_events (household_id, bank, at desc);
alter table public.rate_events enable row level security;
create policy rate_events_read on public.rate_events for select using (public.is_member(household_id));
create policy rate_events_write on public.rate_events for insert with check (public.is_member(household_id));
revoke all on public.rate_events from anon, authenticated;
grant select, insert on public.rate_events to authenticated;

-- What the refresh should remember about a bank's page: short rules written when a rate was corrected, fed to the reader next time.
create table public.rate_hints (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  bank         text not null check (length(trim(bank)) between 1 and 80),
  cause        text not null check (length(cause) <= 40),
  hint         text not null check (length(hint) between 1 and 400),
  created_on   date not null default current_date,
  active       boolean not null default true
);
create index rate_hints_bank_idx on public.rate_hints (household_id, bank);
alter table public.rate_hints enable row level security;
create policy rate_hints_all on public.rate_hints for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.rate_hints from anon, authenticated;
grant select, insert, update, delete on public.rate_hints to authenticated;

create function public.rate_offers_log() returns trigger language plpgsql as $$
declare k text; r numeric; o numeric; s text; why text;
begin
  if tg_op = 'INSERT' then
    k := 'added'; o := null; r := new.rate; s := new.source_kind; why := null;
  elsif tg_op = 'DELETE' then
    k := 'removed'; o := old.rate; r := null; s := old.source_kind; why := null;
  else
    if new.rate is distinct from old.rate then
      o := old.rate; r := new.rate; s := new.source_kind;
      if new.source_kind = 'manual' and old.source_kind = 'ai' then k := 'corrected'; why := new.correction_reason;
      else k := 'changed'; why := null; end if;
    elsif new.source_kind = 'ai' and old.source_kind = 'manual' and old.ai_rate is not null then
      k := 'confirmed'; o := old.rate; r := new.rate; s := 'ai'; why := old.correction_reason;
    else
      return new;
    end if;
  end if;
  insert into public.rate_events (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, balance_from, balance_to, kind, old_rate, new_rate, source, reason)
  select coalesce(new.household_id, old.household_id), coalesce(new.bank, old.bank), coalesce(new.product, old.product), coalesce(new.account_kind, old.account_kind),
         coalesce(new.tenure_from_months, old.tenure_from_months), coalesce(new.tenure_to_months, old.tenure_to_months),
         case when tg_op = 'DELETE' then old.balance_from else new.balance_from end, case when tg_op = 'DELETE' then old.balance_to else new.balance_to end,
         k, o, r, s, why;
  return coalesce(new, old);
end $$;
create trigger rate_offers_log_ins after insert or update or delete on public.rate_offers for each row execute function public.rate_offers_log();
