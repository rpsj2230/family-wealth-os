-- Tests for goals, receivables, policies and the transactional workbook import function.
-- Assumes 00_stub.sql and all migrations are applied (see run.sh). Helper functions come from 10_rls.test.sql (schema t).
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'imp-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b1', 'imp-b@example.test');

select t.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table ictx as select public.create_household('Import household') as h;
grant all on ictx to authenticated;

create temp table iplan as select $json$
{
  "asOf": "2026-10-25",
  "owners": [{"key":"rupash","displayName":"Rupash","isMinor":false},{"key":"advika","displayName":"Advika","isMinor":true}],
  "institutions": [{"key":"yes-bank","name":"Yes Bank","kind":"bank"}],
  "assets": [
    {"key":"fd:3","type":"fixed_deposit","ownerKey":"rupash","institutionKey":"yes-bank","nickname":"FD (2021-11-01)","currency":"INR","status":"active","accountKind":"NRE"},
    {"key":"cash:4","type":"bank_account","ownerKey":"rupash","institutionKey":"yes-bank","nickname":"Cash NRE","currency":"INR","status":"active","accountKind":"NRE","identifierLast4":"1234"},
    {"key":"sg:9","type":"bank_account","ownerKey":"rupash","nickname":"UOB S$","currency":"SGD","status":"active"},
    {"key":"mf:10","type":"mutual_fund","ownerKey":"rupash","nickname":"Nippon Small Cap","currency":"INR","status":"active"},
    {"key":"loan:13","type":"receivable","ownerKey":"rupash","nickname":"Ravinder","currency":"INR","status":"active"},
    {"key":"tp:15","type":"third_party_held","ownerKey":"rupash","beneficialOwnerKey":"rupash","holderName":"Atul","nickname":"Account held by Atul","currency":"INR","status":"active"}
  ],
  "observations": [
    {"assetKey":"cash:4","kind":"balance","amount":5000,"currency":"INR","asOf":"2026-10-25","confidence":"manual_unverified","sourceRef":"F4"},
    {"assetKey":"sg:9","kind":"balance","amount":100,"currency":"SGD","fxRate":65,"asOf":"2026-10-25","confidence":"manual_unverified","sourceRef":"N9"},
    {"assetKey":"mf:10","kind":"valuation","amount":278248,"currency":"INR","asOf":"2026-10-25","confidence":"manual_unverified","sourceRef":"F10"},
    {"assetKey":"loan:13","kind":"valuation","amount":7000,"currency":"INR","asOf":"2026-10-25","confidence":"manual_unverified","sourceRef":"F13"}
  ],
  "fixedDeposits": [{"assetKey":"fd:3","principal":1000000,"rate":0.065,"bookedOn":"2021-11-01","maturityOn":"2026-11-01","bankMaturityAmount":1380416,"compounding":"quarterly"}],
  "funds": [{"assetKey":"mf:10","fundName":"Nippon India Small Cap Growth Direct Plan","planType":"direct","goalTag":"SIP Advika Education","invested":275986,"startedOn":"2024-07-26","sipMonthly":12000,"sipStopped":false,"navHint":"191.33"}],
  "receivables": [{"assetKey":"loan:13","counterparty":"Ravinder Friend","lent":50000,"lentOn":null,"repayments":[{"amount":43000,"on":"2024-09-01"}],"expectedOn":null}],
  "policies": [{"kind":"health_in","insurer":"Niva Bupa","coverage":"Niva Bupa - Unlimited","insuredKeys":["rupash","advika"]}],
  "tasks": [{"title":"Address Change","status":"open","institutionKey":"yes-bank"},{"title":"KYC Completed","status":"done","institutionKey":"yes-bank"}],
  "exceptions": [{"code":"x","severity":"needs_input","cell":"E14","message":"matured FD"},{"code":"y","severity":"warning","cell":"A1","message":"w"}],
  "reconciliation": [{"check":"total","expected":1,"actual":1,"ok":true}]
}
$json$::jsonb as p;
grant all on iplan to authenticated;

