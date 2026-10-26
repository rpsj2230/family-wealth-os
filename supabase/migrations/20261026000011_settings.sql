-- Everything personal or tunable lives here, not in code: people (date of birth, PAN, residency, guardian), income and spending,
-- numeric limits and reminder windows, and the tax rules for each financial year.

-- ---------------------------------------------------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------------------------------------------------
-- date of birth, last four of the PAN and tax residency already exist on owners
alter table public.owners
  add column guardian_id   uuid,
  add column plan_role     text check (plan_role is null or plan_role in ('primary', 'spouse')),
  add column notes         text check (notes is null or length(notes) <= 500),
  add constraint owners_guardian_fk foreign key (guardian_id, household_id) references public.owners (id, household_id);
create unique index owners_one_primary on public.owners (household_id) where plan_role = 'primary';
create unique index owners_one_spouse  on public.owners (household_id) where plan_role = 'spouse';

-- The full PAN is write-only, like the AI key: members can save or replace it, nobody can read it back through the app.
-- Only the fund-statement importer (service role) reads it, to open password-protected statements.
create table public.owner_pan (
  owner_id     uuid primary key,
  household_id uuid not null,
  pan          text not null check (pan ~ '^[A-Z]{5}[0-9]{4}[A-Z]$'),
  updated_at   timestamptz not null default now(),
  foreign key (owner_id, household_id) references public.owners (id, household_id) on delete cascade
);
alter table public.owner_pan enable row level security;
revoke all on public.owner_pan from anon, authenticated;
-- deliberately no policies and no grants: reads and writes go through save_owner_profile and the service role

create function public.save_owner_profile(p_household uuid, p_owner uuid, p jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v_pan text := upper(nullif(trim(p->>'pan'), ''));
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if not exists (select 1 from public.owners where id = p_owner and household_id = p_household) then raise exception 'unknown person'; end if;
  if v_pan is not null and v_pan !~ '^[A-Z]{5}[0-9]{4}[A-Z]$' then raise exception 'PAN must look like ABCDE1234F'; end if;
  update public.owners set
    dob = case when p ? 'dob' then nullif(p->>'dob', '')::date else dob end,
    tax_residency = case when p ? 'taxResidency' then coalesce(nullif(trim(p->>'taxResidency'), ''), tax_residency) else tax_residency end,
    guardian_id = case when p ? 'guardianId' then nullif(p->>'guardianId', '')::uuid else guardian_id end,
    plan_role = case when p ? 'planRole' then nullif(p->>'planRole', '') else plan_role end,
    is_minor = case when p ? 'isMinor' then (p->>'isMinor')::boolean else is_minor end,
    notes = case when p ? 'notes' then nullif(left(p->>'notes', 500), '') else notes end,
    pan_last4 = case when v_pan is not null then right(v_pan, 4) when (p ? 'clearPan') and (p->>'clearPan')::boolean then null else pan_last4 end
  where id = p_owner;
  if v_pan is not null then
    insert into public.owner_pan (owner_id, household_id, pan) values (p_owner, p_household, v_pan)
      on conflict (owner_id) do update set pan = excluded.pan, updated_at = now();
  elsif (p ? 'clearPan') and (p->>'clearPan')::boolean then
    delete from public.owner_pan where owner_id = p_owner;
  end if;
end $$;
revoke all on function public.save_owner_profile(uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_owner_profile(uuid, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- Income and spending (monthly or yearly, in any currency)
-- ---------------------------------------------------------------------------------------------------------------------
create table public.cashflow_items (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  owner_id     uuid,
  kind         text not null check (kind in ('income', 'expense')),
  label        text not null check (length(trim(label)) between 1 and 80),
  amount       numeric(18,2) not null check (amount >= 0),
  currency     char(3) not null default 'INR' check (currency ~ '^[A-Z]{3}$'),
  frequency    text not null default 'monthly' check (frequency in ('monthly', 'yearly')),
  starts_on    date,
  ends_on      date,
  notes        text check (notes is null or length(notes) <= 300),
  created_at   timestamptz not null default now(),
  check (ends_on is null or starts_on is null or ends_on >= starts_on),
  foreign key (owner_id, household_id) references public.owners (id, household_id)
);
create index cashflow_household_idx on public.cashflow_items (household_id, kind);

-- ---------------------------------------------------------------------------------------------------------------------
-- Numeric limits and reminder windows (one JSON document per household, validated by the application)
-- ---------------------------------------------------------------------------------------------------------------------
create table public.household_config (
  household_id uuid primary key references public.households on delete cascade,
  config       jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object' and pg_column_size(config) < 20000),
  updated_at   timestamptz not null default now()
);

-- Tax rules per financial year; they override the built-in defaults, so a change in law is a settings edit.
create table public.tax_rules (
  household_id  uuid not null references public.households on delete cascade,
  fy            text not null check (fy ~ '^\d{4}-\d{2}$'),
  holding_months_long int not null check (holding_months_long between 1 and 60),
  stcg_rate     numeric(7,5) not null check (stcg_rate >= 0 and stcg_rate < 1),
  ltcg_rate     numeric(7,5) not null check (ltcg_rate >= 0 and ltcg_rate < 1),
  ltcg_exemption numeric(18,2) not null check (ltcg_exemption >= 0),
  cess          numeric(7,5) not null default 0.04 check (cess >= 0 and cess < 1),
  verified      boolean not null default false,
  source_note   text check (source_note is null or length(source_note) <= 300),
  updated_at    timestamptz not null default now(),
  primary key (household_id, fy)
);

alter table public.cashflow_items   enable row level security;
alter table public.household_config enable row level security;
alter table public.tax_rules        enable row level security;
create policy cashflow_all on public.cashflow_items   for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy config_all   on public.household_config for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy taxrules_all on public.tax_rules        for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.cashflow_items, public.household_config, public.tax_rules from anon, authenticated;
grant select, insert, update, delete on public.cashflow_items, public.household_config, public.tax_rules to authenticated;
create trigger audit_cashflow after insert or update or delete on public.cashflow_items   for each row execute function public.audit_row();
create trigger audit_config   after insert or update or delete on public.household_config for each row execute function public.audit_row();
create trigger audit_taxrules after insert or update or delete on public.tax_rules        for each row execute function public.audit_row();
-- no audit trigger on owner_pan: the log would copy the number
