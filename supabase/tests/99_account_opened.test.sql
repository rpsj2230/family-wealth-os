begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a4', 'o-a@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
create temp table octx as select public.create_household('Opened household') as h;
grant all on octx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from octx;
insert into public.assets (household_id, type, owner_id, nickname)
  select h, 'bank_account', (select id from public.owners where display_name = 'Parent'), 'Sample savings' from octx;
update public.assets set opened_on = '2020-12-19', opened_after = '2020-11-01', opened_note = 'Between two diary notes';
select t.assert((select opened_on from public.assets) = '2020-12-19', 'an opening window can be stored');
select t.assert(t.throws($q$update public.assets set opened_after = '2021-01-01'$q$), 'the window cannot end before it starts');
update public.assets set opened_on = null, opened_after = null;
select t.assert((select opened_on is null from public.assets), 'it can be left unknown');
select t.as_root();
rollback;
\echo 'ALL ACCOUNT OPENED TESTS PASSED'
