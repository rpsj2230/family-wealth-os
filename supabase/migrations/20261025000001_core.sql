-- Family Wealth OS — core schema v1 (identity, assets, observations, FDs, tasks, audit) with Row Level Security.
-- Principles: append-only observations, tenant (household) isolation enforced by composite foreign keys,
-- masked identifiers only (last 4), explicit grants, no direct audit writes.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------------------------
-- Households and membership
-- ---------------------------------------------------------------------------------------------
create table public.households (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households on delete cascade,
  user_id      uuid not null references auth.users on delete cascade,
  role         text not null check (role in ('admin','member','emergency_viewer')),
  created_at   timestamptz not null default now(),
  primary key (household_id, user_id)
);
create index household_members_user_idx on public.household_members (user_id);

-- Full members (admin or member) can see and edit financial data. emergency_viewer is deliberately excluded:
-- it will only ever see the emergency tables, and only after an approved access request (Phase 8).
create function public.is_member(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = auth.uid() and m.role in ('admin','member')
  )
$$;

create function public.is_admin(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.household_members m
    where m.household_id = h and m.user_id = auth.uid() and m.role = 'admin'
  )
$$;

-- Bootstrap: a signed-in user creates a household and becomes its admin.
create function public.create_household(p_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare h uuid;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  insert into public.households(name) values (p_name) returning id into h;
  insert into public.household_members(household_id, user_id, role) values (h, auth.uid(), 'admin');
  return h;
end $$;

-- An admin adds an existing user (e.g. spouse) by email.
create function public.add_household_member(p_household uuid, p_email text, p_role text default 'member')
returns void language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not public.is_admin(p_household) then raise exception 'admin only'; end if;
  select id into u from auth.users where lower(email) = lower(p_email);
  if u is null then raise exception 'no user with that email'; end if;
  insert into public.household_members(household_id, user_id, role) values (p_household, u, p_role)
  on conflict (household_id, user_id) do update set role = excluded.role;
end $$;

-- Keep-alive for the free Supabase tier (called daily by a scheduled job). Returns no data.
create function public.ping() returns text
language sql stable security definer set search_path = public as $$ select 'ok'::text $$;

-- ---------------------------------------------------------------------------------------------
-- People, institutions, assets
-- ---------------------------------------------------------------------------------------------
create table public.owners (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  display_name  text not null check (length(trim(display_name)) > 0),
  pan_last4     text check (pan_last4 ~ '^[A-Za-z0-9]{4}$'),   -- never the full PAN
  is_minor      boolean not null default false,
  tax_residency text not null default 'NRI',
  dob           date,
  created_at    timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, display_name)
);

create table public.institutions (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  name         text not null check (length(trim(name)) > 0),
  kind         text not null default 'bank' check (kind in ('bank','amc','insurer','broker','government','person','other')),
  created_at   timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, name)
);

create table public.assets (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households on delete cascade,
  type                 text not null check (type in
    ('bank_account','fixed_deposit','mutual_fund','stock','receivable','policy','property','ulip','nps','third_party_held','other')),
  owner_id             uuid not null,
  beneficial_owner_id  uuid,
  holder_name          text,                    -- set when held in someone else's name
  institution_id       uuid,
  nickname             text not null check (length(trim(nickname)) > 0),
  identifier_last4     text check (identifier_last4 ~ '^[A-Za-z0-9-]{1,4}$'),
  account_kind         text check (account_kind in ('NRE','NRO','FCNR','SB','resident','joint','other')),
  currency             char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  status               text not null default 'active'
                       check (status in ('active','matured','matured_unconfirmed','renewed','closed','stopped')),
  expected_freshness_days int not null default 35 check (expected_freshness_days > 0),
  notes                text,
  created_at           timestamptz not null default now(),
  unique (id, household_id),
  foreign key (owner_id, household_id) references public.owners (id, household_id),
  foreign key (beneficial_owner_id, household_id) references public.owners (id, household_id),
  foreign key (institution_id, household_id) references public.institutions (id, household_id),
  unique (household_id, institution_id, owner_id, type, nickname)
);
create index assets_household_idx on public.assets (household_id, type);

-- ---------------------------------------------------------------------------------------------
-- Observations: append-only facts about the value of an asset on a date
-- ---------------------------------------------------------------------------------------------
create table public.observations (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  asset_id      uuid not null,
  kind          text not null check (kind in ('balance','ledger_balance','available_balance','valuation','accrued_value')),
  amount        numeric(18,2) not null,
  currency      char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  fx_rate       numeric(18,4) check (fx_rate is null or fx_rate > 0),   -- INR per 1 unit of `currency`
  as_of         date not null,                  -- the date the value represents
  received_at   timestamptz,                    -- when the email/file arrived (kept separate from as_of)
  source        text not null check (source in ('manual','email','statement','cas','workbook','api','calculated')),
  source_ref    text,
  confidence    text not null check (confidence in ('verified','manual_confirmed','imported_unverified','manual_unverified','estimated')),
  superseded_by uuid references public.observations,
  note          text,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  foreign key (asset_id, household_id) references public.assets (id, household_id)
);
create index observations_asset_asof_idx on public.observations (asset_id, as_of desc, created_at desc);

