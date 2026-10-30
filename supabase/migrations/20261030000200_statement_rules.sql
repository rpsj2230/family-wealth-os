-- Rules for bank statement lines (Explain movements > Bank statements > Rules): what you have said about a person or a word, kept so
-- every line that names them, past and future, is placed the same way without being asked again (core statement-classify.ts).
--   name:     the person as you write them, or the words a line carries ("Arjun", "Krunal Dhansukhlal / Swati Krunalkumar",
--             "autopay"); several spellings are joined with " / "
--   match:    'name' compares the bank's spelling of a name (vowels may differ, a name may be run together); 'words' looks for the
--             words as written
--   action:   own     money moved to or from one of your holdings (asset_id): a flat you bought, the account in Singapore
--             loan    money lent to, or paid back by, someone with a "Loan to …" record (asset_id); with interest, a small payment
--                     from them while money is owed is their interest
--             out     spending; outside: money from outside; income and rent: earnings
--   direction: which lines it is for: money in, money out, or both
-- Additive only: nothing existing changes. Members of the household read and write their own rules.
create table public.statement_rules (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (length(trim(name)) between 2 and 160),
  match        text not null default 'name' check (match in ('name', 'words')),
  action       text not null check (action in ('own', 'loan', 'out', 'outside', 'income', 'rent')),
  asset_id     uuid references public.assets on delete cascade,
  direction    text not null default 'any' check (direction in ('in', 'out', 'any')),
  interest     boolean not null default false,
  note         text check (note is null or length(note) <= 300),
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  check ((action in ('own', 'loan')) = (asset_id is not null))
);
create index statement_rules_household_idx on public.statement_rules (household_id);
alter table public.statement_rules enable row level security;
create policy statement_rules_all on public.statement_rules for all
  using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.statement_rules from anon, authenticated;
grant select, insert, update, delete on public.statement_rules to authenticated;
create trigger audit_statement_rules after insert or update or delete on public.statement_rules
  for each row execute function public.audit_row();
