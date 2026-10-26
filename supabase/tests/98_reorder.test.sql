begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'o-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b8', 'o-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
create temp table octx as select public.create_household('Order household') as h;
grant all on octx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from octx;
create temp table oo as select id as o from public.owners limit 1;
grant all on oo to authenticated;
insert into public.assets (household_id, type, owner_id, nickname, sort_order)
  select h, 'bank_account', (select o from oo), x.n, x.s
  from octx, (values ('A1', 10), ('A2', 20), ('A3', 30), ('X', 5)) as x(n, s);
create temp table oa as select nickname as n, id from public.assets;
grant all on oa to authenticated;

select t.assert(public.reorder_assets((select h from octx), array[(select id from oa where n='A3'), (select id from oa where n='A1')]) = 2, 'two assets were ordered');
select t.assert((select sort_order from public.assets where nickname='A3') = 1 and (select sort_order from public.assets where nickname='A1') = 2, 'the listed assets take positions 1 and 2 in the given order');
select t.assert((select sort_order from public.assets where nickname='X') = 3 and (select sort_order from public.assets where nickname='A2') = 4, 'the others keep their relative order and follow');
select public.reorder_assets((select h from octx), array[(select id from oa where n='A3'), (select id from oa where n='A1')]);
select t.assert((select max(sort_order) from public.assets) = 4, 'saving again does not make the numbers grow');
select t.assert(public.reorder_assets((select h from octx), array[]::uuid[]) = 0, 'an empty list changes nothing');
select t.assert(t.throws($q$select public.reorder_assets((select h from octx), array[(select id from oa where n='A1'), (select id from oa where n='A1')])$q$), 'an asset cannot be listed twice');
select t.assert(t.throws($q$select public.reorder_assets((select h from octx), array[gen_random_uuid()])$q$), 'an unknown asset is refused');
select t.assert(t.throws($q$select public.reorder_assets((select h from octx), (select array_agg(gen_random_uuid()) from generate_series(1, 501)))$q$), 'more than 500 assets in one save is refused');

select t.as_user('00000000-0000-0000-0000-0000000000b8');
create temp table octx2 as select public.create_household('Other household') as h;
grant all on octx2 to authenticated;
select t.assert(t.throws($q$select public.reorder_assets((select h from octx), array[(select id from oa where n='A1')])$q$), 'outsiders cannot reorder');
select t.assert(t.throws($q$select public.reorder_assets((select h from octx2), array[(select id from oa where n='A1')])$q$), 'an asset of another household is refused');
select t.as_root();
select t.assert((select sort_order from public.assets where nickname='A3') = 1, 'nothing changed from the outsiders attempts');
rollback;
\echo 'ALL REORDER TESTS PASSED'
