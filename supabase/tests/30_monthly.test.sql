-- save_monthly_update: batch balances, history preservation, validation, isolation.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a3', 'm-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b3', 'm-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a3');
create temp table mctx as select public.create_household('Monthly household') as h;
grant all on mctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Rupash' from mctx;
insert into public.assets (household_id, type, owner_id, nickname, account_kind)
  select c.h, 'bank_account', o.id, 'NRE savings', 'NRE' from mctx c join public.owners o on o.household_id = c.h;
insert into public.assets (household_id, type, owner_id, nickname, currency)
  select c.h, 'bank_account', o.id, 'UOB S$', 'SGD' from mctx c join public.owners o on o.household_id = c.h;
insert into public.assets (household_id, type, owner_id, nickname)
  select c.h, 'mutual_fund', o.id, 'Fund A' from mctx c join public.owners o on o.household_id = c.h;
insert into public.assets (household_id, type, owner_id, nickname, status)
  select c.h, 'fixed_deposit', o.id, 'RBL FD', 'matured_unconfirmed' from mctx c join public.owners o on o.household_id = c.h;
create temp table ids as select nickname, id from public.assets;
grant all on ids to authenticated;

-- 1. a batch writes balances, a valuation, an S$ balance with rate, settings and a status change together
select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'amount', 100000, 'asOf', to_char(current_date,'YYYY-MM-DD'), 'interestRate', 0.03, 'tdsRate', 0),
  jsonb_build_object('assetId', (select id from ids where nickname='UOB S$'), 'amount', 1500.5, 'fxRate', 68.1),
  jsonb_build_object('assetId', (select id from ids where nickname='Fund A'), 'amount', 250000, 'note', 'from Kuvera'),
  jsonb_build_object('assetId', (select id from ids where nickname='RBL FD'), 'status', 'closed')
));
select t.assert((select count(*) from public.observations) = 3, 'three observations appended');
select t.assert((select kind from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'NRE savings') = 'balance', 'bank value stored as balance');
select t.assert((select kind from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'Fund A') = 'valuation', 'fund value stored as valuation');
select t.assert((select source || '/' || confidence from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'Fund A') = 'manual/manual_confirmed', 'manual entries are marked confirmed');
select t.assert((select currency || fx_rate::text from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'UOB S$') = 'SGD68.1000', 'S$ amount keeps currency and rate');
select t.assert((select interest_rate from public.assets where nickname = 'NRE savings') = 0.03, 'interest rate saved on the account');
select t.assert((select status from public.assets where nickname = 'RBL FD') = 'closed', 'FD status resolved');

-- 2. history is preserved on the next update
select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'amount', 120000)));
select t.assert((select count(*) from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'NRE savings') = 2, 'old balance kept, new one added');

-- 3. validation: nothing is saved if any row is bad (all-or-nothing)
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'amount', 5),
  jsonb_build_object('assetId', (select id from ids where nickname='Fund A'), 'amount', -1)))$q$), 'negative value rejected');
select t.assert((select count(*) from public.observations o join ids i on i.id = o.asset_id where i.nickname = 'NRE savings') = 2, 'bad batch wrote nothing');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='Fund A'), 'amount', 5, 'asOf', to_char(current_date + 3,'YYYY-MM-DD'))))$q$), 'future date rejected');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='UOB S$'), 'amount', 5)))$q$), 'foreign balance without an exchange rate rejected');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', gen_random_uuid(), 'amount', 5)))$q$), 'unknown asset rejected');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'interestRate', 4)))$q$), 'rate above 100% rejected');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'status', 'nonsense')))$q$), 'invalid status rejected');

-- 4. outsiders cannot save into this household
select t.as_user('00000000-0000-0000-0000-0000000000b3');
select t.assert(t.throws($q$select public.save_monthly_update((select h from mctx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from ids where nickname='NRE savings'), 'amount', 1)))$q$), 'outsider cannot save');

select t.as_root();
rollback;
\echo 'ALL MONTHLY TESTS PASSED'
