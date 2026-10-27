begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'cp-a@example.test'),
  ('00000000-0000-0000-0000-0000000000c2', 'cp-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000c1');
create temp table pctx as select public.create_household('Priority household') as h;
grant all on pctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from pctx;
insert into public.assets (household_id, type, owner_id, nickname)
  select h, 'mutual_fund', (select id from public.owners limit 1), 'Sample Fund' from pctx;
create temp table passet as select id as a from public.assets limit 1;
grant all on passet to authenticated;
insert into public.mf_positions (asset_id, household_id, fund_name, invested, started_on)
  select (select a from passet), h, 'Sample Fund', 0, '2024-01-05' from pctx;

-- lines from four places: a statement, an app export, an estimate, typed by hand
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, description, source, source_ref)
  select h, (select a from passet), d, 'sip', 5000, 50, 100, descr, src, ref from pctx,
  (values
    (date '2024-01-05', 'Systematic Investment Purchase', 'cas', 'cas-1'),
    (date '2024-02-05', 'Purchase (folio 1234)', 'csv', 'csv-1'),
    (date '2024-04-05', 'Entered by hand', 'manual', 'manual:1')
  ) as v(d, descr, src, ref);
-- an estimate is added after the real lines (a real line arriving later would drop it)
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, nav, description, source, source_ref)
  select h, (select a from passet), '2024-03-05', 'sip', 5000, 50, 100, 'Estimated from the monthly investment', 'estimate', 'est:2024-03-05' from pctx;
select t.assert((select count(*) from public.mf_transactions where superseded_on is null) = 4, 'every new line is live');

-- the statement replaces the app export, the estimate and the hand-typed line, but never one of its own
select t.assert(
  public.supersede_fund_lines((select h from pctx), (select a from passet), array['cas-1','csv-1','est:2024-03-05','manual:1'],
    'upload:abc', date '2026-10-27', 'Replaced by the fund statement dated 27 Oct 2026') = 3,
  'three lower lines are set aside');
select t.assert((select count(*) from public.mf_transactions where superseded_on is not null) = 3, 'they are marked');
select t.assert((select count(*) from public.mf_transactions) = 4, 'nothing is deleted');
select t.assert((select superseded_on is null from public.mf_transactions where source_ref = 'cas-1'), 'a statement line is never set aside');
select t.assert((select superseded_by_ref = 'upload:abc' and superseded_statement_on = date '2026-10-27' and superseded_reason like 'Replaced by%'
  from public.mf_transactions where source_ref = 'csv-1'), 'the line says which statement replaced it, and why');

-- saying it again sets nothing aside again
select t.assert(
  public.supersede_fund_lines((select h from pctx), (select a from passet), array['csv-1','manual:1'], 'upload:other', date '2026-10-30', null) = 0,
  'a line already set aside is not set aside twice');
select t.assert((select superseded_by_ref from public.mf_transactions where source_ref = 'csv-1') = 'upload:abc', 'the first statement stays on record');

-- the set-aside columns are all set or all empty
select t.assert(t.throws($q$update public.mf_transactions set superseded_on = now() where source_ref = 'cas-1'$q$), 'a half-marked line is refused');

-- a set-aside estimate is not dropped when a real line arrives
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source, source_ref)
  select h, (select a from passet), '2024-06-05', 'sip', 5000, 50, 'cas', 'cas-2' from pctx;
select t.assert((select count(*) from public.mf_transactions where source_ref = 'est:2024-03-05') = 1, 'a set-aside estimate stays when a real line arrives');

-- a later statement that has the very same line brings it back as its own
select t.assert(public.restore_fund_lines((select h from pctx), (select a from passet), array['csv-1']) = 1, 'a line the statement has again is restored');
select t.assert((select superseded_on is null and source = 'cas' and superseded_by_ref is null from public.mf_transactions where source_ref = 'csv-1'), 'it is live and from the statement');

-- the period of the statement that decided the fund
update public.mf_positions set cas_detail_from = '1986-10-01', cas_detail_to = '2026-10-27';
select t.assert((select cas_detail_to from public.mf_positions) = date '2026-10-27', 'the period is recorded');
select t.assert(t.throws($q$update public.mf_positions set cas_detail_from = '2026-11-01'$q$), 'a period cannot end before it starts');

-- setting aside and bringing back are logged
select t.as_root();
select t.assert((select count(*) from public.audit_events where table_name = 'mf_transactions') >= 4, 'setting aside and restoring are in the audit log');
select t.assert((select count(*) from public.audit_events where table_name = 'mf_transactions' and action = 'insert') = 0, 'ordinary line inserts are not logged');

-- somebody else's household is out of reach
select t.as_user('00000000-0000-0000-0000-0000000000c2');
select t.assert(public.supersede_fund_lines((select h from pctx), (select a from passet), array['cas-2','manual:1'], 'upload:x', date '2026-10-27', null) = 0, 'a stranger sets nothing aside');
select t.assert((select count(*) from public.mf_transactions) = 0, 'a stranger sees no lines');
select t.as_root();
rollback;
\echo 'ALL CAS PRIORITY TESTS PASSED'