-- 1. unresolved needs_input blocks the import (nothing is written)
select t.assert(t.throws($q$select public.import_workbook_batch((select h from ictx), repeat('a',64), (select p from iplan))$q$),
  'import refused while needs_input is not acknowledged');
select t.assert((select count(*) from public.assets) = 0, 'refused import wrote nothing');

-- 2. acknowledged import succeeds in one transaction
create temp table ack as select (select p from iplan) || '{"acknowledged": {"E14": true}}'::jsonb as p;
grant all on ack to authenticated;
select public.import_workbook_batch((select h from ictx), repeat('a',64), (select p from ack));
select t.assert((select count(*) from public.owners) = 2, 'owners imported');
select t.assert((select count(*) from public.assets) = 6, 'assets imported');
select t.assert((select count(*) from public.observations) = 4, 'observations imported');
select t.assert((select count(*) from public.fixed_deposits) = 1, 'fd imported');
select t.assert((select count(*) from public.mf_positions) = 1, 'fund position imported');
select t.assert((select count(*) from public.goals where name = 'Advika Education' and kind = 'education') = 1, 'goal created from tag');
select t.assert((select value from public.goal_allocations) = 100, 'fund allocated 100% to its goal');
select t.assert((select sum(amount) from public.receivable_payments) = 43000, 'repayment recorded');
select t.assert((select count(*) from public.policy_insured) = 2, 'policy insured people recorded');
select t.assert((select count(*) from public.tasks where status = 'done' and done_at is not null) = 1, 'completed task stamped');
select t.assert((select currency from public.observations where as_of = '2026-10-25' and fx_rate is not null) = 'SGD', 'S$ observation keeps currency and rate');
select t.assert((select count(*) from public.assets where holder_name = 'Atul' and beneficial_owner_id is not null) = 1, 'third-party holder kept separate from beneficial owner');
select t.assert((select count(*) from public.import_batches) = 1, 'batch recorded');
select t.assert((select count(*) from public.audit_events where table_name = 'goal_allocations') = 1, 'new tables are audited');

-- 3. idempotent: same file twice is refused
select t.assert(t.throws($q$select public.import_workbook_batch((select h from ictx), repeat('a',64), (select p from ack))$q$), 'same file cannot be imported twice');

-- 4. outsiders cannot import into someone else's household
select t.as_user('00000000-0000-0000-0000-0000000000b1');
select t.assert(t.throws($q$select public.import_workbook_batch((select h from ictx), repeat('b',64), (select p from ack))$q$), 'outsider cannot import');
select t.assert((select count(*) from public.goals) = 0 and (select count(*) from public.receivables) = 0 and (select count(*) from public.policies) = 0, 'outsider sees none of the new tables');

-- 5. reconciliation failure blocks the import
select t.as_user('00000000-0000-0000-0000-0000000000a1');
create temp table bad as select (select p from ack) || '{"reconciliation":[{"check":"x","expected":1,"actual":2,"ok":false}]}'::jsonb as p;
grant all on bad to authenticated;
select t.assert(t.throws($q$select public.import_workbook_batch((select h from ictx), repeat('c',64), (select p from bad))$q$), 'failed reconciliation blocks import');

-- 6. goal allocation caps
select t.assert(t.throws($q$insert into public.goal_allocations (goal_id, asset_id, household_id, method, value)
   select g.id, a.id, g.household_id, 'percent', 10 from public.goals g, public.assets a where a.nickname = 'Nippon Small Cap'$q$),
   'duplicate allocation of the same goal/asset rejected');
insert into public.goals (household_id, name, kind) select h, 'Retirement', 'retirement' from ictx;
select t.assert(t.throws($q$insert into public.goal_allocations (goal_id, asset_id, household_id, method, value)
   select g.id, a.id, g.household_id, 'percent', 10 from public.goals g, public.assets a where g.name = 'Retirement' and a.nickname = 'Nippon Small Cap'$q$),
   'percent allocations over 100% in total are rejected');

select t.as_root();
rollback;
\echo 'ALL IMPORT TESTS PASSED'
