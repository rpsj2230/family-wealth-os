begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'ps-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b9', 'ps-b@example.test');
-- the scheduled job (service role) loads public data
insert into public.amfi_schemes (code, name, plan, option) values ('118778', 'Nippon India Small Cap Fund', 'Direct', 'Growth'), ('120503', 'Other Fund', 'Direct', 'Growth');

select t.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table psctx as select public.create_household('Price source household') as h;
grant all on psctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Rupash' from psctx;
insert into public.assets (household_id, type, owner_id, nickname) select c.h, 'mutual_fund', o.id, 'Nippon' from psctx c join public.owners o on o.household_id = c.h;
insert into public.mf_positions (asset_id, household_id, fund_name) select id, household_id, 'Nippon India Small Cap Growth Direct Plan' from public.assets;
create temp table psa as select id from public.assets;
grant all on psa to authenticated;

-- 1. the mark: "this is not a listed fund"
select t.assert((select no_price_source from public.mf_positions) = false, 'a fund starts with a price source expected');
update public.mf_positions set no_price_source = true where asset_id = (select id from psa);
select t.assert((select no_price_source from public.mf_positions), 'the mark is saved');

-- 2. prices can be added only for a scheme the household holds
select t.assert(t.throws($q$select public.store_scheme_navs((select h from psctx), '118778', '[{"nav_date":"2026-10-01","nav":190.5}]'::jsonb)$q$), 'not matched yet: refused');
select public.confirm_scheme_match((select h from psctx), (select id from psa), '118778');
select t.assert(public.store_scheme_navs((select h from psctx), '118778', '[{"nav_date":"2026-10-01","nav":190.5},{"nav_date":"2026-10-02","nav":191.25},{"nav_date":"2026-10-03","nav":0}]'::jsonb) = 2, 'two good prices stored, the zero one left out');
select t.assert((select count(*) from public.mf_navs where amfi_code = '118778') = 2, 'two rows');
-- a day already stored is never changed, saying it again adds nothing
select t.assert(public.store_scheme_navs((select h from psctx), '118778', '[{"nav_date":"2026-10-01","nav":999}]'::jsonb) = 0, 'a stored day is kept');
select t.assert((select nav from public.mf_navs where amfi_code = '118778' and nav_date = '2026-10-01') = 190.5, 'the stored price is unchanged');
select t.assert(t.throws($q$select public.store_scheme_navs((select h from psctx), '120503', '[{"nav_date":"2026-10-01","nav":5}]'::jsonb)$q$), 'a scheme the household does not hold is refused');
select t.assert(t.throws($q$select public.store_scheme_navs((select h from psctx), '118778', '{"a":1}'::jsonb)$q$), 'prices must be a list');
select t.assert(t.throws($q$insert into public.mf_navs (amfi_code, nav_date, nav) values ('118778', '2026-11-01', 1)$q$), 'direct writes are still refused');

-- 3. outsiders and anonymous users
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.assert(t.throws($q$select public.store_scheme_navs((select h from psctx), '118778', '[{"nav_date":"2026-10-05","nav":1}]'::jsonb)$q$), 'an outsider cannot add prices');
select t.as_anon();
select t.assert(t.throws($q$select public.store_scheme_navs(gen_random_uuid(), '118778', '[]'::jsonb)$q$), 'anonymous users cannot add prices');
select t.as_root();
rollback;
\echo 'ALL PRICE SOURCE TESTS PASSED'
