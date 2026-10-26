begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000ac', 's-a@example.test'), ('00000000-0000-0000-0000-0000000000bc', 's-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000ac');
create temp table sctx as select public.create_household('Settings household') as h;
grant all on sctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from sctx;
insert into public.owners (household_id, display_name, is_minor) select h, 'Child', true from sctx;
create temp table so as select (select id from public.owners where display_name = 'Parent') as p, (select id from public.owners where display_name = 'Child') as c;
grant all on so to authenticated;

select public.save_owner_profile((select h from sctx), (select p from so), jsonb_build_object('dob','1980-02-03','pan','abcde1234f','taxResidency','Singapore','planRole','primary'));
select t.assert((select dob = date '1980-02-03' and pan_last4 = '234F' and plan_role = 'primary' and tax_residency = 'Singapore' from public.owners where display_name = 'Parent'), 'profile saved, PAN reduced to its last four for display');
select t.assert(t.throws($q$select pan from public.owner_pan$q$), 'the full PAN cannot be read through the app');
select t.assert(t.throws($q$insert into public.owner_pan (owner_id, household_id, pan) select p, (select h from sctx), 'ABCDE1234F' from so$q$), 'nor written directly');
select t.assert(t.throws($q$select public.save_owner_profile((select h from sctx), (select p from so), '{"pan":"12345"}')$q$), 'a malformed PAN is refused');
select public.save_owner_profile((select h from sctx), (select c from so), jsonb_build_object('dob','2015-05-05','guardianId',(select p from so)::text,'isMinor',true));
select t.assert((select guardian_id = (select p from so) from public.owners where display_name = 'Child'), 'a minor can be linked to a guardian');
select t.assert(t.throws($q$select public.save_owner_profile((select h from sctx), (select c from so), '{"planRole":"primary"}')$q$), 'only one primary person');
select public.save_owner_profile((select h from sctx), (select p from so), '{"clearPan": true}');
select t.assert((select pan_last4 is null from public.owners where display_name = 'Parent'), 'a PAN can be removed');

insert into public.cashflow_items (household_id, owner_id, kind, label, amount, currency) select h, (select p from so), 'income', 'Salary', 5000, 'SGD' from sctx;
select t.assert((select count(*) from public.cashflow_items) = 1, 'income saved');
select t.assert(t.throws($q$insert into public.cashflow_items (household_id, kind, label, amount) select h, 'income', 'x', -1 from sctx$q$), 'negative amount refused');
insert into public.household_config (household_id, config) select h, '{"deposits":{"insuranceLimit":500000}}' from sctx;
select t.assert((select (config->'deposits'->>'insuranceLimit')::int = 500000 from public.household_config), 'configuration saved');
insert into public.tax_rules (household_id, fy, holding_months_long, stcg_rate, ltcg_rate, ltcg_exemption) select h, '2027-28', 12, 0.2, 0.125, 125000 from sctx;
select t.assert(t.throws($q$insert into public.tax_rules (household_id, fy, holding_months_long, stcg_rate, ltcg_rate, ltcg_exemption) select h, '2027', 12, 0.2, 0.125, 125000 from sctx$q$), 'a malformed year is refused');

select t.as_user('00000000-0000-0000-0000-0000000000bc');
select t.assert((select count(*) from public.cashflow_items) + (select count(*) from public.household_config) + (select count(*) from public.tax_rules) = 0, 'outsiders see nothing');
select t.assert(t.throws($q$select public.save_owner_profile((select h from sctx), (select p from so), '{"notes":"x"}')$q$), 'outsiders cannot edit profiles');
select t.as_root();
rollback;
\echo 'ALL SETTINGS TESTS PASSED'
