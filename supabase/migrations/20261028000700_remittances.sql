-- Money sent from Singapore to the Indian accounts (Wise transfers): the root of the money trail. One row per transfer: when it arrived,
-- the rupees received, and (when known) the Singapore dollars sent and the fee. from_asset_id is the Singapore account it left; to_asset_id
-- the Indian account it reached, with how that is known (to_basis): 'statement' (the credit is in the account's statement), 'balances'
-- (worked out from the balances recorded before and after), 'only_open' (the only one of the accounts it could have gone to that was open),
-- 'person' (you said so), or empty while it cannot be told. The movement the ledger uses is written from it (money_moves, idem key wise:...).
create table public.remittances (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  provider      text not null default 'wise' check (provider in ('wise', 'bank', 'other')),
  provider_ref  text check (provider_ref is null or length(provider_ref) <= 60),
  sent_at       timestamptz,
  received_on   date not null,
  amount_inr    numeric(18,2) not null check (amount_inr > 0),
  amount_fx     numeric(18,2) check (amount_fx is null or amount_fx > 0),
  currency_fx   char(3) check (currency_fx is null or currency_fx ~ '^[A-Z]{3}$'),
  fee_fx        numeric(18,2) check (fee_fx is null or fee_fx >= 0),
  from_asset_id uuid,
  to_asset_id   uuid,
  to_basis      text check (to_basis is null or to_basis in ('statement', 'balances', 'only_open', 'person')),
  to_note       text check (to_note is null or length(to_note) <= 300),
  idem_key      text not null check (length(idem_key) between 1 and 120),
  created_at    timestamptz not null default now(),
  unique (household_id, idem_key),
  check ((to_asset_id is null) = (to_basis is null)),
  foreign key (from_asset_id, household_id) references public.assets (id, household_id) on delete set null (from_asset_id),
  foreign key (to_asset_id, household_id) references public.assets (id, household_id) on delete set null (to_asset_id)
);
create index remittances_on_idx on public.remittances (household_id, received_on);
alter table public.remittances enable row level security;
create policy remittances_all on public.remittances for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.remittances from anon, authenticated;
grant select, insert, update, delete on public.remittances to authenticated;
create trigger audit_remittances after insert or update or delete on public.remittances for each row execute function public.audit_row();
-- when the account a transfer reached is removed, how it was known goes with it
create function public.remittances_clear_basis() returns trigger language plpgsql as $$
begin
  if new.to_asset_id is null then new.to_basis := null; new.to_note := null; end if;
  return new;
end $$;
create trigger remittances_clear_basis before insert or update on public.remittances
  for each row execute function public.remittances_clear_basis();
