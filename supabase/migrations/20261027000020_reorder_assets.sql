-- Drag-to-reorder: the order of banks and rows is the sort_order of the assets. The listed assets get 1..n in the given order;
-- every other asset keeps its relative order and is placed after them, so nothing is scrambled and numbers never grow.
create function public.reorder_assets(p_household uuid, p_ids uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int := coalesce(cardinality(p_ids), 0);
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if n = 0 then return 0; end if;
  if n > 500 then raise exception 'too many assets in one save'; end if;
  if (select count(distinct x) from unnest(p_ids) x) <> n then raise exception 'an asset is listed twice'; end if;
  if (select count(*) from public.assets where household_id = p_household and id = any (p_ids)) <> n then
    raise exception 'unknown asset in the list';
  end if;

  update public.assets a set sort_order = o.pos
  from unnest(p_ids) with ordinality as o(id, pos)
  where a.id = o.id and a.household_id = p_household;

  update public.assets a set sort_order = n + r.rk
  from (
    select id, row_number() over (order by sort_order, created_at, id) as rk
    from public.assets
    where household_id = p_household and not (id = any (p_ids)) and sort_order is not null
  ) r
  where a.id = r.id;
  return n;
end $$;
revoke all on function public.reorder_assets(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_assets(uuid, uuid[]) to authenticated;
