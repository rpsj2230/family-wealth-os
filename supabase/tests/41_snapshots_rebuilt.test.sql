begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'r-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b5', 'r-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
create temp table rctx as select public.create_household('Rebuilt household') as h;
grant all on rctx to authenticated;

-- a snapshot recorded on the day (a past day) is authoritative
select public.save_snapshot((select h from rctx),
  jsonb_build_object('takenOn', to_char(current_date-40,'YYYY-MM-DD'), 'total', 1000, 'investable', 600, 'status', 'complete'), 'monthly_update');

select t.assert(public.backfill_snapshots((select h from rctx), jsonb_build_array(
  jsonb_build_object('takenOn', to_char(current_date-40,'YYYY-MM-DD'), 'total', 111, 'investable', 1, 'status', 'complete'),
  jsonb_build_object('takenOn', to_char(current_date-70,'YYYY-MM-DD'), 'total', 700, 'investable', 400, 'counted', 5, 'excluded', 2, 'status', 'has_exclusions'),
  jsonb_build_object('takenOn', to_char(current_date-100,'YYYY-MM-DD'), 'total', 500, 'investable', 300, 'status', 'complete')
)) = 2, 'two new days added; the day recorded on the day is skipped');
select t.assert((select total from public.snapshots where taken_on = current_date-40) = 1000, 'the snapshot recorded on the day is never overwritten');
select t.assert((select source from public.snapshots where taken_on = current_date-40) = 'monthly_update', 'and keeps its source');
select t.assert((select source from public.snapshots where taken_on = current_date-70) = 'rebuilt', 'a rebuilt row says it is rebuilt');
select t.assert((select count(*) from public.snapshots) = 3, 'three days in all');

-- idempotent and refreshing: the same day rebuilt again takes the newer figure
select t.assert(public.backfill_snapshots((select h from rctx), jsonb_build_array(
  jsonb_build_object('takenOn', to_char(current_date-70,'YYYY-MM-DD'), 'total', 710, 'investable', 400, 'status', 'complete')
)) = 1, 'a rebuilt day is refreshed');
select t.assert((select total from public.snapshots where taken_on = current_date-70) = 710, 'with the newer figure');
select t.assert((select count(*) from public.snapshots) = 3, 'and not duplicated');

-- a snapshot of that day replaces the rebuilt one (the day's own knowledge wins)
select public.save_snapshot((select h from rctx),
  jsonb_build_object('takenOn', to_char(current_date-70,'YYYY-MM-DD'), 'total', 725, 'investable', 400, 'status', 'complete'), 'import');
select t.assert((select source from public.snapshots where taken_on = current_date-70) = 'import', 'a snapshot of the day replaces the rebuilt one');
select t.assert(public.backfill_snapshots((select h from rctx), jsonb_build_array(
  jsonb_build_object('takenOn', to_char(current_date-70,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'complete')
)) = 0, 'and it is not rebuilt over again');
select t.assert((select total from public.snapshots where taken_on = current_date-70) = 725, 'still the recorded figure');

select t.assert(t.throws($q$select public.backfill_snapshots((select h from rctx), jsonb_build_array(jsonb_build_object('takenOn', to_char(current_date,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'complete')))$q$), 'today cannot be rebuilt');
select t.assert(t.throws($q$select public.backfill_snapshots((select h from rctx), jsonb_build_array(jsonb_build_object('takenOn', to_char(current_date-5,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'bogus')))$q$), 'a bad status is rejected');

select t.as_user('00000000-0000-0000-0000-0000000000b5');
select t.assert((select count(*) from public.snapshots) = 0, 'an outsider cannot read the rebuilt history');
select t.assert(t.throws($q$select public.backfill_snapshots((select h from rctx), jsonb_build_array(jsonb_build_object('takenOn', to_char(current_date-5,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'complete')))$q$), 'an outsider cannot write it');
select t.as_root();
rollback;
\echo 'ALL REBUILT SNAPSHOT TESTS PASSED'
