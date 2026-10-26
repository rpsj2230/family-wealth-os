begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d1', 'fdn-a@example.test'),
  ('00000000-0000-0000-0000-0000000000d2', 'fdn-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000d1');
create temp table fctx as select public.create_household('FD number household') as h;
grant all on fctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Holder' from fctx;
insert into public.institutions (household_id, name) select h, 'Sample Bank' from fctx;
insert into public.assets (household_id, type, owner_id, institution_id, nickname)
  select h, 'fixed_deposit', (select id from public.owners where display_name = 'Holder'), (select id from public.institutions where name = 'Sample Bank'), 'FD one' from fctx;
insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on, compounding, fd_ref_last4)
  select (select id from public.assets where nickname = 'FD one'), h, 100000, 0.07, date '2026-01-01', date '2027-01-01', 'quarterly', '0142' from fctx;
-- by bank and last four
select t.assert((public.set_fd_numbers((select h from fctx), '[{"bank":"sample bank","last4":"0142","fdRef":"300017790142-1"}]'::jsonb)->>'updated')::int = 1, 'a number is matched by bank and last four');
select t.assert((select fd_ref = '300017790142-1' from public.fixed_deposits), 'the full number is stored');
-- by asset id, and the last four follows when none was recorded
select public.set_fd_numbers((select h from fctx), jsonb_build_array(jsonb_build_object('assetId', (select asset_id from public.fixed_deposits), 'fdRef', '300017790142-1')));
select t.assert((select fd_ref_last4 = '0142' from public.fixed_deposits), 'the last four stay in step');
-- changing the last four to something else drops the stale full number
update public.fixed_deposits set fd_ref_last4 = '9999';
select t.assert((select fd_ref is null from public.fixed_deposits), 'a stale full number is dropped');
-- bad values and outsiders
select t.assert(t.throws($q$select public.set_fd_numbers((select h from fctx), '[{"assetId":"00000000-0000-0000-0000-000000000001","fdRef":"12"}]'::jsonb)$q$), 'a short or malformed number is refused');
select t.as_user('00000000-0000-0000-0000-0000000000d2');
select t.assert(t.throws($q$select public.set_fd_numbers((select h from fctx), '[{"bank":"Sample Bank","last4":"0142","fdRef":"300017790142-1"}]'::jsonb)$q$), 'outsiders cannot set numbers');
rollback;
\echo 'ALL FD NUMBER TESTS PASSED'
