begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c7', 'edit@example.test'), ('00000000-0000-0000-0000-0000000000d7', 'other@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000c7');
create temp table ectx as select public.create_household('Edit household') as h;
grant all on ectx to authenticated;
select t.as_root();
insert into public.owners (household_id, display_name) select h, 'Owner' from ectx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select id from public.owners where display_name = 'Owner'), 'mutual_fund', 'Edit Fund', 'INR' from ectx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select id from public.owners where display_name = 'Owner'), 'bank_account', 'Pay Account', 'INR' from ectx;
create temp table ea as select (select id from public.assets where nickname = 'Edit Fund') as a, (select id from public.assets where nickname = 'Pay Account') as b;
grant all on ea to authenticated;
insert into public.mf_positions (asset_id, household_id, fund_name, invested, units, units_as_of, started_on, sip_monthly)
  select (select a from ea), h, 'Edit Fund', 0, 0, current_date - 400, current_date - 400, 5000 from ectx;
-- a line from a statement, and an estimate the daily job keeps
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, source, source_ref)
  select h, (select a from ea), current_date - 300, 'purchase', 10000, 100, 100, 'cas', 'cas:1' from ectx;
update public.mf_positions set units = 100, invested = 10000;

select t.as_user('00000000-0000-0000-0000-0000000000c7');

-- 1. edit and delete -------------------------------------------------------------------------------------------------------
select public.add_fund_transaction((select h from ectx), (select a from ea), jsonb_build_object('date', current_date - 200, 'kind', 'purchase', 'amount', 5000, 'nav', 50));
create temp table el as select id from public.mf_transactions where source = 'manual';
select t.assert((select units = 200 and invested = 15000 from public.mf_positions), 'a purchase typed in adds units and cost');
select t.assert((select count(*) from public.audit_events where table_name = 'mf_transactions' and action = 'INSERT') = 1, 'a line typed in is logged');

select public.edit_fund_transaction((select h from ectx), (select id from el), jsonb_build_object('date', current_date - 199, 'kind', 'purchase', 'amount', 6000, 'units', 120));
select t.assert((select units = 220 and invested = 16000 from public.mf_positions), 'an edit swaps the old effect for the new');
select t.assert((select txn_on = current_date - 199 and amount = 6000 and units = 120 and description = 'Entered by hand (corrected)' from public.mf_transactions where id = (select id from el)), 'the line holds the corrected figures');
select t.assert((select count(*) from public.audit_events where table_name = 'mf_transactions' and action = 'UPDATE' and row_id = (select id::text from el)) = 1, 'the edit is logged with the figures before and after');

select public.add_fund_transaction((select h from ectx), (select a from ea), jsonb_build_object('date', current_date - 100, 'kind', 'redeem', 'amount', 11000, 'units', 110));
create temp table es as select id from public.mf_transactions where kind = 'redeem';
select t.assert((select units = 110 and invested = 8000 from public.mf_positions), 'a sale takes out half the units and half the cost');
select public.delete_fund_transaction((select h from ectx), (select id from es));
select t.assert((select units = 220 and invested = 16000 from public.mf_positions), 'deleting the sale puts its units and their cost back exactly');
select t.assert((select count(*) from public.audit_events where table_name = 'mf_transactions' and action = 'DELETE') = 1, 'the delete is logged');

select t.assert(t.throws($q$select public.edit_fund_transaction((select h from ectx), (select id from public.mf_transactions where source = 'cas'), '{"date":"2026-01-01","kind":"purchase","amount":1,"units":1}')$q$), 'a statement line cannot be edited');
select public.delete_fund_transaction((select h from ectx), (select id from public.mf_transactions where source = 'cas'));
select t.assert((select units = 120 and invested = 6000 from public.mf_positions), 'a statement line can be deleted, and its effect goes with it');
select t.as_root();
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, source, source_ref, description)
  select h, (select a from ea), current_date - 5, 'sip', 5000, 50, 100, 'estimate', 'est:x', 'Estimated SIP instalment, not yet on a statement' from ectx;
select t.as_user('00000000-0000-0000-0000-0000000000c7');
select t.assert(t.throws($q$select public.delete_fund_transaction((select h from ectx), (select id from public.mf_transactions where source = 'estimate'))$q$), 'an estimate is changed through the SIP, not deleted');
select t.assert(t.throws($q$select public.edit_fund_transaction((select h from ectx), (select id from el), jsonb_build_object('date', current_date + 3, 'kind', 'purchase', 'amount', 1, 'units', 1))$q$), 'a future date is refused');
select t.assert(t.throws($q$select public.edit_fund_transaction((select h from ectx), (select id from el), jsonb_build_object('date', current_date - 1, 'kind', 'redeem', 'amount', 1, 'units', 99999))$q$), 'an edit cannot sell more than is held');

