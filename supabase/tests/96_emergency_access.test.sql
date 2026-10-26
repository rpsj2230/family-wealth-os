begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000af', 'e-a@example.test'),
  ('00000000-0000-0000-0000-0000000000bf', 'e-b@example.test'),
  ('00000000-0000-0000-0000-0000000000cf', 'e-v@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000af');
create temp table ectx as select public.create_household('Access household') as h;
grant all on ectx to authenticated;
select t.as_root();
insert into public.household_members (household_id, user_id, role) select h, '00000000-0000-0000-0000-0000000000cf', 'emergency_viewer' from ectx;
select t.as_user('00000000-0000-0000-0000-0000000000af');
select public.save_emergency_document((select h from ectx), '{"sections":[]}');

select t.as_user('00000000-0000-0000-0000-0000000000cf');
select t.assert((select count(*) from public.emergency_documents) = 1, 'by default the viewer can read the handbook');
select t.assert((public.emergency_status((select h from ectx))->>'open')::boolean, 'and is told it is open');

select t.as_user('00000000-0000-0000-0000-0000000000af');
insert into public.emergency_access (household_id, mode, inactive_days) select h, 'inactive', 30 from ectx
  on conflict (household_id) do update set mode = 'inactive', inactive_days = 30, last_member_seen = now();
select t.as_user('00000000-0000-0000-0000-0000000000cf');
select t.assert((select count(*) from public.emergency_documents) = 0, 'while members are active the viewer cannot read it');
select t.assert(not (public.emergency_status((select h from ectx))->>'open')::boolean, 'and is told it is locked');
select t.assert((public.emergency_status((select h from ectx))->>'daysUntilOpen')::int between 29 and 30, 'with the days left until it opens');
select t.assert((select count(*) from public.emergency_access) = 0, 'the viewer cannot read the access settings');
select t.assert(t.throws($q$update public.emergency_access set released = true$q$) or (select count(*) from public.emergency_access) = 0, 'nor release it');

select t.as_root();
update public.emergency_access set last_member_seen = now() - interval '31 days';
select t.as_user('00000000-0000-0000-0000-0000000000cf');
select t.assert((select count(*) from public.emergency_documents) = 1, 'after 30 quiet days it opens');

select t.as_user('00000000-0000-0000-0000-0000000000af');
select public.touch_member_activity((select h from ectx));
select t.assert((select last_member_seen > now() - interval '1 minute' from public.emergency_access), 'a member signing in resets the clock');
select t.as_user('00000000-0000-0000-0000-0000000000cf');
select t.assert((select count(*) from public.emergency_documents) = 0, 'and it locks again');
select public.touch_member_activity((select h from ectx));
select t.as_user('00000000-0000-0000-0000-0000000000af');
select t.assert((select (select last_member_seen from public.emergency_access) <= now()), 'a viewer cannot reset the clock');
update public.emergency_access set mode = 'manual', released = true;
select t.as_user('00000000-0000-0000-0000-0000000000cf');
select t.assert((select count(*) from public.emergency_documents) = 1, 'a released handbook opens at once');

select t.as_user('00000000-0000-0000-0000-0000000000bf');
select t.assert((select count(*) from public.emergency_documents) = 0 and public.emergency_status((select h from ectx)) is null, 'outsiders see nothing and learn nothing');
select t.as_root();
rollback;
\echo 'ALL EMERGENCY ACCESS TESTS PASSED'
