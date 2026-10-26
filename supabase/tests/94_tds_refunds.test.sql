begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ad', 'r-a@example.test'), ('00000000-0000-0000-0000-0000000000bd', 'r-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table rctx as select public.create_household('Refund household') as h;
grant all on rctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from rctx;
create temp table ro as select id as p from public.owners where display_name = 'Parent';
grant all on ro to authenticated;

insert into public.tds_refunds (household_id, owner_id, fy, expected_gain, expected_tds, expected_refund)
  select h, (select p from ro), '2026-27', 125000, 15625, 15625 from rctx;
select t.assert((select count(*) from public.tds_refunds) = 1, 'a refund record can be created');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy, expected_gain, expected_tds, expected_refund) select h, (select p from ro), '2026-27', 1, 1, 1 from rctx$q$), 'one record per person, year and kind');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy, expected_tds, expected_refund) select h, (select p from ro), '2027-28', -5, 0 from rctx$q$), 'negative amounts refused');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy, status) select h, (select p from ro), '2027-28', 'lost' from rctx$q$), 'unknown status refused');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy) select h, gen_random_uuid(), '2027-28' from rctx$q$), 'the person must belong to the household');
update public.tds_refunds set status = 'withheld', actual_tds = 15000;
select t.assert((select status = 'withheld' and actual_tds = 15000 from public.tds_refunds), 'progress can be recorded');

insert into public.tds_refunds (household_id, owner_id, fy, kind, expected_gain, expected_tds, expected_refund)
  select h, (select p from ro), '2026-27', 'interest', 150000, 46800, 46800 from rctx;
select t.assert((select count(*) from public.tds_refunds where fy = '2026-27') = 2, 'harvest and interest refunds sit side by side');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy, kind) select h, (select p from ro), '2026-27', 'bogus' from rctx$q$), 'unknown kind refused');

select t.as_user('00000000-0000-0000-0000-0000000000bd');
select t.assert((select count(*) from public.tds_refunds) = 0, 'outsiders see nothing');
select t.assert(t.throws($q$insert into public.tds_refunds (household_id, owner_id, fy) select h, (select p from ro), '2028-29' from rctx$q$), 'outsiders cannot add records');
select t.as_root();
rollback;
\echo 'ALL REFUND TESTS PASSED'
