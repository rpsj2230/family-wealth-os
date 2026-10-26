-- Goals and allocations, mutual-fund opening positions, receivables, insurance policies, import batches,
-- and the transactional workbook-import function (runs with the caller's rights, so Row Level Security applies).

-- ---------------------------------------------------------------------------------------------
-- Goals (planning overlays; they never create or move money)
-- ---------------------------------------------------------------------------------------------
create table public.goals (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households on delete cascade,
  name           text not null check (length(trim(name)) > 0),
  kind           text not null default 'other' check (kind in ('education','marriage','retirement','emergency','property','other')),
  person_id      uuid,
  target_amount  numeric(18,2) check (target_amount is null or target_amount > 0),
  target_date    date,
  inflation_rate numeric(9,6) check (inflation_rate is null or (inflation_rate >= 0 and inflation_rate < 1)),
  priority       int not null default 100,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (id, household_id),
  unique (household_id, name),
  foreign key (person_id, household_id) references public.owners (id, household_id)
);

create table public.goal_allocations (
  goal_id      uuid not null,
  asset_id     uuid not null,
  household_id uuid not null,
  method       text not null check (method in ('percent','amount')),
  value        numeric(18,4) not null check (value >= 0),
  created_at   timestamptz not null default now(),
  primary key (goal_id, asset_id),
  check (method <> 'percent' or value <= 100),
  foreign key (goal_id, household_id)  references public.goals  (id, household_id) on delete cascade,
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);

-- Percent allocations of one asset can never exceed 100% in total.
create function public.goal_allocations_percent_cap() returns trigger
language plpgsql as $$
declare total numeric;
begin
  select coalesce(sum(value), 0) into total from public.goal_allocations
   where asset_id = new.asset_id and method = 'percent' and goal_id <> new.goal_id;
  if new.method = 'percent' and total + new.value > 100.0001 then
    raise exception 'percent allocations for this asset would total % (> 100)', total + new.value;
  end if;
  return new;
end $$;
create trigger goal_allocations_percent_cap before insert or update on public.goal_allocations
  for each row execute function public.goal_allocations_percent_cap();

-- ---------------------------------------------------------------------------------------------
-- Mutual-fund opening positions (until a CAS ledger replaces them) and SIP plans
-- ---------------------------------------------------------------------------------------------
create table public.mf_positions (
  asset_id      uuid primary key,
  household_id  uuid not null,
  fund_name     text not null,
  plan_type     text not null default 'regular_or_unknown' check (plan_type in ('direct','regular','regular_or_unknown')),
  invested      numeric(18,2) not null default 0 check (invested >= 0),
  started_on    date,
  sip_monthly   numeric(18,2) check (sip_monthly is null or sip_monthly > 0),
  sip_stopped   boolean not null default false,
  nav_hint      text,
  provenance    text not null default 'workbook',
  amfi_code     text,
  folio_last4   text check (folio_last4 is null or folio_last4 ~ '^[A-Za-z0-9]{1,4}$'),
  created_at    timestamptz not null default now(),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);

-- ---------------------------------------------------------------------------------------------
-- Receivables: outstanding is always lent minus repayments
-- ---------------------------------------------------------------------------------------------
create table public.receivables (
  asset_id      uuid primary key,
  household_id  uuid not null,
  counterparty  text not null check (length(trim(counterparty)) > 0),
  lent          numeric(18,2) not null check (lent > 0),
  lent_on       date,
  expected_on   date,
  interest_note text,
  created_at    timestamptz not null default now(),
  unique (asset_id, household_id),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);

create table public.receivable_payments (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null,
  asset_id      uuid not null,
  amount        numeric(18,2) not null check (amount > 0),
  paid_on       date not null,
  note          text,
  created_at    timestamptz not null default now(),
  foreign key (asset_id, household_id) references public.receivables (asset_id, household_id) on delete cascade
);
create index receivable_payments_asset_idx on public.receivable_payments (asset_id);

-- ---------------------------------------------------------------------------------------------
-- Insurance policies (coverage is information, never net worth)
-- ---------------------------------------------------------------------------------------------
create table public.policies (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households on delete cascade,
  kind           text not null check (kind in ('term','health_sg','health_in','ulip','nps','other')),
  insurer        text not null,
  coverage_text  text,
  policy_ref_last4 text check (policy_ref_last4 is null or policy_ref_last4 ~ '^[A-Za-z0-9]{1,4}$'),
  paid_by        text,
  renewal_on     date,
  expires_on     date,
  nominee_note   text,
  documents_note text,
  notes          text,
  created_at     timestamptz not null default now(),
  unique (id, household_id)
);

create table public.policy_insured (
  policy_id    uuid not null,
  owner_id     uuid not null,
  household_id uuid not null,
  primary key (policy_id, owner_id),
  foreign key (policy_id, household_id) references public.policies (id, household_id) on delete cascade,
  foreign key (owner_id, household_id)  references public.owners   (id, household_id)
);

-- ---------------------------------------------------------------------------------------------
-- Import batches: one row per imported file (idempotency + provenance)
-- ---------------------------------------------------------------------------------------------
create table public.import_batches (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  source        text not null,
  source_hash   text not null check (length(source_hash) >= 32),
  as_of         date not null,
  summary       jsonb not null default '{}'::jsonb,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (household_id, source_hash)
);

-- ---------------------------------------------------------------------------------------------
-- Audit, RLS, grants for the new tables
-- ---------------------------------------------------------------------------------------------
create trigger audit_goals            after insert or update or delete on public.goals               for each row execute function public.audit_row();
create trigger audit_goal_allocations after insert or update or delete on public.goal_allocations    for each row execute function public.audit_row();
create trigger audit_mf_positions     after insert or update or delete on public.mf_positions        for each row execute function public.audit_row();
create trigger audit_receivables      after insert or update or delete on public.receivables         for each row execute function public.audit_row();
create trigger audit_receivable_pay   after insert or update or delete on public.receivable_payments for each row execute function public.audit_row();
create trigger audit_policies         after insert or update or delete on public.policies            for each row execute function public.audit_row();
create trigger audit_import_batches   after insert or update or delete on public.import_batches      for each row execute function public.audit_row();

alter table public.goals               enable row level security;
alter table public.goal_allocations    enable row level security;
alter table public.mf_positions        enable row level security;
alter table public.receivables         enable row level security;
alter table public.receivable_payments enable row level security;
alter table public.policies            enable row level security;
alter table public.policy_insured      enable row level security;
alter table public.import_batches      enable row level security;

create policy goals_all        on public.goals               for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy goal_alloc_all   on public.goal_allocations    for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy mf_positions_all on public.mf_positions        for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy receivables_all  on public.receivables         for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy recv_pay_all     on public.receivable_payments for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy policies_all     on public.policies            for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy policy_ins_all   on public.policy_insured      for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy import_batches_r on public.import_batches      for select using (public.is_member(household_id));
create policy import_batches_i on public.import_batches      for insert with check (public.is_member(household_id));

revoke all on public.goals, public.goal_allocations, public.mf_positions, public.receivables,
  public.receivable_payments, public.policies, public.policy_insured, public.import_batches from anon, authenticated;
grant select, insert, update, delete on public.goals, public.goal_allocations, public.mf_positions, public.receivables,
  public.receivable_payments, public.policies, public.policy_insured to authenticated;
grant select, insert on public.import_batches to authenticated;

-- ---------------------------------------------------------------------------------------------
-- import_workbook_batch(household, source_hash, plan): all-or-nothing import of a planner result.
-- SECURITY INVOKER (default): every insert is checked by Row Level Security as the caller.
-- ---------------------------------------------------------------------------------------------
create function public.import_workbook_batch(p_household uuid, p_source_hash text, p_plan jsonb)
returns jsonb language plpgsql as $$
declare
  o jsonb; i jsonb; a jsonb; x jsonb; g record;
  owner_ids jsonb := '{}'::jsonb;
  inst_ids  jsonb := '{}'::jsonb;
  asset_ids jsonb := '{}'::jsonb;
  goal_ids  jsonb := '{}'::jsonb;
  new_id uuid; gid uuid; pid uuid; k text; n_assets int := 0; n_obs int := 0;
  as_of date := (p_plan->>'asOf')::date;
  goal_name text; goal_kind text;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if exists (select 1 from public.import_batches where household_id = p_household and source_hash = p_source_hash) then
    raise exception 'this file was already imported';
  end if;
  -- Refuse to import while any needs_input exception is unresolved AND not acknowledged.
  if exists (
    select 1 from jsonb_array_elements(p_plan->'exceptions') e
    where e->>'severity' = 'needs_input' and coalesce(p_plan->'acknowledged' ? (e->>'cell'), false) = false
  ) then
    raise exception 'unresolved needs_input exceptions: acknowledge each cell in plan.acknowledged first';
  end if;
  if exists (select 1 from jsonb_array_elements(p_plan->'reconciliation') r where (r->>'ok')::boolean is not true) then
    raise exception 'reconciliation failed: the plan does not match the workbook totals';
  end if;

  -- owners
  for o in select * from jsonb_array_elements(p_plan->'owners') loop
    insert into public.owners (household_id, display_name, is_minor)
      values (p_household, o->>'displayName', coalesce((o->>'isMinor')::boolean, false))
      on conflict (household_id, display_name) do update set display_name = excluded.display_name
      returning id into new_id;
    owner_ids := owner_ids || jsonb_build_object(o->>'key', new_id);
  end loop;

  -- institutions
  for i in select * from jsonb_array_elements(p_plan->'institutions') loop
    insert into public.institutions (household_id, name, kind)
      values (p_household, i->>'name', coalesce(i->>'kind', 'bank'))
      on conflict (household_id, name) do update set name = excluded.name
      returning id into new_id;
    inst_ids := inst_ids || jsonb_build_object(i->>'key', new_id);
  end loop;

  -- assets
  for a in select * from jsonb_array_elements(p_plan->'assets') loop
    insert into public.assets (household_id, type, owner_id, beneficial_owner_id, holder_name, institution_id,
                               nickname, identifier_last4, account_kind, currency, status, notes)
    values (p_household, a->>'type',
            (owner_ids->>(a->>'ownerKey'))::uuid,
            nullif(owner_ids->>(a->>'beneficialOwnerKey'), '')::uuid,
            a->>'holderName',
            nullif(inst_ids->>(a->>'institutionKey'), '')::uuid,
            a->>'nickname', a->>'identifierLast4', a->>'accountKind',
            coalesce(a->>'currency', 'INR'), coalesce(a->>'status', 'active'), a->>'notes')
    returning id into new_id;
    asset_ids := asset_ids || jsonb_build_object(a->>'key', new_id);
    n_assets := n_assets + 1;
  end loop;

  -- observations
  for x in select * from jsonb_array_elements(p_plan->'observations') loop
    insert into public.observations (household_id, asset_id, kind, amount, currency, fx_rate, as_of, source, source_ref, confidence)
    values (p_household, (asset_ids->>(x->>'assetKey'))::uuid, x->>'kind', (x->>'amount')::numeric,
            coalesce(x->>'currency', 'INR'), (x->>'fxRate')::numeric, (x->>'asOf')::date, 'workbook', x->>'sourceRef',
            coalesce(x->>'confidence', 'manual_unverified'));
    n_obs := n_obs + 1;
  end loop;

  -- fixed deposits
  for x in select * from jsonb_array_elements(p_plan->'fixedDeposits') loop
    insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount)
    values ((asset_ids->>(x->>'assetKey'))::uuid, p_household, (x->>'principal')::numeric, (x->>'rate')::numeric,
            (x->>'bookedOn')::date, (x->>'maturityOn')::date, coalesce(x->>'compounding', 'quarterly'), (x->>'bankMaturityAmount')::numeric);
  end loop;

  -- funds + goals + 100% allocation to the workbook's goal tag
  for x in select * from jsonb_array_elements(p_plan->'funds') loop
    insert into public.mf_positions (asset_id, household_id, fund_name, plan_type, invested, started_on, sip_monthly, sip_stopped, nav_hint)
    values ((asset_ids->>(x->>'assetKey'))::uuid, p_household, x->>'fundName', coalesce(x->>'planType', 'regular_or_unknown'),
            coalesce((x->>'invested')::numeric, 0), (x->>'startedOn')::date, (x->>'sipMonthly')::numeric,
            coalesce((x->>'sipStopped')::boolean, false), x->>'navHint');
    goal_name := trim(regexp_replace(x->>'goalTag', '^SIP\s+', ''));
    if goal_name <> '' then
      if not (goal_ids ? goal_name) then
        goal_kind := case when goal_name ~* 'educ' then 'education' when goal_name ~* 'marri' then 'marriage'
                          when goal_name ~* 'retire' then 'retirement' else 'other' end;
        insert into public.goals (household_id, name, kind) values (p_household, goal_name, goal_kind)
          on conflict (household_id, name) do update set name = excluded.name returning id into gid;
        goal_ids := goal_ids || jsonb_build_object(goal_name, gid);
      end if;
      insert into public.goal_allocations (goal_id, asset_id, household_id, method, value)
      values ((goal_ids->>goal_name)::uuid, (asset_ids->>(x->>'assetKey'))::uuid, p_household, 'percent', 100);
    end if;
  end loop;

  -- receivables
  for x in select * from jsonb_array_elements(p_plan->'receivables') loop
    insert into public.receivables (asset_id, household_id, counterparty, lent, lent_on, expected_on)
    values ((asset_ids->>(x->>'assetKey'))::uuid, p_household, x->>'counterparty', (x->>'lent')::numeric,
            (x->>'lentOn')::date, (x->>'expectedOn')::date);
    for a in select * from jsonb_array_elements(coalesce(x->'repayments', '[]'::jsonb)) loop
      insert into public.receivable_payments (household_id, asset_id, amount, paid_on)
      values (p_household, (asset_ids->>(x->>'assetKey'))::uuid, (a->>'amount')::numeric, (a->>'on')::date);
    end loop;
  end loop;

  -- policies
  for x in select * from jsonb_array_elements(p_plan->'policies') loop
    insert into public.policies (household_id, kind, insurer, coverage_text, paid_by, notes)
    values (p_household, x->>'kind', x->>'insurer', x->>'coverage', x->>'paidBy', x->>'note') returning id into pid;
    for k in select jsonb_array_elements_text(x->'insuredKeys') loop
      insert into public.policy_insured (policy_id, owner_id, household_id)
      values (pid, (owner_ids->>k)::uuid, p_household) on conflict do nothing;
    end loop;
  end loop;

  -- tasks
  for x in select * from jsonb_array_elements(p_plan->'tasks') loop
    insert into public.tasks (household_id, institution_id, title, status, done_at)
    values (p_household, nullif(inst_ids->>(x->>'institutionKey'), '')::uuid, x->>'title', coalesce(x->>'status', 'open'),
            case when x->>'status' = 'done' then now() end);
  end loop;

  insert into public.import_batches (household_id, source, source_hash, as_of, summary)
  values (p_household, 'workbook', p_source_hash, as_of,
          jsonb_build_object('assets', n_assets, 'observations', n_obs, 'goals', (select count(*) from jsonb_object_keys(goal_ids))));

  return jsonb_build_object('assets', n_assets, 'observations', n_obs);
end $$;

revoke all on function public.import_workbook_batch(uuid, text, jsonb) from public;
grant execute on function public.import_workbook_batch(uuid, text, jsonb) to authenticated;
