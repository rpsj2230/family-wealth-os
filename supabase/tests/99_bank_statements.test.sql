begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a3', 's-a@example.test'), ('00000000-0000-0000-0000-0000000000b3', 's-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
create temp table sctx as select public.create_household('Statements household') as h;
grant all on sctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from sctx;
insert into public.assets (household_id, type, owner_id, nickname)
  select h, 'bank_account', (select id from public.owners where display_name = 'Parent'), 'Sample savings' from sctx;
create temp table sacc as select id as a from public.assets where nickname = 'Sample savings';
grant all on sacc to authenticated;

insert into public.bank_statements (household_id, asset_id, from_on, to_on, opening, closing, line_count, layout)
  select h, (select a from sacc), '2024-04-01', '2024-04-30', 100000, 124312, 2, 'debit-credit' from sctx;
create temp table sst as select id as s from public.bank_statements;
grant all on sst to authenticated;
insert into public.statement_lines (household_id, statement_id, asset_id, txn_on, amount, balance, narration, line_key)
  select h, (select s from sst), (select a from sacc), '2024-04-01', 25000, 125000, 'NEFT CR', '2024-04-01|2500000|12500000|0' from sctx;
select t.assert((select count(*) from public.statement_lines) = 1, 'a line can be stored');
select t.assert(t.throws($q$insert into public.statement_lines (household_id, statement_id, asset_id, txn_on, amount, balance, narration, line_key) select h, (select s from sst), (select a from sacc), '2024-04-01', 25000, 125000, 'NEFT CR', '2024-04-01|2500000|12500000|0' from sctx$q$), 'an overlapping statement cannot add the same line twice');
select t.assert(t.throws($q$insert into public.statement_lines (household_id, statement_id, asset_id, txn_on, amount, narration, line_key) select h, (select s from sst), (select a from sacc), '2024-04-02', 0, 'x', '2024-04-02|0|0|0' from sctx$q$), 'a line of nothing is refused');
select t.assert(t.throws($q$update public.statement_lines set answer = 'maybe'$q$), 'only the known answers are accepted');
update public.statement_lines set answer = 'rent';
select t.assert((select answer from public.statement_lines) = 'rent', 'an answer can be given');
select t.assert(t.throws($q$insert into public.bank_statements (household_id, asset_id, from_on, to_on, line_count, layout) select h, gen_random_uuid(), '2024-04-01', '2024-04-30', 0, 'debit-credit' from sctx$q$), 'the account must belong to the household');

select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.assert((select count(*) from public.statement_lines) = 0, 'outsiders see no lines');
select t.assert((select count(*) from public.bank_statements) = 0, 'outsiders see no statements');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
delete from public.bank_statements;
select t.assert((select count(*) from public.statement_lines) = 0, 'deleting a statement removes its lines');
select t.as_root();
rollback;
\echo 'ALL BANK STATEMENT TESTS PASSED'
