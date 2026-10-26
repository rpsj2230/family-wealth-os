begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'l-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b9', 'l-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table lctx as select public.create_household('Layout household') as h;
grant all on lctx to authenticated;
-- an existing record, as the first import created it
insert into public.owners (household_id, display_name) select h, 'Rupash' from lctx;
insert into public.institutions (household_id, name) select h, 'Jana' from lctx;
insert into public.assets (household_id, type, owner_id, institution_id, nickname, account_kind)
  select h, 'bank_account', (select id from public.owners limit 1), (select id from public.institutions limit 1), 'Cash NRE', 'joint' from lctx;
insert into public.observations (household_id, asset_id, kind, amount, as_of, source, source_ref, confidence)
  select h, (select id from public.assets limit 1), 'balance', 500, '2026-10-25', 'workbook', 'F13', 'manual_unverified' from lctx;
select t.assert((select sort_order is null from public.assets), 'before syncing there is no order');

create temp table plan as select jsonb_build_object(
  'owners', jsonb_build_array(jsonb_build_object('key','o','displayName','Rupash')),
  'institutions', jsonb_build_array(jsonb_build_object('key','i','name','Jana')),
  'assets', jsonb_build_array(
    jsonb_build_object('key','cash:13','type','bank_account','ownerKey','o','institutionKey','i','label','Cash-NRE JO-1111','row',13,'isJoint',true,'accountKind','NRE','identifierLast4','1111','notes','Lounge Card'),
    jsonb_build_object('key','cash:99','type','bank_account','ownerKey','o','institutionKey','i','label','Ghost','row',99)),
  'observations', jsonb_build_array(
    jsonb_build_object('assetKey','cash:13','sourceRef','F13'),
    jsonb_build_object('assetKey','cash:99','sourceRef','F99')),
  'fixedDeposits', '[]'::jsonb) as p;
grant all on plan to authenticated;
select t.assert(((select public.sync_workbook_layout((select h from lctx), (select p from plan))))->>'matched' = '1', 'one record matched');
select t.assert((public.sync_workbook_layout((select h from lctx), (select p from plan)))->'unmatched' @> '["Ghost"]', 'a record that cannot be matched is reported, not invented');
select t.assert((select label = 'Cash-NRE JO-1111' and sort_order = 13 and is_joint and account_kind = 'NRE' and identifier_last4 = '1111' and notes = 'Lounge Card' from public.assets), 'layout applied, NRE kept and joint flagged');
select t.assert((select amount = 500 from public.observations), 'values untouched');
-- running it again must not re-match the same record to another plan row
select t.assert((public.sync_workbook_layout((select h from lctx), (select p from plan)))->>'matched' = '0', 'a second run matches nothing new');
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.assert(t.throws($q$select public.sync_workbook_layout((select h from lctx), (select p from plan))$q$), 'outsiders cannot sync');
select t.as_root();
rollback;
\echo 'ALL LAYOUT TESTS PASSED'
