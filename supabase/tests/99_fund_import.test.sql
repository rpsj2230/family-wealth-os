begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f1', 'fi-a@example.test'),
  ('00000000-0000-0000-0000-0000000000f2', 'fi-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000f1');
create temp table fctx as select public.create_household('Fund import household') as h;
grant all on fctx to authenticated;
select t.as_root();
insert into public.owners (household_id, display_name) select h, 'Owner' from fctx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select id from public.owners limit 1), 'mutual_fund', 'Fund', 'INR' from fctx;
create temp table fasset as select id as a from public.assets limit 1;
grant all on fasset to authenticated;
insert into public.mf_positions (asset_id, household_id, fund_name, invested, started_on, sip_monthly)
  select (select a from fasset), h, 'Fund', 0, '2025-01-15', 5000 from fctx;

-- a dated change of the SIP: the new amount runs from the day given, not the day the statement was read
select t.as_user('00000000-0000-0000-0000-0000000000f1');
select public.apply_sip_change((select h from fctx), (select a from fasset), 8000, date '2026-09-05');
select t.assert((select count(*) from public.mf_sip_changes) = 2, 'the first change also records the amount that ran before it');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2025-01-15') = 5000, 'the earlier amount runs from the start date');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2026-09-05') = 8000, 'the new amount runs from the given day');
select t.assert((select sip_monthly from public.mf_positions) = 8000, 'the position shows the current amount');
select t.assert((select count(*) from public.mf_sip_changes where effective_on = current_date) = 0, 'nothing is dated with the day of the import');

-- a stop keeps the last amount and is dated from the day after the last instalment
select public.apply_sip_change((select h from fctx), (select a from fasset), 0, date '2026-10-06');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2026-10-06') = 0, 'stopping is recorded as zero from that day');
select t.assert((select sip_stopped from public.mf_positions) and (select sip_monthly from public.mf_positions) = 8000, 'the last amount is kept when stopped');

-- saying the same thing again writes nothing
select public.apply_sip_change((select h from fctx), (select a from fasset), 0, date '2026-10-20');
select t.assert((select count(*) from public.mf_sip_changes) = 3, 'a stop that is already recorded adds no row');

-- a resume
select public.apply_sip_change((select h from fctx), (select a from fasset), 6000, date '2026-10-21');
select t.assert(not (select sip_stopped from public.mf_positions) and (select sip_monthly from public.mf_positions) = 6000, 'a stopped SIP can restart at a new amount');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2026-10-21') = 6000, 'the restart is dated');
select public.apply_sip_change((select h from fctx), (select a from fasset), 6000, current_date);
select t.assert((select count(*) from public.mf_sip_changes) = 4, 'the same amount again adds no row');

select t.assert(t.throws($q$select public.apply_sip_change((select h from fctx), (select a from fasset), -1, date '2026-10-01')$q$), 'a negative amount is refused');
select t.assert(t.throws($q$select public.apply_sip_change((select h from fctx), (select a from fasset), 100, null)$q$), 'a date is needed');
select t.assert(t.throws($q$select public.apply_sip_change((select h from fctx), (select a from fasset), 100, current_date + 90)$q$), 'a date far ahead is refused');
select t.assert(t.throws($q$select public.apply_sip_change((select h from fctx), gen_random_uuid(), 100, date '2026-10-01')$q$), 'an unknown fund is refused');

-- the mailbox job runs without a signed-in member: it can record the change too
select t.as_root();
select public.apply_sip_change((select h from fctx), (select a from fasset), 0, current_date - 2);
select t.assert((select monthly from public.mf_sip_changes where effective_on = current_date - 2) = 0, 'the background job can record a dated change');
select public.apply_sip_change((select h from fctx), (select a from fasset), 6000, current_date - 1);

-- somebody else's household is out of reach
select t.as_user('00000000-0000-0000-0000-0000000000f2');
select t.assert(t.throws($q$select public.apply_sip_change((select h from fctx), (select a from fasset), 1, date '2026-10-01')$q$), 'a stranger cannot change another household''s SIP');
select t.assert((select count(*) from public.mf_sip_changes) = 0, 'a stranger sees no SIP history');

-- verdicts the person overruled
select t.as_user('00000000-0000-0000-0000-0000000000f1');
insert into public.fund_import_ignores (household_id, asset_id, verdict, basis)
  select h, (select a from fasset), 'sip_stopped', '2026-03-05' from fctx;
select t.assert((select count(*) from public.fund_import_ignores) = 1, 'an overruled verdict is stored');
select t.assert(t.throws($q$insert into public.fund_import_ignores (household_id, asset_id, verdict, basis) select h, (select a from fasset), 'sip_stopped', '2026-03-05' from fctx$q$), 'the same verdict on the same facts is stored once');
insert into public.fund_import_ignores (household_id, asset_id, verdict, basis)
  select h, (select a from fasset), 'sip_stopped', '2026-04-05' from fctx;
select t.assert((select count(*) from public.fund_import_ignores) = 2, 'other facts are a different verdict');
select t.assert(t.throws($q$insert into public.fund_import_ignores (household_id, asset_id, verdict, basis) select h, (select a from fasset), 'gift', 'x' from fctx$q$), 'unknown verdicts are refused');
select t.assert(t.throws($q$insert into public.fund_import_ignores (household_id, asset_id, verdict, basis) select h, gen_random_uuid(), 'sold', '2026-10-25' from fctx$q$), 'the fund must belong to the household');

-- the change list kept with an import
insert into public.cas_imports (household_id, owner_id, source_ref, schemes, transactions, outcome, changes)
  select h, (select id from public.owners limit 1), 'upload:abc', 3, 5, 'imported',
    '{"summary":"2 funds updated: +5 transactions; 1 SIP stopped","items":[]}'::jsonb from fctx;
select t.assert((select changes ->> 'summary' from public.cas_imports where source_ref = 'upload:abc') like '2 funds updated%', 'the changes are kept with the import');

select t.as_user('00000000-0000-0000-0000-0000000000f2');
select t.assert((select count(*) from public.fund_import_ignores) + (select count(*) from public.cas_imports) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL FUND IMPORT TESTS PASSED'
