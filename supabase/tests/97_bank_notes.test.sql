begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'n-a@example.test'), ('00000000-0000-0000-0000-0000000000b1', 'n-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table nctx as select public.create_household('Notes household') as h;
grant all on nctx to authenticated;
insert into public.institutions (household_id, name) select h, 'Sample Bank' from nctx;
update public.institutions set notes = 'AMB 10,000 · no debit card · lounge card';
select t.assert((select notes like 'AMB%' from public.institutions), 'a bank note is saved');
select t.assert(t.throws($q$update public.institutions set notes = repeat('x', 501)$q$), 'an overlong note is refused');
select t.as_user('00000000-0000-0000-0000-0000000000b1');
update public.institutions set notes = 'hijack';
select t.as_root();
select t.assert((select notes like 'AMB%' from public.institutions), 'outsiders cannot change it');
rollback;
\echo 'ALL BANK NOTE TESTS PASSED'
