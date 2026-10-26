begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a9', 'sip@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table sctx as select public.create_household('SIP household') as h;
grant all on sctx to authenticated;
select t.as_root();
insert into public.owners (household_id, display_name) select h, 'Owner' from sctx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select id from public.owners limit 1), 'mutual_fund', 'Fund', 'INR' from sctx;
insert into public.mf_positions (asset_id, household_id, fund_name, invested, started_on, sip_monthly)
  select (select id from public.assets limit 1), h, 'Fund', 0, '2025-01-15', 5000 from sctx;
select t.assert((select count(*) from public.mf_sip_changes) = 0, 'no history until the amount changes');

select t.as_user('00000000-0000-0000-0000-0000000000a9');
select public.set_sip((select h from sctx), (select id from public.assets limit 1), 8000, date '2026-09-01');
select t.assert((select count(*) from public.mf_sip_changes) = 2, 'the first change also records the amount that ran before it');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2025-01-15') = 5000, 'the earlier amount runs from the start date');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2026-09-01') = 8000, 'the new amount runs from the chosen date');
select t.assert((select sip_monthly from public.mf_positions) = 8000, 'the position shows the current amount');

select public.set_sip((select h from sctx), (select id from public.assets limit 1), 0, date '2026-10-10');
select t.assert((select monthly from public.mf_sip_changes where effective_on = '2026-10-10') = 0, 'stopping is recorded as zero from that date');
select t.assert((select sip_stopped from public.mf_positions) and (select sip_monthly from public.mf_positions) = 8000, 'the last amount is kept when stopped');

select public.set_sip((select h from sctx), (select id from public.assets limit 1), 3000, date '2026-10-20');
select t.assert(not (select sip_stopped from public.mf_positions), 'a stopped SIP can restart');
select t.assert((select count(*) from public.mf_sip_changes) = 4, 'every change is kept');
select t.assert(t.throws($q$select public.set_sip((select h from sctx), (select id from public.assets limit 1), -1)$q$), 'a negative amount is refused');

-- a plain update of the amount (the monthly update screen) is recorded too, dated today
update public.mf_positions set sip_monthly = 4000;
select t.assert((select monthly from public.mf_sip_changes where effective_on = current_date) = 4000, 'an ordinary edit is dated today');

-- estimated ledger lines are replaced by real ones
select t.as_root();
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source, source_ref)
  select h, (select id from public.assets limit 1), d, 'sip', 5000, 10, 'estimate', 'est:' || d from sctx, (values (date '2026-07-15'), (date '2026-08-15'), (date '2026-09-15')) v(d);
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source, source_ref)
  select h, (select id from public.assets limit 1), date '2026-08-15', 'sip', 5000, 10, 'cas', 'real1' from sctx;
select t.assert((select count(*) from public.mf_transactions where source = 'estimate') = 1, 'a real line removes the estimates up to its date');
update public.mf_positions set units = 100, units_as_of = '2026-09-30';
select t.assert((select count(*) from public.mf_transactions where source = 'estimate') = 0, 'counting the units removes the estimates up to that date');
rollback;
\echo 'ALL SIP HISTORY TESTS PASSED'
