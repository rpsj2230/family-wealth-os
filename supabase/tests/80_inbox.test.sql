begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a8', 'i-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b8', 'i-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a8');
create temp table ictx as select public.create_household('Inbox household') as h;
grant all on ictx to authenticated;
select public.save_integrations(h, 'groq', 'gsk_test_key_12345', 'FWOS/Inbox') from ictx;
select t.assert((select ai_key_set from public.integration_settings), 'a member can save a key and see that one is set');
select t.assert(t.throws($q$insert into public.integration_settings (household_id, ai_api_key) select h, 'abcdefghij' from ictx$q$), 'direct writes are refused');
select t.assert(t.throws($q$select ai_api_key from public.integration_settings$q$), 'the key cannot be read back through the app');
select t.assert(t.throws($q$select * from public.integration_settings$q$), 'select * is refused too (it includes the key)');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'other', 'abcdefghij', 'x')$q$), 'unknown provider rejected');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'groq', 'short', 'x')$q$), 'too-short key rejected');
select public.save_integrations(h, 'openrouter', 'sk-or-v1-test_key_12345', 'FWOS/Inbox') from ictx;
select t.assert((select ai_provider from public.integration_settings) = 'openrouter', 'OpenRouter is an accepted provider');
select public.save_integrations(h, 'gemini', 'AIza_test_key_67890', 'FWOS/Inbox') from ictx;
select t.assert((select ai_provider from public.integration_settings) = 'gemini', 'saving again replaces the key');
select public.save_integrations(h, 'gemini', '', 'My/Label') from ictx;
select t.assert((select ai_key_set from public.integration_settings) and (select inbox_label from public.integration_settings) = 'My/Label', 'an empty key keeps the saved one');
select public.save_integrations(h, null, null, null, true) from ictx;
select t.assert(not (select ai_key_set from public.integration_settings), 'clearing the key shows as not set');
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
select t.as_user('00000000-0000-0000-0000-0000000000b8');
select t.assert(t.throws($q$select public.save_integrations((select h from ictx), 'groq', 'abcdefghij', 'x')$q$), 'outsiders cannot save settings for this household');
select t.assert((select count(*) from public.inbox_messages) = 0 and (select count(*) from public.integration_settings) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL INBOX TESTS PASSED'
