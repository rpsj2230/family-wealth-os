-- Confirmed money movements: the input of the capital and earnings ledger (core capital.ts) and of the savings estimates.
--
-- One row is one sum that moved on one day, from a holding to another, into the family from outside, or out of it:
--  - from_asset_id null: the money came from outside the family's accounts (salary, a gift received, the sale of something not tracked);
--  - to_asset_id null: it left the family's accounts (spent, given, taken out);
--  - both set: a transfer between the family's own holdings (savings to a new deposit, maturity proceeds to a savings account). A transfer
--    never changes the family's own money put in, and never counts as profit.
-- kind says what it was, so the ledger can tell maturity proceeds (fd_proceeds), the funding of a new deposit (fd_funding), interest a
-- payout deposit paid to an account (interest_payout), outside money (contribution / withdrawal), income, fees, taxes and an
-- adjustment you classified after a balance did not match the estimate. Only status 'confirmed' rows are used in any figure; a
-- 'suggested' row is the app's proposal waiting for your approval, and 'rejected' keeps a refused one so it is not proposed again.
-- idem_key makes a write repeatable: writing the same movement twice (a double click, a re-run job) changes nothing.
create table public.money_moves (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  moved_on      date not null,
  amount        numeric(18,2) not null check (amount > 0),
  currency      text not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  from_asset_id uuid,
  to_asset_id   uuid,
  kind          text not null check (kind in ('contribution', 'withdrawal', 'transfer', 'fd_proceeds', 'fd_funding', 'interest_payout', 'income', 'fee', 'tax', 'adjustment')),
  status        text not null default 'confirmed' check (status in ('confirmed', 'suggested', 'rejected')),
  source        text not null default 'manual' check (source in ('manual', 'suggested', 'email', 'statement', 'rule', 'import')),
  note          text check (note is null or length(note) <= 300),
  idem_key      text check (idem_key is null or length(idem_key) between 1 and 200),
  created_at    timestamptz not null default now(),
  created_by    uuid default auth.uid(),
  check (from_asset_id is not null or to_asset_id is not null),
  check (from_asset_id is distinct from to_asset_id),
  unique (household_id, idem_key),
  foreign key (from_asset_id, household_id) references public.assets (id, household_id) on delete cascade,
  foreign key (to_asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index money_moves_from_idx on public.money_moves (household_id, from_asset_id, moved_on);
create index money_moves_to_idx on public.money_moves (household_id, to_asset_id, moved_on);
create index money_moves_on_idx on public.money_moves (household_id, moved_on);

alter table public.money_moves enable row level security;
create policy money_moves_all on public.money_moves for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.money_moves from anon, authenticated;
grant select, insert, update, delete on public.money_moves to authenticated;
create trigger audit_money_moves after insert or update or delete on public.money_moves for each row execute function public.audit_row();

-- How a bank applies its savings slabs: the whole balance at the rate of the slab it falls in, or each part of the balance at its own
-- slab's rate. Empty: the household's setting (Settings > Estimates).
alter table public.institutions
  add column savings_slab_method text check (savings_slab_method is null or savings_slab_method in ('whole', 'incremental'));

-- The history of an account's own interest rate, so a change applies from its effective date and never rewrites the past. Written by a
-- trigger whenever the rate on an account changes (the day of the change is its effective date); the app reads it as rate steps.
create table public.asset_rate_history (
  id            bigint generated always as identity primary key,
  household_id  uuid not null,
  asset_id      uuid not null,
  effective_on  date not null default current_date,
  old_rate      numeric(9,6),
  new_rate      numeric(9,6),
  created_at    timestamptz not null default now(),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index asset_rate_history_idx on public.asset_rate_history (household_id, asset_id, effective_on);

create function public.assets_rate_history() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.interest_rate is distinct from old.interest_rate then
    insert into public.asset_rate_history (household_id, asset_id, effective_on, old_rate, new_rate)
    values (new.household_id, new.id, current_date, old.interest_rate, new.interest_rate);
  end if;
  return new;
end $$;
create trigger assets_rate_history after update of interest_rate on public.assets
  for each row execute function public.assets_rate_history();

alter table public.asset_rate_history enable row level security;
create policy asset_rate_history_read on public.asset_rate_history for select using (public.is_member(household_id));
revoke all on public.asset_rate_history from anon, authenticated;
grant select on public.asset_rate_history to authenticated;