create function public.observations_append_only() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'observations are append-only: add a correcting observation instead';
  end if;
  -- the only permitted change is marking a row as superseded
  if (to_jsonb(new) - 'superseded_by') is distinct from (to_jsonb(old) - 'superseded_by') then
    raise exception 'observations are append-only: only superseded_by may change';
  end if;
  return new;
end $$;
create trigger observations_append_only before update or delete on public.observations
  for each row execute function public.observations_append_only();

-- ---------------------------------------------------------------------------------------------
-- Fixed deposits
-- ---------------------------------------------------------------------------------------------
create table public.fixed_deposits (
  asset_id              uuid primary key,
  household_id          uuid not null,
  principal             numeric(18,2) not null check (principal > 0),
  rate                  numeric(9,6)  not null check (rate >= 0 and rate < 1),
  booked_on             date not null,
  maturity_on           date not null,
  compounding           text not null default 'quarterly' check (compounding in ('monthly','quarterly','half_yearly','yearly','simple')),
  payout                text not null default 'cumulative' check (payout in ('cumulative','monthly','quarterly','half_yearly','yearly')),
  bank_maturity_amount  numeric(18,2) check (bank_maturity_amount is null or bank_maturity_amount > 0),
  renewed_from          uuid references public.fixed_deposits (asset_id),
  maturity_instruction  text,
  created_at            timestamptz not null default now(),
  check (maturity_on > booked_on),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Tasks (address/KYC/maturity-instruction items from the old spreadsheet's "Changes Req" column)
-- ---------------------------------------------------------------------------------------------
create table public.tasks (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households on delete cascade,
  asset_id       uuid,
  institution_id uuid,
  title          text not null check (length(trim(title)) > 0),
  status         text not null default 'open' check (status in ('open','done','dropped')),
  due_on         date,
  created_at     timestamptz not null default now(),
  done_at        timestamptz,
  foreign key (asset_id, household_id) references public.assets (id, household_id),
  foreign key (institution_id, household_id) references public.institutions (id, household_id)
);

-- ---------------------------------------------------------------------------------------------
-- Audit trail (written only by trigger)
-- ---------------------------------------------------------------------------------------------
create table public.audit_events (
  id            bigint generated always as identity primary key,
  household_id  uuid,
  actor         uuid,
  table_name    text not null,
  row_id        text,
  action        text not null,
  before        jsonb,
  after         jsonb,
  at            timestamptz not null default now()
);
create index audit_events_household_idx on public.audit_events (household_id, at desc);

create function public.audit_row() returns trigger
language plpgsql security definer set search_path = public as $$
declare j jsonb;
begin
  j := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  insert into public.audit_events (household_id, actor, table_name, row_id, action, before, after)
  values ((j->>'household_id')::uuid, auth.uid(), tg_table_name, coalesce(j->>'id', j->>'asset_id'), tg_op,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return null;
end $$;

create trigger audit_owners       after insert or update or delete on public.owners          for each row execute function public.audit_row();
create trigger audit_institutions after insert or update or delete on public.institutions    for each row execute function public.audit_row();
create trigger audit_assets       after insert or update or delete on public.assets          for each row execute function public.audit_row();
create trigger audit_observations after insert or update or delete on public.observations    for each row execute function public.audit_row();
create trigger audit_fds          after insert or update or delete on public.fixed_deposits  for each row execute function public.audit_row();
create trigger audit_tasks        after insert or update or delete on public.tasks           for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------------------------
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.owners            enable row level security;
alter table public.institutions      enable row level security;
alter table public.assets            enable row level security;
alter table public.observations      enable row level security;
alter table public.fixed_deposits    enable row level security;
alter table public.tasks             enable row level security;
alter table public.audit_events      enable row level security;

create policy households_read on public.households for select using (public.is_member(id));
create policy households_update on public.households for update using (public.is_admin(id)) with check (public.is_admin(id));

-- Members can see co-members; only admins change membership (and only through add_household_member).
create policy members_read on public.household_members for select
  using (user_id = auth.uid() or public.is_member(household_id));

create policy owners_all        on public.owners         for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy institutions_all  on public.institutions  for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy assets_all        on public.assets        for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy observations_read on public.observations  for select using (public.is_member(household_id));
create policy observations_add  on public.observations  for insert with check (public.is_member(household_id));
create policy observations_mark on public.observations  for update using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy fds_all           on public.fixed_deposits for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy tasks_all         on public.tasks         for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy audit_read        on public.audit_events  for select using (public.is_member(household_id));

-- ---------------------------------------------------------------------------------------------
-- Grants: nothing for anon; authenticated gets only what RLS then narrows.
-- ---------------------------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
grant select, update on public.households to authenticated;
grant select on public.household_members to authenticated;
grant select, insert, update, delete on public.owners, public.institutions, public.assets,
      public.fixed_deposits, public.tasks to authenticated;
grant select, insert, update on public.observations to authenticated;
grant select on public.audit_events to authenticated;

revoke all on function public.create_household(text), public.add_household_member(uuid, text, text),
      public.is_member(uuid), public.is_admin(uuid) from public;
grant execute on function public.create_household(text), public.add_household_member(uuid, text, text),
      public.is_member(uuid), public.is_admin(uuid) to authenticated;
grant execute on function public.ping() to anon, authenticated;
