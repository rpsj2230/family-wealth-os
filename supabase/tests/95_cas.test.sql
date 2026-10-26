begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ae', 'c-a@example.test'), ('00000000-0000-0000-0000-0000000000be', 'c-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000ae');
create temp table cctx as select public.create_household('CAS household') as h;
grant all on cctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from cctx;
create temp table cown as select id as p from public.owners where display_name = 'Parent';
grant all on cown to authenticated;
insert into public.assets (household_id, type, owner_id, nickname) select h, 'mutual_fund', (select p from cown), 'Sample Fund' from cctx;
create temp table cass as select id as a from public.assets where nickname = 'Sample Fund';
grant all on cass to authenticated;

insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, source_ref)
  select h, (select a from cass), '2024-01-05', 'sip', 5000, 50.1234, 99.75, 'ref-1' from cctx;
select t.assert((select count(*) from public.mf_transactions) = 1, 'a transaction is stored');
select t.assert(t.throws($q$insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source_ref) select h, (select a from cass), '2024-01-05', 'sip', 5000, 50.1234, 'ref-1' from cctx$q$), 'the same statement line is never stored twice');
select t.assert(t.throws($q$insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source_ref) select h, (select a from cass), '2024-02-05', 'gift', 1, 1, 'ref-2' from cctx$q$), 'unknown kinds refused');
select t.assert(t.throws($q$insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source_ref) select h, gen_random_uuid(), '2024-02-05', 'sip', 1, 1, 'ref-3' from cctx$q$), 'the fund must belong to the household');
insert into public.cas_imports (household_id, owner_id, source_ref, schemes, transactions, outcome) select h, (select p from cown), 'msg-1', 1, 1, 'imported' from cctx;
select t.assert(t.throws($q$insert into public.cas_imports (household_id, owner_id, source_ref, outcome) select h, (select p from cown), 'msg-1', 'imported' from cctx$q$), 'a statement is imported once');
update public.mf_positions set isin = 'INF179K01XQ0' where false;
select t.assert(t.throws($q$insert into public.mf_positions (asset_id, household_id, fund_name, isin) select (select a from cass), h, 'Sample Fund', 'BAD' from cctx$q$), 'a malformed ISIN is refused');

select t.as_user('00000000-0000-0000-0000-0000000000be');
select t.assert((select count(*) from public.mf_transactions) + (select count(*) from public.cas_imports) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL CAS TESTS PASSED'
