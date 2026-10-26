begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a2', 't-a@example.test'), ('00000000-0000-0000-0000-0000000000b2', 't-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a2');
create temp table tctx as select public.create_household('Tax files household') as h;
grant all on tctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from tctx;
create temp table town as select id as p from public.owners where display_name = 'Parent';
grant all on town to authenticated;

insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, (select p from town), '2025-26', '26as', '{"deductors":[]}' from tctx;
select t.assert((select count(*) from public.tax_statements) = 1, 'a statement can be stored');
select t.assert(t.throws($q$insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, (select p from town), '2025-26', '26as', '{}' from tctx$q$), 'one per person, year and kind');
select t.assert(t.throws($q$insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, (select p from town), '2025', 'ais', '{}' from tctx$q$), 'a malformed year is refused');
select t.assert(t.throws($q$insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, (select p from town), '2025-26', 'form16', '{}' from tctx$q$), 'unknown kinds are refused');
select t.assert(t.throws($q$insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, (select p from town), '2025-26', 'ais', '[1]' from tctx$q$), 'the content must be an object');
select t.assert(t.throws($q$insert into public.tax_statements (household_id, owner_id, fy, kind, parsed) select h, gen_random_uuid(), '2024-25', 'ais', '{}' from tctx$q$), 'the person must belong to the household');
select t.assert((select count(*) from public.audit_events where table_name = 'tax_statements') = 0, 'the audit log does not copy statements');

select t.as_user('00000000-0000-0000-0000-0000000000b2');
select t.assert((select count(*) from public.tax_statements) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL TAX STATEMENT TESTS PASSED'
