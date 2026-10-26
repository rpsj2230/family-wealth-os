begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a4', 's-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b4', 's-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
create temp table sctx as select public.create_household('Snapshot household') as h;
grant all on sctx to authenticated;

select public.save_snapshot((select h from sctx),
  jsonb_build_object('takenOn', to_char(current_date,'YYYY-MM-DD'), 'total', 1000, 'investable', 600, 'counted', 3, 'excluded', 1, 'status', 'has_exclusions',
                     'byOwner', jsonb_build_object('x', 1000)), 'daily');
select t.assert((select count(*) from public.snapshots) = 1, 'snapshot stored');
select public.save_snapshot((select h from sctx),
  jsonb_build_object('takenOn', to_char(current_date,'YYYY-MM-DD'), 'total', 1200, 'investable', 700, 'status', 'complete'), 'monthly_update');
select t.assert((select count(*) from public.snapshots) = 1, 'same day replaces, not duplicates');
select t.assert((select total from public.snapshots) = 1200 and (select source from public.snapshots) = 'monthly_update', 'latest knowledge of the day wins');
select t.assert(t.throws($q$select public.save_snapshot((select h from sctx), jsonb_build_object('takenOn', to_char(current_date+1,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'complete'))$q$), 'future snapshot rejected');
select t.assert(t.throws($q$select public.save_snapshot((select h from sctx), jsonb_build_object('takenOn', to_char(current_date-1,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'bogus'))$q$), 'invalid status rejected');

select t.as_user('00000000-0000-0000-0000-0000000000b4');
select t.assert((select count(*) from public.snapshots) = 0, 'outsider cannot read snapshots');
select t.assert(t.throws($q$select public.save_snapshot((select h from sctx), jsonb_build_object('takenOn', to_char(current_date-2,'YYYY-MM-DD'), 'total', 1, 'investable', 1, 'status', 'complete'))$q$), 'outsider cannot write snapshots');
select t.as_root();
rollback;
\echo 'ALL SNAPSHOT TESTS PASSED'
