begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'f-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b7', 'f-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table fctx as select public.create_household('Fund household') as h;
grant all on fctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from fctx;
create temp table fref as select (select id from public.owners where display_name = 'Parent') as p;
grant all on fref to authenticated;

-- a fund is added with its position, its first value and its units
create temp table fnew as select public.add_mutual_fund((select h from fctx), jsonb_build_object(
  'ownerId', (select p from fref), 'name', 'Sample Growth Fund', 'invested', 100000, 'value', 112500.5,
  'units', 1250.25, 'startedOn', '2024-01-05', 'sipMonthly', 5000, 'planType', 'direct')) as id;
grant all on fnew to authenticated;
select t.assert((select type = 'mutual_fund' and status = 'active' and nickname = 'Sample Growth Fund' and owner_id = (select p from fref) from public.assets where id = (select id from fnew)), 'the fund is an active mutual fund of that person');
select t.assert((select invested = 100000 and sip_monthly = 5000 and started_on = '2024-01-05' and plan_type = 'direct' and fund_name = 'Sample Growth Fund' and units = 1250.25 from public.mf_positions where asset_id = (select id from fnew)), 'the position holds the amount, the SIP, the start, the plan and the units');
select t.assert((select count(*) = 1 and max(amount) = 112500.50 from public.observations where asset_id = (select id from fnew) and kind = 'valuation'), 'the first value is recorded as a valuation');
select t.assert((select count(*) = 1 and max(value) = 112500.50 and max(invested) = 100000 from public.mf_snapshots where asset_id = (select id from fnew)), 'and as the first snapshot');

-- the optional parts may be left out
select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Plain Fund', 'invested', 0, 'value', 500));
select t.assert((select plan_type = 'regular_or_unknown' and sip_monthly is null and started_on is null and units is null from public.mf_positions where fund_name = 'Plain Fund'), 'a fund with only a name, a person and a value is accepted');

-- refusals
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Sample Growth Fund', 'invested', 1, 'value', 1))$q$), 'the same name for the same person is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', gen_random_uuid(), 'name', 'X Fund', 'invested', 1, 'value', 1))$q$), 'a person from nowhere is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', '  ', 'invested', 1, 'value', 1))$q$), 'a blank name is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Y Fund', 'invested', -1, 'value', 1))$q$), 'a negative amount is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Y Fund', 'invested', 1))$q$), 'a missing value is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Y Fund', 'invested', 1, 'value', 1, 'sipMonthly', 0))$q$), 'a SIP of zero is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Y Fund', 'invested', 1, 'value', 1, 'startedOn', '2999-01-01'))$q$), 'a start date in the future is refused');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Y Fund', 'invested', 1, 'value', 1, 'planType', 'gold'))$q$), 'an unknown plan is refused');
select t.assert((select count(*) = 2 from public.assets where type = 'mutual_fund'), 'and nothing from a refused call is kept');

-- an outsider cannot add to the household
select t.as_user('00000000-0000-0000-0000-0000000000b7');
select t.assert(t.throws($q$select public.add_mutual_fund((select h from fctx), jsonb_build_object('ownerId', (select p from fref), 'name', 'Z Fund', 'invested', 1, 'value', 1))$q$), 'a person outside the household cannot add a fund');
select t.as_root();
select t.assert((select count(*) = 2 from public.assets where type = 'mutual_fund'), 'and nothing was added');
rollback;
\echo 'ALL ADD FUND TESTS PASSED'
