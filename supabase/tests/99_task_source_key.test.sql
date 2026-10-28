begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a7', 'tk@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table tctx as select public.create_household('Task key household') as h;
grant all on tctx to authenticated;
insert into public.tasks (household_id, title, source_key) select h, 'Send a statement', 'needed:stmt-none:x' from tctx;
select t.assert(t.throws($q$insert into public.tasks (household_id, title, source_key) select h, 'Again', 'needed:stmt-none:x' from tctx$q$), 'one task per key');
insert into public.tasks (household_id, title) select h, 'By hand one' from tctx;
insert into public.tasks (household_id, title) select h, 'By hand two' from tctx;
select t.assert((select count(*) from public.tasks) = 3, 'tasks added by hand need no key');
select t.as_root();
rollback;
\echo 'ALL TASK KEY TESTS PASSED'
