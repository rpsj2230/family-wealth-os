begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'i-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b8', 'i-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
create temp table ictx as select public.create_household('Inbox household') as h;
grant all on ictx to authenticated;
select public.save_integrations(h, 'groq', 'gsk_test_key_12345', 'FWOS/Inbox') from ictx;
select t.assert((select count(*) = 1 from public.ai_keys where provider = 'groq' and enabled and priority = 1), 'a member can save a key; it is the first choice and switched on');
select t.assert(t.throws($q$insert into public.integration_settings (household_id, ai_api_key) select h, 'abcdefghij' from ictx$q$), 'direct writes are refused');
select t.assert(t.throws($q$select api_key from public.ai_keys$q$), 'the key cannot be read back through the app');
select t.assert(t.throws($q$select * from public.ai_keys$q$), 'select * is refused too (it includes the key)');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'other', 'abcdefghij', 'x')$q$), 'unknown provider rejected');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'groq', 'short', 'x')$q$), 'too-short key rejected');
select public.save_integrations(h, 'openrouter', 'sk-or-v1-test_key_12345', 'FWOS/Inbox') from ictx;
select t.assert((select count(*) = 1 from public.ai_keys where provider = 'openrouter' and priority = 2), 'OpenRouter is an accepted provider, added after the first');
select public.save_integrations(h, 'anthropic', 'sk-ant-test_key_12345', 'FWOS/Inbox') from ictx;
select t.assert((select count(*) = 1 from public.ai_keys where provider = 'anthropic' and priority = 3), 'Anthropic is an accepted provider');
select public.save_integrations(h, 'gemini', 'AIza_test_key_67890', 'FWOS/Inbox') from ictx;
select t.assert((select count(*) = 4 from public.ai_keys), 'saving another provider adds a key; the others stay');
select public.save_integrations(h, 'gemini', '', 'My/Label') from ictx;
select t.assert((select count(*) = 4 from public.ai_keys) and (select inbox_label from public.integration_settings) = 'My/Label', 'an empty key keeps the saved ones and still saves the label');
select public.save_integrations(h, null, null, null, true) from ictx;
select t.assert((select count(*) = 0 from public.ai_keys), 'clearing removes the keys');
select t.assert(t.throws($q$insert into public.inbox_messages (household_id, message_id, outcome) select h, 'm1', 'applied' from ictx$q$), 'users cannot write inbox rows');
-- the reader job (owner/service role) writes; members read and mark resolved
select t.as_root();
insert into public.inbox_messages (household_id, message_id, outcome, reading) select h, 'm1', 'needs_review', '{"amount": 5}' from ictx;
select t.assert(t.throws($q$insert into public.inbox_messages (household_id, message_id, outcome) select h, 'm1', 'ignored' from ictx$q$), 'the same message is never logged twice');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select t.assert((select count(*) from public.inbox_messages) = 1, 'members read the log');
update public.inbox_messages set resolved_at = now();
select t.assert((select resolved_at is not null from public.inbox_messages), 'members can mark a message resolved');
select t.assert(t.throws($q$update public.inbox_messages set outcome = 'applied'$q$), 'but cannot change what happened');
-- the Settings page tests the connection: members get the key for that, once, in server code; outsiders get nothing
select public.save_integrations((select h from ictx), 'groq', 'gsk_test_key_12345', 'FWOS/Inbox');
select t.assert((select count(*) = 1 from public.ai_credentials_for_test((select h from ictx))), 'a member can fetch the key to test it');
select public.record_ai_test((select h from ictx), true, 'Read a test alert');
select t.assert((select test_ok and tested_at is not null and test_note = 'Read a test alert' from public.ai_keys where provider = 'groq'), 'the test result is kept');
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.assert(t.throws($q$select * from public.ai_credentials_for_test((select h from ictx))$q$), 'outsiders cannot fetch the key');
select t.assert(t.throws($q$select public.record_ai_test((select h from ictx), true, 'x')$q$), 'outsiders cannot record a test');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'groq', 'abcdefghij', 'x')$q$), 'outsiders cannot save settings for this household');
select t.assert((select count(*) from public.inbox_messages) = 0 and (select count(*) from public.integration_settings) = 0 and (select count(*) from public.ai_keys) = 0, 'outsiders see nothing');
-- reading one email again: members save the result through a function that touches only the log row
select t.as_user('00000000-0000-0000-0000-0000000000a8');
select public.save_inbox_result((select id from public.inbox_messages where message_id = 'm1'), 'applied', null, '{"amount": 7}', null, true);
select t.assert((select outcome = 'applied' and (reading->>'amount') = '7' and resolved_at is not null and rescan_requested_at is null from public.inbox_messages where message_id = 'm1'), 'a member can save the result of reading a message again');
select t.assert(t.throws($q$select public.save_inbox_result((select id from public.inbox_messages where message_id = 'm1'), 'bogus', null, null, null)$q$), 'an unknown outcome is refused');
update public.inbox_messages set rescan_requested_at = now() where message_id = 'm1';
select t.assert((select rescan_requested_at is not null from public.inbox_messages where message_id = 'm1'), 'a member can ask for a message to be read again');
select t.assert(t.throws($q$update public.inbox_messages set body_text = 'edited' where message_id = 'm1'$q$), 'the kept copy of an email cannot be edited from the app');
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.assert(t.throws($q$select public.save_inbox_result('00000000-0000-0000-0000-000000000001', 'applied', null, null, null)$q$), 'outsiders cannot save a result');
select t.as_root();
rollback;
\echo 'ALL INBOX TESTS PASSED'
