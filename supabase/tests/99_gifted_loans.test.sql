begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c9', 'gift@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000c9');
create temp table gctx as select public.create_household('Gift household') as h;
grant all on gctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Giver' from gctx;
insert into public.assets (household_id, type, owner_id, nickname, status)
  select h, 'receivable', (select id from public.owners where display_name = 'Giver'), 'Gift to a cousin', 'gifted' from gctx;
select t.assert((select status = 'gifted' from public.assets where nickname = 'Gift to a cousin'), 'an asset can be marked as a gift');
update public.assets set status = 'active' where nickname = 'Gift to a cousin';
select t.assert((select status = 'active' from public.assets where nickname = 'Gift to a cousin'), 'a gift can be counted as a loan again');
rollback;
\echo 'ALL GIFTED LOAN TESTS PASSED'
