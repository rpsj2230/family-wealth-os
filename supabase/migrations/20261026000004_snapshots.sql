-- Daily net-worth snapshots: what the household looked like on a date, how it was valued and how complete it was.
create table public.snapshots (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  taken_on      date not null,
  total         numeric(18,2) not null,
  investable    numeric(18,2) not null,
  by_owner      jsonb not null default '{}'::jsonb,
  by_liquidity  jsonb not null default '{}'::jsonb,
  by_type       jsonb not null default '{}'::jsonb,
  components    jsonb not null default '{}'::jsonb,   -- anchorTotal, interest, market, fx
  basis         jsonb not null default '{}'::jsonb,   -- value by calculated / estimated / carried_forward
  counted       int not null default 0,
  excluded      int not null default 0,
  latest_recorded_as_of date,
  status        text not null check (status in ('complete','has_exclusions')),
  source        text not null default 'daily' check (source in ('daily','import','monthly_update','manual')),
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (household_id, taken_on)
);
create index snapshots_household_idx on public.snapshots (household_id, taken_on desc);

alter table public.snapshots enable row level security;
create policy snapshots_read  on public.snapshots for select using (public.is_member(household_id));
create policy snapshots_write on public.snapshots for insert with check (public.is_member(household_id));
create policy snapshots_upd   on public.snapshots for update using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.snapshots from anon, authenticated;
grant select, insert, update on public.snapshots to authenticated;

-- One snapshot per day; a later save on the same day replaces the earlier one (the day's latest knowledge wins).
create function public.save_snapshot(p_household uuid, p jsonb, p_source text default 'daily')
returns void language plpgsql as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if (p->>'takenOn')::date > current_date then raise exception 'snapshot date is in the future'; end if;
  insert into public.snapshots (household_id, taken_on, total, investable, by_owner, by_liquidity, by_type, components, basis,
                                counted, excluded, latest_recorded_as_of, status, source)
  values (p_household, (p->>'takenOn')::date, (p->>'total')::numeric, (p->>'investable')::numeric,
          coalesce(p->'byOwner', '{}'), coalesce(p->'byLiquidity', '{}'), coalesce(p->'byType', '{}'),
          coalesce(p->'components', '{}'), coalesce(p->'basis', '{}'),
          coalesce((p->>'counted')::int, 0), coalesce((p->>'excluded')::int, 0),
          (p->>'latestRecordedAsOf')::date, p->>'status', p_source)
  on conflict (household_id, taken_on) do update set
    total = excluded.total, investable = excluded.investable, by_owner = excluded.by_owner, by_liquidity = excluded.by_liquidity,
    by_type = excluded.by_type, components = excluded.components, basis = excluded.basis, counted = excluded.counted,
    excluded = excluded.excluded, latest_recorded_as_of = excluded.latest_recorded_as_of, status = excluded.status,
    source = excluded.source, created_by = auth.uid(), created_at = now();
end $$;
revoke all on function public.save_snapshot(uuid, jsonb, text) from public;
grant execute on function public.save_snapshot(uuid, jsonb, text) to authenticated;
