begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a6', 'mk-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b6', 'mk-b@example.test');
-- the scheduled job (service role) loads public data
insert into public.amfi_schemes (code, name, plan, option) values ('118778', 'Nippon India Small Cap Fund', 'Direct', 'Growth');
insert into public.mf_navs (amfi_code, nav_date, nav) values ('118778', current_date - 1, 190.5), ('118778', current_date, 191.25);
insert into public.fx_rates (currency, rate_date, inr_per_unit, source) values ('SGD', current_date, 74.263, 'frankfurter');

select t.as_user('00000000-0000-0000-0000-0000000000a6');
create temp table mkctx as select public.create_household('Market household') as h;
grant all on mkctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Rupash' from mkctx;
insert into public.assets (household_id, type, owner_id, nickname) select c.h, 'mutual_fund', o.id, 'Nippon' from mkctx c join public.owners o on o.household_id = c.h;
insert into public.mf_positions (asset_id, household_id, fund_name) select id, household_id, 'Nippon India Small Cap Growth Direct Plan' from public.assets;
create temp table mka as select id from public.assets;
grant all on mka to authenticated;

-- 1. any signed-in user can read market data, nobody can write it
select t.assert((select count(*) from public.mf_navs) = 2, 'signed-in users can read NAVs');
select t.assert((select inr_per_unit from public.fx_rates where currency = 'SGD') = 74.263, 'signed-in users can read FX');
select t.assert(t.throws($q$insert into public.mf_navs (amfi_code, nav_date, nav) values ('118778', current_date + 1, 1)$q$), 'users cannot write NAVs');
select t.assert(t.throws($q$update public.fx_rates set inr_per_unit = 1$q$) or (select inr_per_unit from public.fx_rates) = 74.263, 'users cannot change FX');
select t.assert(t.throws($q$delete from public.amfi_schemes$q$), 'users cannot delete scheme data');

-- 2. confirming a match
select public.confirm_scheme_match((select h from mkctx), (select id from mka), '118778');
select t.assert((select amfi_code from public.mf_positions) = '118778', 'match saved');
select t.assert(t.throws($q$select public.confirm_scheme_match((select h from mkctx), (select id from mka), '000000')$q$), 'unknown scheme code refused');
select t.assert(t.throws($q$select public.confirm_scheme_match((select h from mkctx), gen_random_uuid(), '118778')$q$), 'unknown fund refused');

-- 3. outsiders and anonymous users
select t.as_user('00000000-0000-0000-0000-0000000000b6');
select t.assert(t.throws($q$select public.confirm_scheme_match((select h from mkctx), (select id from mka), '118778')$q$), 'outsider cannot confirm matches');
select t.as_anon();
select t.assert(t.throws($q$select * from public.mf_navs$q$), 'anonymous users cannot read market data');
select t.as_root();
rollback;
\echo 'ALL MARKET DATA TESTS PASSED'
