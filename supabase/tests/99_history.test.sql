begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'hist-a@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'hist-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table hctx as select public.create_household('History household') as h;
grant all on hctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Holder' from hctx;
insert into public.institutions (household_id, name) select h, 'Sample Bank' from hctx;

-- a closed deposit added from the older tabs: closed, flagged as estimated, with its end date
insert into public.assets (household_id, type, owner_id, institution_id, nickname, status, from_history)
  select h, 'fixed_deposit', (select id from public.owners where display_name = 'Holder'),
         (select id from public.institutions where name = 'Sample Bank'), 'Old FD', 'closed', true from hctx;
insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on, ended_on, ended_estimated, start_estimated)
  select (select id from public.assets where nickname = 'Old FD'), h, 100000, 0.07, date '2022-01-10', date '2023-01-10', date '2023-01-10', true, true from hctx;
select t.assert((select ended_estimated and start_estimated and ended_on = date '2023-01-10' from public.fixed_deposits), 'a historical deposit keeps its estimated end date and flags');
select t.assert((select from_history from public.assets where nickname = 'Old FD'), 'the asset is marked as added from history');

-- it cannot end before it was booked
select t.assert(t.throws($q$update public.fixed_deposits set ended_on = date '2021-12-31'$q$), 'an end date before the booking date is refused');

-- a running deposit has no end date and the flags default to false
insert into public.assets (household_id, type, owner_id, institution_id, nickname)
  select h, 'fixed_deposit', (select id from public.owners where display_name = 'Holder'),
         (select id from public.institutions where name = 'Sample Bank'), 'Running FD' from hctx;
insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on)
  select (select id from public.assets where nickname = 'Running FD'), h, 50000, 0.07, date '2026-01-10', date '2027-01-10' from hctx;
select t.assert((select ended_on is null and not ended_estimated and not start_estimated from public.fixed_deposits where principal = 50000), 'a running deposit has no end date and no flags');

-- a history value: the only change an observation allows later is being marked as replaced
insert into public.assets (household_id, type, owner_id, institution_id, nickname)
  select h, 'bank_account', (select id from public.owners where display_name = 'Holder'),
         (select id from public.institutions where name = 'Sample Bank'), 'Savings' from hctx;
insert into public.observations (household_id, asset_id, kind, amount, as_of, source, source_ref, confidence)
  select h, (select id from public.assets where nickname = 'Savings'), 'balance', 1000, date '2024-03-31', 'workbook', 'hist:Mar 2024:F5', 'imported_unverified' from hctx;
insert into public.observations (household_id, asset_id, kind, amount, as_of, source, source_ref, confidence)
  select h, (select id from public.assets where nickname = 'Savings'), 'balance', 1200, date '2024-03-31', 'workbook', 'hist:Mar 2024:F5', 'imported_unverified' from hctx;
update public.observations set superseded_by = (select id from public.observations where amount = 1200) where amount = 1000;
select t.assert((select superseded_by is not null from public.observations where amount = 1000), 'an older value can be marked as replaced');
select t.assert(t.throws($q$update public.observations set amount = 1 where amount = 1200$q$), 'a value itself can never be changed');
select t.assert(t.throws($q$delete from public.observations where amount = 1000$q$), 'a value can never be deleted');

-- an outsider sees none of it
select t.as_user('00000000-0000-0000-0000-0000000000e2');
select t.assert((select count(*) from public.fixed_deposits) = 0, 'outsiders see no deposits');
select t.assert((select count(*) from public.observations) = 0, 'outsiders see no values');
rollback;
\echo 'ALL HISTORY TESTS PASSED'
