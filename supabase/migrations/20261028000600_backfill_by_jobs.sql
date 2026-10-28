-- The net-worth history can also be rebuilt by the household's own scheduled and by-hand jobs (they run as the service role, with no
-- signed-in person), for example after old diary notes are imported. Members keep the same rights; nobody else gains any.
create or replace function public.backfill_snapshots(p_household uuid, p jsonb)
returns int language plpgsql as $$
declare
  item jsonb;
  n int := 0;
  got int;
begin
  if not (public.is_member(p_household) or current_user = 'service_role') then raise exception 'not a member of this household'; end if;
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
grant execute on function public.backfill_snapshots(uuid, jsonb) to service_role;