-- 2. a dated SIP schedule, and a pause that ends by itself ----------------------------------------------------------------
select public.schedule_sip((select h from ectx), (select a from ea), current_date - 30, 8000, null);
select t.assert((select monthly from public.mf_sip_changes where effective_on = current_date - 400) = 5000, 'the amount that ran before is kept from the start date');
select t.assert((select sip_monthly = 8000 and not sip_stopped from public.mf_positions), 'a change dated in the past is in force now');
select public.schedule_sip((select h from ectx), (select a from ea), current_date + 10, 0, current_date + 70);
select t.assert((select monthly from public.mf_sip_changes where effective_on = current_date + 10) = 0, 'the pause starts on its date');
select t.assert((select monthly from public.mf_sip_changes where effective_on = current_date + 70) = 8000, 'and the SIP starts again at the amount before it');
select t.assert((select sip_monthly = 8000 and not sip_stopped from public.mf_positions), 'a pause that has not started leaves the SIP running today');
select public.schedule_sip((select h from ectx), (select a from ea), current_date - 2, 0, current_date + 40);
select t.assert((select sip_stopped from public.mf_positions), 'a pause that has started shows the SIP as stopped');
select t.assert((select count(*) from public.mf_sip_changes where effective_on = current_date + 10) = 0, 'a change inside the new pause is replaced by it');
select t.assert(t.throws($q$select public.schedule_sip((select h from ectx), (select a from ea), current_date + 5, 0, current_date + 1)$q$), 'the SIP must start again after the pause begins');
select t.assert(t.throws($q$select public.schedule_sip((select h from ectx), (select a from ea), current_date - 999, 1000, null)$q$), 'a change before the SIP started is refused');
select public.remove_sip_change((select h from ectx), (select a from ea), current_date - 2);
select t.assert((select sip_monthly = 8000 and not sip_stopped from public.mf_positions), 'taking back the pause brings the SIP back today');
select t.assert(t.throws($q$select public.remove_sip_change((select h from ectx), (select a from ea), current_date - 400)$q$), 'the starting amount is kept while later changes depend on it');
select t.as_root();
update public.mf_sip_changes set effective_on = current_date - 1 where effective_on = current_date + 40;
-- as if the pause were still showing (set without writing a change)
select set_config('app.sip_schedule_sync', '1', true);
update public.mf_positions set sip_stopped = true;
select set_config('app.sip_schedule_sync', '', true);
select t.as_user('00000000-0000-0000-0000-0000000000c7');
select public.sync_sip_positions(null);
select t.assert((select not sip_stopped from public.mf_positions), 'the daily job ends a pause on its date');

-- 3. selling everything closes the fund ----------------------------------------------------------------------------------
select public.add_fund_transaction((select h from ectx), (select a from ea), jsonb_build_object('date', current_date, 'kind', 'redeem', 'amount', 15000, 'all', true));
select t.assert((select units = 0 and invested = 0 from public.mf_positions), 'nothing is left after selling every unit');
select t.assert((select -units from public.mf_transactions where kind = 'redeem') = 120, 'the sale is for every unit on the real lines (estimates left out)');
select t.assert((select status from public.assets where id = (select a from ea)) = 'closed', 'the fund is closed');
select t.assert((select sip_stopped from public.mf_positions) and (select monthly from public.mf_sip_changes order by effective_on desc limit 1) = 0, 'and its SIP is stopped from the sale');
select t.assert(t.throws($q$select public.add_fund_transaction((select h from ectx), (select a from ea), jsonb_build_object('date', current_date, 'kind', 'purchase', 'amount', 1, 'units', 1, 'all', true))$q$), 'only a sale can be for every unit');

-- 4. the account a SIP is paid from ----------------------------------------------------------------------------------------
update public.mf_positions set sip_from_asset_id = (select b from ea);
select t.assert((select sip_from_asset_id from public.mf_positions) = (select b from ea), 'a SIP can name the account it is paid from');

-- outsiders --------------------------------------------------------------------------------------------------------------
select t.as_user('00000000-0000-0000-0000-0000000000d7');
select t.assert(t.throws($q$select public.edit_fund_transaction((select h from ectx), (select id from el), '{"date":"2026-01-01","kind":"purchase","amount":1,"units":1}')$q$), 'outsiders cannot edit lines');
select t.assert(t.throws($q$select public.delete_fund_transaction((select h from ectx), (select id from el))$q$), 'nor delete them');
select t.assert(t.throws($q$select public.schedule_sip((select h from ectx), (select a from ea), current_date, 0, null)$q$), 'nor change a SIP');
select t.assert((select public.sync_sip_positions(null)) = 0, 'and the daily sync touches nothing of theirs');
select t.as_root();
rollback;
\echo 'ALL FUND EDIT TESTS PASSED'
