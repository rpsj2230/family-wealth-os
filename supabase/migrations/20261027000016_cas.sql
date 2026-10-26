-- Fund statements (CAS): every transaction, so lots and gains can be worked out exactly, and a log of what was imported.
create table public.mf_transactions (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  asset_id      uuid not null,
  txn_on        date not null,
  kind          text not null check (kind in ('purchase', 'sip', 'switch_in', 'dividend_reinvest', 'bonus', 'redeem', 'switch_out', 'other')),
  amount        numeric(18,2) not null,
  units         numeric(18,4) not null,
  nav           numeric(18,4),
  balance_units numeric(18,4),
  description   text check (description is null or length(description) <= 200),
  source        text not null default 'cas',
  source_ref    text not null check (length(source_ref) between 1 and 200),
  created_at    timestamptz not null default now(),
  unique (asset_id, source_ref),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index mf_transactions_asset_idx on public.mf_transactions (household_id, asset_id, txn_on);

create table public.cas_imports (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  owner_id      uuid,
  source_ref    text not null check (length(source_ref) between 1 and 200),
  received_on   date not null default current_date,
  schemes       int not null default 0,
  transactions  int not null default 0,
  outcome       text not null check (outcome in ('imported', 'partial', 'failed')),
  detail        text check (detail is null or length(detail) <= 2000),
  created_at    timestamptz not null default now(),
  unique (household_id, source_ref),
  foreign key (owner_id, household_id) references public.owners (id, household_id)
);

alter table public.mf_positions add column isin text check (isin is null or isin ~ '^INF[0-9A-Z]{9}$');
alter table public.mf_positions add column cas_as_of date;

alter table public.mf_transactions enable row level security;
alter table public.cas_imports     enable row level security;
create policy mf_transactions_all on public.mf_transactions for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy cas_imports_all     on public.cas_imports     for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.mf_transactions, public.cas_imports from anon, authenticated;
grant select, insert, update, delete on public.mf_transactions, public.cas_imports to authenticated;
create trigger audit_cas_imports after insert or update or delete on public.cas_imports for each row execute function public.audit_row();
