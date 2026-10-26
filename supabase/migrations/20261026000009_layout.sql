-- Keep the layout of the Excel sheet: the order accounts are kept in, the original labels, joint flags, links between a
-- fixed deposit and its savings account (by last four digits), and the last four digits of each FD number.
alter table public.assets
  add column label       text check (label is null or length(label) <= 200),
  add column sort_order  numeric(12,4),
  add column is_joint    boolean not null default false,
  add column linked_last4 text check (linked_last4 is null or linked_last4 ~ '^[A-Za-z0-9-]{1,4}$');
alter table public.fixed_deposits
  add column fd_ref_last4 text check (fd_ref_last4 is null or fd_ref_last4 ~ '^[A-Za-z0-9-]{1,4}$');
create index assets_sort_idx on public.assets (household_id, sort_order);

-- Applies the layout from a freshly read workbook to the records that already exist. Values (balances, deposits' money terms)
-- are never changed. Matching: deposits by owner + bank + amount + dates; everything else by the sheet cell its first value
-- came from. Anything that cannot be matched is reported, not guessed.
create function public.sync_workbook_layout(p_household uuid, p_plan jsonb)
returns jsonb language plpgsql as $$
declare
  a jsonb; v_fd jsonb; v_ob jsonb; found uuid; matched int := 0; unmatched jsonb := '[]'::jsonb;
  owner_name text; inst_name text; o_id uuid; i_id uuid; src text;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  for a in select * from jsonb_array_elements(p_plan->'assets') loop
    found := null;
    select o->>'displayName' into owner_name from jsonb_array_elements(p_plan->'owners') o where o->>'key' = a->>'ownerKey';
    select i->>'name' into inst_name from jsonb_array_elements(p_plan->'institutions') i where i->>'key' = a->>'institutionKey';
    select id into o_id from public.owners where household_id = p_household and display_name = owner_name;
    select id into i_id from public.institutions where household_id = p_household and name = inst_name;

    if a->>'type' = 'fixed_deposit' then
      select f into v_fd from jsonb_array_elements(p_plan->'fixedDeposits') f where f->>'assetKey' = a->>'key';
      select x.id into found from public.assets x join public.fixed_deposits d on d.asset_id = x.id
        where x.household_id = p_household and x.owner_id = o_id and x.institution_id is not distinct from i_id
          and d.principal = (v_fd->>'principal')::numeric and d.booked_on = (v_fd->>'bookedOn')::date and d.maturity_on = (v_fd->>'maturityOn')::date
          and x.sort_order is null
        order by x.created_at limit 1;
    else
      select x into v_ob from jsonb_array_elements(p_plan->'observations') x where x->>'assetKey' = a->>'key' limit 1;
      src := v_ob->>'sourceRef';
      if src is not null then
        select x.id into found from public.assets x join public.observations v on v.asset_id = x.id
          where x.household_id = p_household and v.source = 'workbook' and v.source_ref = src and x.sort_order is null
          order by v.created_at limit 1;
      end if;
    end if;

    if found is null then
      unmatched := unmatched || jsonb_build_array(coalesce(a->>'label', a->>'nickname'));
      continue;
    end if;
    update public.assets set
      label = a->>'label',
      sort_order = nullif(a->>'row', '')::numeric,
      is_joint = coalesce((a->>'isJoint')::boolean, false),
      account_kind = case when a->>'accountKind' in ('NRE','NRO') then a->>'accountKind' else account_kind end,
      identifier_last4 = coalesce(nullif(a->>'identifierLast4', ''), identifier_last4),
      linked_last4 = case when a->>'type' = 'fixed_deposit' then nullif(a->>'identifierLast4', '') else null end,
      notes = a->>'notes'
    where id = found;
    if a->>'type' = 'fixed_deposit' then
      update public.fixed_deposits set fd_ref_last4 = nullif(v_fd->>'refLast4', '') where asset_id = found;
    end if;
    matched := matched + 1;
  end loop;
  return jsonb_build_object('matched', matched, 'unmatched', unmatched);
end $$;
revoke all on function public.sync_workbook_layout(uuid, jsonb) from public, anon;
grant execute on function public.sync_workbook_layout(uuid, jsonb) to authenticated;

