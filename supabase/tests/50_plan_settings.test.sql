begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a5', 'p-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b5', 'p-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
create temp table pctx as select public.create_household('Plan household') as h;
grant all on pctx to authenticated;
insert into public.plan_settings (household_id, settings) select h, '{"retireAtAge": 60, "monthlySpending": 150000}' from pctx;
select t.assert((select (settings->>'retireAtAge')::int from public.plan_settings) = 60, 'settings saved');
update public.plan_settings set settings = '{"retireAtAge": 55}';
select t.assert((select (settings->>'retireAtAge')::int from public.plan_settings) = 55, 'settings updated');
select t.assert(t.throws($q$update public.plan_settings set settings = '[1,2]'$q$), 'settings must be an object');
select t.assert((select count(*) from public.audit_events where table_name = 'plan_settings') = 2, 'changes audited');
select t.as_user('00000000-0000-0000-0000-0000000000b5');
select t.assert((select count(*) from public.plan_settings) = 0, 'outsider cannot read settings');
select t.assert(t.throws($q$update public.plan_settings set settings = '{}'$q$) or (select count(*) from public.plan_settings) = 0, 'outsider cannot change settings');
select t.as_root();
rollback;
\echo 'ALL PLAN SETTINGS TESTS PASSED'
