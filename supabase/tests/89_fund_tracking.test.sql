begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a3', 'f-a@example.test'), ('00000000-0000-0000-0000-0000000000b3', 'f-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
create temp table fctx as select public.create_household('Fund household') as h;
grant all on fctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from fctx;
create temp table fown as select id as p from public.owners where display_name = 'Parent';
grant all on fown to authenticated;
insert into public.assets (household_id, type, owner_id, nickname) select h, 'mutual_fund', (select p from fown), 'Sample Fund' from fctx;
create temp table fa as select id as a from public.assets where nickname = 'Sample Fund';
grant all on fa to authenticated;
insert into public.mf_positions (asset_id, household_id, fund_name, invested) select (select a from fa), h, 'Sample Fund', 100000 from fctx;

select public.save_fund_update((select h from fctx), jsonb_build_array(jsonb_build_object('assetId', (select a from fa), 'units', 1000.5, 'invested', 120000, 'asOf', '2026-10-01', 'nav', 125.5, 'value', 125562.75, 'sipMonthly', 5000)));
select t.assert((select units = 1000.5 and invested = 120000 and sip_monthly = 5000 and units_as_of = date '2026-10-01' from public.mf_positions), 'units, amount invested and SIP are saved');
select t.assert((select count(*) from public.observations where kind = 'valuation' and amount = 125562.75) = 1, 'the value is recorded as a new valuation');
select t.assert((select units = 1000.5 and nav = 125.5 from public.mf_snapshots), 'and as a dated snapshot');
select public.save_fund_update((select h from fctx), jsonb_build_array(jsonb_build_object('assetId', (select a from fa), 'units', 1010, 'value', 126000, 'asOf', '2026-10-01')));
select t.assert((select count(*) from public.mf_snapshots) = 1 and (select value = 126000 from public.mf_snapshots), 'the same day is replaced, not duplicated');
select t.assert(t.throws($q$select public.save_fund_update((select h from fctx), '[{"assetId":"00000000-0000-0000-0000-000000000001","value":1}]')$q$), 'an unknown fund is refused');
select t.assert(t.throws($q$select public.save_fund_update((select h from fctx), jsonb_build_array(jsonb_build_object('assetId', (select a from fa), 'units', -1, 'value', 1)))$q$), 'negative units are refused');
select t.assert(t.throws($q$select public.save_fund_update((select h from fctx), jsonb_build_array(jsonb_build_object('assetId', (select a from fa), 'value', 1, 'asOf', '2999-01-01')))$q$), 'a future date is refused');

select public.add_fund_transaction((select h from fctx), (select a from fa), '{"date":"2026-10-02","kind":"purchase","amount":10000,"nav":100}');
select t.assert((select units = 1110 and invested = 130000 from public.mf_positions), 'a purchase adds units (amount / price) and money invested');
select public.add_fund_transaction((select h from fctx), (select a from fa), '{"date":"2026-10-03","kind":"redeem","amount":20000,"units":111}');
select t.assert((select units = 999 and invested = 117000 from public.mf_positions), 'a sale takes out the same share of units and cost');
select t.assert((select count(*) from public.mf_transactions where source = 'manual') = 2, 'both are in the ledger');
select t.assert(t.throws($q$select public.add_fund_transaction((select h from fctx), (select a from fa), '{"date":"2026-10-03","kind":"redeem","amount":1,"units":99999}')$q$), 'selling more than is held is refused');
select t.assert(t.throws($q$select public.add_fund_transaction((select h from fctx), (select a from fa), '{"date":"2026-10-03","kind":"gift","amount":1,"units":1}')$q$), 'an unknown kind is refused');

select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.assert((select count(*) from public.mf_snapshots) = 0, 'outsiders see no snapshots');
select t.assert(t.throws($q$select public.save_fund_update((select h from fctx), '[]')$q$), 'outsiders cannot save fund updates');
select t.assert(t.throws($q$select public.add_fund_transaction((select h from fctx), (select a from fa), '{"date":"2026-10-03","kind":"purchase","amount":1,"units":1}')$q$), 'nor add transactions');
select t.as_root();
rollback;
\echo 'ALL FUND TRACKING TESTS PASSED'
