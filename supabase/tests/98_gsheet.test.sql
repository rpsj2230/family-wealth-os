begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000d3', 'g-a@example.test'),
  ('00000000-0000-0000-0000-0000000000d4', 'g-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000d3');
create temp table gctx as select public.create_household('Google Sheet household') as h;
grant all on gctx to authenticated;
-- a made-up key file: long enough to look like one, containing nothing real
create temp table gkey as select '{"type":"service_account","client_email":"bot@sample-project.iam.gserviceaccount.com","private_key":"' || repeat('A', 300) || '"}' as k;
grant all on gkey to authenticated;

select public.save_gsheet((select h from gctx), '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD', (select k from gkey), 'bot@sample-project.iam.gserviceaccount.com');
select t.assert((select gsheet_key_set from public.integration_settings), 'a member can save the key and see that one is set');
select t.assert((select gsheet_id = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD' and gsheet_email = 'bot@sample-project.iam.gserviceaccount.com' from public.integration_settings), 'the spreadsheet id and the account e-mail can be read back');
select t.assert(t.throws($q$select gsheet_key from public.integration_settings$q$), 'the key cannot be read back through the app');
select t.assert(t.throws($q$select * from public.integration_settings$q$), 'select * is refused too (it includes the key)');
select t.assert(t.throws($q$select gsheet_syncing_at from public.integration_settings$q$), 'the running marker is not readable either');
select t.assert(t.throws($q$update public.integration_settings set gsheet_key = repeat('B', 300)$q$), 'direct writes are refused');
select t.assert(t.throws($q$select public.save_gsheet((select h from gctx), 'short', null, null)$q$), 'a spreadsheet id that is too short or odd is refused');
select t.assert(t.throws($q$select public.save_gsheet((select h from gctx), null, 'tiny', 'bot@sample-project.iam.gserviceaccount.com')$q$), 'a key that is too short is refused');
select t.assert(t.throws($q$select public.save_gsheet((select h from gctx), null, (select k from gkey), 'not an email')$q$), 'a malformed e-mail is refused');

-- the key is fetched once, in server code, by a member
select t.assert((select count(*) = 1 from public.gsheet_credentials((select h from gctx))), 'a member can fetch the id and key to run a test or a sync');
select t.assert((select service_key = (select k from gkey) from public.gsheet_credentials((select h from gctx))), 'what is fetched is what was saved');

-- a test result is kept; changing the id or the key clears it, saving nothing new keeps it
select public.record_gsheet_test((select h from gctx), true, 'Found 12 month tabs');
select t.assert((select gsheet_test_ok and gsheet_tested_at is not null and gsheet_test_note = 'Found 12 month tabs' from public.integration_settings), 'the test result is kept');
select public.save_gsheet((select h from gctx), '', '', '');
select t.assert((select gsheet_test_ok from public.integration_settings) and (select gsheet_key_set from public.integration_settings), 'saving nothing new keeps the key and the result');
select public.save_gsheet((select h from gctx), '2AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD', '', '');
select t.assert((select gsheet_test_ok is null and gsheet_tested_at is null from public.integration_settings) and (select gsheet_key_set from public.integration_settings), 'a new spreadsheet id clears the test result and keeps the key');

-- one sync at a time
select t.assert((select public.claim_gsheet_sync((select h from gctx))), 'the first sync may start');
select t.assert(not (select public.claim_gsheet_sync((select h from gctx))), 'a second one is told to wait');
select public.record_gsheet_sync((select h from gctx), true, 'Oct 2026', '12 rows changed');
select t.assert((select gsheet_sync_ok and gsheet_sync_month = 'Oct 2026' and gsheet_synced_at is not null and gsheet_sync_note = '12 rows changed' from public.integration_settings), 'the last sync is remembered');
select t.assert((select public.claim_gsheet_sync((select h from gctx))), 'when a sync ends the next one may start');
select t.as_root();
update public.integration_settings set gsheet_syncing_at = now() - interval '3 minutes';
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select t.assert((select public.claim_gsheet_sync((select h from gctx))), 'a sync that was cut off does not block for ever');

-- someone outside the household gets nothing
select t.as_user('00000000-0000-0000-0000-0000000000d4');
select t.assert(t.throws($q$select * from public.gsheet_credentials((select h from gctx))$q$), 'outsiders cannot fetch the key');
select t.assert(t.throws($q$select public.save_gsheet((select h from gctx), null, (select k from gkey), 'bot@sample-project.iam.gserviceaccount.com')$q$), 'outsiders cannot save');
select t.assert(t.throws($q$select public.record_gsheet_test((select h from gctx), true, 'x')$q$), 'outsiders cannot record a test');
select t.assert(t.throws($q$select public.claim_gsheet_sync((select h from gctx))$q$), 'outsiders cannot start a sync');
select t.assert(t.throws($q$select public.record_gsheet_sync((select h from gctx), true, 'x', 'x')$q$), 'outsiders cannot record a sync');
select t.assert((select count(*) from public.integration_settings) = 0, 'outsiders see nothing');

-- removing the connection removes the key and every trace of it
select t.as_user('00000000-0000-0000-0000-0000000000d3');
select public.save_gsheet((select h from gctx), null, null, null, true);
select t.assert(not (select gsheet_key_set from public.integration_settings) and (select gsheet_id is null and gsheet_email is null and gsheet_synced_at is null from public.integration_settings), 'removing the connection clears the key, the id and the history');
select t.assert((select count(*) = 0 from public.gsheet_credentials((select h from gctx))), 'and nothing can be fetched any more');
select t.as_root();
rollback;
\echo 'ALL GOOGLE SHEET TESTS PASSED'
