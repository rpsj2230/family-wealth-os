-- Net-worth history rebuilt from the monthly tabs: past month ends worked out by the app from what is on file (balances, deposit terms,
-- fund units and prices), stored next to the snapshots taken on the day. A day's own snapshot is always the authority; a rebuilt row only
-- ever fills a day that has none (or replaces an older rebuilt row of the same day). Nothing is deleted.

alter table public.snapshots drop constraint snapshots_source_check;
alter table public.snapshots
  add constraint snapshots_source_check check (source in ('daily','import','monthly_update','manual','rebuilt'));
comment on column public.snapshots.source is
  'Where the row came from. rebuilt: worked out afterwards from the history on file (not recorded on the day); every other value was recorded on the day.';

-- Adds rebuilt rows for past days. p is an array of the same payloads save_snapshot takes. Idempotent: running it again leaves the same rows.
-- A day that already has a row recorded on the day is skipped, never overwritten. Returns how many rows were added or refreshed.
create function public.backfill_snapshots(p_household uuid, p jsonb)
returns int language plpgsql as $$
declare
  item jsonb;
  n int := 0;
  got int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'expected an array of snapshots'; end if;
  for item in select * from jsonb_array_elements(p) loop
    if (item->>'takenOn')::date >= current_date then raise exception 'a rebuilt snapshot must be for a day before today'; end if;
    insert into public.snapshots (household_id, taken_on, total, investable, by_owner, by_liquidity, by_type, components, basis,
                                  counted, excluded, latest_recorded_as_of, status, source)
    values (p_household, (item->>'takenOn')::date, (item->>'total')::numeric, (item->>'investable')::numeric,
            coalesce(item->'byOwner', '{}'), coalesce(item->'byLiquidity', '{}'), coalesce(item->'byType', '{}'),
            coalesce(item->'components', '{}'), coalesce(item->'basis', '{}'),
            coalesce((item->>'counted')::int, 0), coalesce((item->>'excluded')::int, 0),
            (item->>'latestRecordedAsOf')::date, item->>'status', 'rebuilt')
    on conflict (household_id, taken_on) do update set
      total = excluded.total, investable = excluded.investable, by_owner = excluded.by_owner, by_liquidity = excluded.by_liquidity,
      by_type = excluded.by_type, components = excluded.components, basis = excluded.basis, counted = excluded.counted,
      excluded = excluded.excluded, latest_recorded_as_of = excluded.latest_recorded_as_of, status = excluded.status,
      created_by = auth.uid(), created_at = now()
    where public.snapshots.source = 'rebuilt';
    get diagnostics got = row_count;
    n := n + got;
  end loop;
  return n;
end $$;
revoke all on function public.backfill_snapshots(uuid, jsonb) from public;
grant execute on function public.backfill_snapshots(uuid, jsonb) to authenticated;
