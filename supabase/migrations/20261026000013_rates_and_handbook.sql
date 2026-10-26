-- Interest-rate comparison and the family handbook.

-- any role that belongs to the household, including the read-only emergency viewer
create function public.has_access(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members m where m.household_id = h and m.user_id = auth.uid())
$$;
revoke all on function public.has_access(uuid) from public, anon;
grant execute on function public.has_access(uuid) to authenticated;

-- Rates currently on offer. `source_kind` says how a row got here: typed by you, or read from a bank page by the AI.
create table public.rate_offers (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  bank          text not null check (length(trim(bank)) between 1 and 80),
  product       text not null check (product in ('savings', 'fd')),
  account_kind  text not null default 'any' check (account_kind in ('NRE', 'NRO', 'resident', 'any')),
  tenure_from_months int not null default 0 check (tenure_from_months between 0 and 240),
  tenure_to_months   int not null default 0 check (tenure_to_months between 0 and 240),
  rate          numeric(7,5) not null check (rate > 0 and rate < 0.3),
  conditions    text check (conditions is null or length(conditions) <= 200),
  source_url    text check (source_url is null or length(source_url) <= 500),
  source_kind   text not null default 'manual' check (source_kind in ('manual', 'ai')),
  checked_on    date not null default current_date,
  created_at    timestamptz not null default now(),
  check (tenure_to_months >= tenure_from_months),
  unique (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months)
);

-- Pages the refresh job reads (a bank's published rate page). Added in Settings, never built into the code.
create table public.rate_sources (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  bank         text not null check (length(trim(bank)) between 1 and 80),
  url          text not null check (url ~ '^https://' and length(url) <= 500),
  enabled      boolean not null default true,
  last_run_on  date,
  last_result  text check (last_result is null or length(last_result) <= 300),
  unique (household_id, url)
);

-- Information the family needs that is not a balance: who to call, where documents are, a message.
create table public.emergency_profile (
  household_id uuid primary key references public.households on delete cascade,
  content      jsonb not null default '{}'::jsonb check (jsonb_typeof(content) = 'object' and pg_column_size(content) < 40000),
  updated_at   timestamptz not null default now()
);

-- The handbook itself: generated from the records and stored, so the read-only emergency viewer can open it without
-- having access to any financial table.
create table public.emergency_documents (
  household_id uuid primary key references public.households on delete cascade,
  content      jsonb not null,
  generated_at timestamptz not null default now(),
  check (pg_column_size(content) < 400000)
);

alter table public.rate_offers         enable row level security;
alter table public.rate_sources        enable row level security;
alter table public.emergency_profile   enable row level security;
alter table public.emergency_documents enable row level security;
create policy rates_all    on public.rate_offers       for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy sources_all  on public.rate_sources      for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy eprofile_all on public.emergency_profile for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy edoc_read    on public.emergency_documents for select using (public.has_access(household_id));
revoke all on public.rate_offers, public.rate_sources, public.emergency_profile, public.emergency_documents from anon, authenticated;
grant select, insert, update, delete on public.rate_offers, public.rate_sources, public.emergency_profile to authenticated;
grant select on public.emergency_documents to authenticated;

-- Members refresh the handbook (the nightly job does it too, as the service role).
create function public.save_emergency_document(p_household uuid, p_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  insert into public.emergency_documents (household_id, content, generated_at) values (p_household, p_content, now())
    on conflict (household_id) do update set content = excluded.content, generated_at = now();
end $$;
revoke all on function public.save_emergency_document(uuid, jsonb) from public, anon;
grant execute on function public.save_emergency_document(uuid, jsonb) to authenticated;

create trigger audit_rates   after insert or update or delete on public.rate_offers  for each row execute function public.audit_row();
create trigger audit_sources after insert or update or delete on public.rate_sources for each row execute function public.audit_row();
