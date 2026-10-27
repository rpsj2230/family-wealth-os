begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'u-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b8', 'u-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
create temp table sctx as select public.create_household('Scan household') as h;
grant all on sctx to authenticated;
select public.request_statement_scan((select h from sctx));
select t.assert((select count(*) = 1 from public.statement_scans where requested_at is not null and started_at is null), 'Scan now leaves one waiting request');
select public.request_statement_scan((select h from sctx));
select t.assert((select count(*) = 1 from public.statement_scans), 'asking twice leaves a single request');
select t.assert((select requested_by = '00000000-0000-0000-0000-0000000000a8' from public.statement_scans), 'the request remembers who asked');
select t.assert(t.throws($q$insert into public.statement_scans (household_id, trigger) select h, 'manual' from sctx$q$), 'members cannot write scan rows directly');
select t.assert(t.throws($q$update public.statement_scans set found = 9$q$), 'members cannot edit scan rows');
select t.assert(t.throws($q$delete from public.statement_scans$q$), 'members cannot delete scan rows');
-- the job (service role) picks the request up and finishes the same row
select t.as_root();
-- Supabase gives the service role its rights by default; the local stand-in does not, so give them here
grant all on public.statement_scans to service_role;
set local role service_role;
update public.statement_scans set started_at = now() where requested_at is not null and started_at is null;
update public.statement_scans set finished_at = now(), found = 2, imported = 2, problems = 0, ok = true,
  detail = '[{"registrar":"CAMS","outcome":"imported"}]'::jsonb where finished_at is null;
reset role;
select t.assert((select count(*) = 1 and bool_and(found = 2 and finished_at is not null) from public.statement_scans), 'the job finishes the request it picked up');
select t.assert(t.throws($q$update public.statement_scans set detail = '{"a":1}'::jsonb$q$), 'detail must be a list');
-- a new request can be made once the first has started
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select public.request_statement_scan((select h from sctx));
select t.assert((select count(*) = 2 from public.statement_scans), 'a second request is allowed after the first was picked up');
-- requests for a full statement
insert into public.owners (household_id, display_name) select h, 'Asha' from sctx;
insert into public.statement_requests (household_id, owner_id, registrar) select h, (select id from public.owners limit 1), 'cams' from sctx;
select t.assert((select status = 'asked' and requested_on = current_date from public.statement_requests), 'a request starts as asked, dated today');
select t.assert(t.throws($q$insert into public.statement_requests (household_id, owner_id, registrar) select h, (select id from public.owners limit 1), 'someone' from sctx$q$), 'an unknown registrar is refused');
update public.statement_requests set status = 'arrived', arrived_on = current_date;
select t.assert((select status = 'arrived' from public.statement_requests), 'a member marks it arrived');
-- extra statement passwords are write-only
select public.add_statement_password((select h from sctx), (select id from public.owners limit 1), 'Pa55word!');
select public.add_statement_password((select h from sctx), (select id from public.owners limit 1), 'Pa55word!');
select public.add_statement_password((select h from sctx), (select id from public.owners limit 1), 'Other#123');
select t.assert((select saved = 2 from public.statement_password_counts((select h from sctx))), 'the app can count the saved passwords, and saving one twice keeps one');
select t.assert(t.throws($q$select * from public.statement_passwords$q$), 'a member cannot read the passwords back');
select t.assert(t.throws($q$insert into public.statement_passwords (household_id, owner_id, password) select h, (select id from public.owners limit 1), 'x' from sctx$q$), 'a member cannot write the table directly');
select t.assert(t.throws($q$select public.add_statement_password((select h from sctx), (select id from public.owners limit 1), '')$q$), 'an empty password is refused');
select t.assert(not exists (select 1 from public.audit_events where after::text like '%Pa55word%' or before::text like '%Pa55word%'), 'the audit log never copies a password');
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.assert(t.throws($q$select * from public.statement_password_counts((select h from sctx))$q$), 'outsiders cannot count them');
select t.assert(t.throws($q$select public.clear_statement_passwords((select h from sctx), (select id from public.owners limit 1))$q$), 'outsiders cannot clear them');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select public.clear_statement_passwords((select h from sctx), (select id from public.owners limit 1));
select t.assert((select count(*) = 0 from public.statement_password_counts((select h from sctx))), 'a member removes them');
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.assert((select count(*) = 0 from public.statement_requests), 'outsiders see no requests');
select t.assert((select count(*) = 0 from public.statement_scans), 'outsiders see no scans');
select t.assert(t.throws($q$select public.request_statement_scan((select h from sctx))$q$), 'outsiders cannot request a scan');
select t.as_root();
rollback;
\echo 'ALL STATEMENT SCAN TESTS PASSED'
