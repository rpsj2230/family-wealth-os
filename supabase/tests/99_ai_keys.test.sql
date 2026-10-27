begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ae', 'k-a@example.test'),
  ('00000000-0000-0000-0000-0000000000be', 'k-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000ae');
create temp table kctx as select public.create_household('Key household') as h;
grant all on kctx to authenticated;

-- the single key of the old design is moved here as the first choice (run again: nothing changes)
select t.as_root();
insert into public.integration_settings (household_id, ai_provider, ai_api_key, ai_tested_at, ai_test_ok, ai_test_note)
  select h, 'groq', 'gsk_legacy_key_1234', now(), true, 'Read a test alert' from kctx;
select public.ai_keys_adopt_legacy();
select t.assert((select count(*) = 1 from public.ai_keys), 'the legacy key is moved into ai_keys');
select t.assert((select provider = 'groq' and api_key = 'gsk_legacy_key_1234' and priority = 1 and enabled and test_ok and test_note = 'Read a test alert' from public.ai_keys), 'as the first choice, switched on, with its last test');
select t.assert((select ai_api_key is null and ai_provider is null and not ai_key_set and ai_test_ok is null from public.integration_settings), 'the legacy columns no longer hold a copy of the key');
select public.ai_keys_adopt_legacy();
select t.assert((select count(*) = 1 from public.ai_keys), 'moving again changes nothing');

-- a member adds keys; each goes to the end of the order
select t.as_user('00000000-0000-0000-0000-0000000000ae');
select public.save_ai_key(h, 'anthropic', 'sk-ant-test_key_12345', 'Main') from kctx;
select public.save_ai_key(h, 'openrouter', 'sk-or-v1-test_key_12345') from kctx;
select t.assert((select string_agg(provider, ',' order by priority) = 'groq,anthropic,openrouter' from public.ai_keys), 'keys are tried in the order they were added');
select t.assert((select array_agg(priority order by priority) = array[1,2,3]::smallint[] from public.ai_keys), 'priorities are 1, 2, 3');
select t.assert((select label = 'Main' from public.ai_keys where provider = 'anthropic'), 'a key can carry a label');
select t.assert((select bool_and(enabled) from public.ai_keys), 'new keys are switched on');

-- write-only
select t.assert(t.throws($q$select api_key from public.ai_keys$q$), 'the key cannot be read back through the app');
select t.assert(t.throws($q$select * from public.ai_keys$q$), 'select * is refused too (it includes the key)');
select t.assert(t.throws($q$select priority, provider from public.ai_keys where api_key like 'sk%'$q$), 'the key cannot be used to filter either');
select t.assert((select count(*) = 3 from (select provider, priority, enabled, label, last_ok_at, last_error, tested_at, test_ok from public.ai_keys) x), 'everything but the key can be read');
select t.assert(t.throws($q$insert into public.ai_keys (household_id, provider, api_key, priority) select h, 'gemini', 'abcdefghij', 4 from kctx$q$), 'direct inserts are refused');
select t.assert(t.throws($q$update public.ai_keys set api_key = 'abcdefghij'$q$), 'direct updates are refused');
select t.assert(t.throws($q$update public.ai_keys set enabled = false$q$), 'the switch is changed through the function only');
select t.assert(t.throws($q$delete from public.ai_keys$q$), 'direct deletes are refused');
select t.assert(t.throws($q$select public.ai_keys_renumber((select h from kctx))$q$), 'the renumbering helper is not callable by members');
select t.assert(t.throws($q$select public.ai_keys_adopt_legacy()$q$), 'nor is the legacy move');

-- validation
select t.assert(t.throws($q$select public.save_ai_key((select h from kctx), 'other', 'abcdefghij')$q$), 'unknown provider rejected');
select t.assert(t.throws($q$select public.save_ai_key((select h from kctx), 'gemini', 'short')$q$), 'too-short key rejected');
select t.assert(t.throws($q$select public.save_ai_key((select h from kctx), 'gemini', '')$q$), 'an empty key cannot add a provider');
select t.assert(t.throws($q$select public.save_ai_key((select h from kctx), 'gemini', 'abcdefghij', repeat('x', 61))$q$), 'a label over 60 characters is rejected');
select t.assert((select count(*) = 3 from public.ai_keys), 'nothing was added by the rejected calls');

-- replace: the place and the switch stay, the status starts over
select public.record_ai_key_use(h, 'anthropic', true, 200, null, 'claude-haiku-5-5') from kctx;
select public.record_ai_key_use(h, 'anthropic', false, 401, 'refused the key', null) from kctx;
select public.record_ai_key_test(h, 'anthropic', true, 'ok') from kctx;
select public.set_ai_key_enabled(h, 'anthropic', false) from kctx;
select public.save_ai_key(h, 'anthropic', 'sk-ant-NEW_key_67890') from kctx;
select t.as_root();
select t.assert((select api_key = 'sk-ant-NEW_key_67890' from public.ai_keys where provider = 'anthropic'), 'saving a provider again replaces its key');
select t.as_user('00000000-0000-0000-0000-0000000000ae');
select t.assert((select priority = 2 and not enabled and label = 'Main' from public.ai_keys where provider = 'anthropic'), 'the replaced key keeps its place, its switch and its label');
select t.assert((select last_ok_at is null and last_error_at is null and last_error is null and last_model is null and tested_at is null and test_ok is null from public.ai_keys where provider = 'anthropic'), 'a new key starts with a clean status');
select public.save_ai_key(h, 'anthropic', '', 'Renamed') from kctx;
select t.as_root();
select t.assert((select api_key = 'sk-ant-NEW_key_67890' from public.ai_keys where provider = 'anthropic'), 'an empty key keeps the saved one');
select t.as_user('00000000-0000-0000-0000-0000000000ae');
select t.assert((select label = 'Renamed' from public.ai_keys where provider = 'anthropic'), 'and only changes the label');

-- switch on and off; the server sees only the ones that are on, in order
select t.assert((select string_agg(provider, ',' order by priority) = 'groq,openrouter' from public.ai_keys_for_server((select h from kctx))), 'a switched-off key is kept but not handed to the server');
select t.assert((select string_agg(provider, ',' order by priority) = 'groq,anthropic,openrouter' from public.ai_keys_for_server((select h from kctx), true)), 'the full list is available for testing a single key');
select t.assert((select bool_and(api_key is not null and length(api_key) >= 8) from public.ai_keys_for_server((select h from kctx), true)), 'server code receives the keys');
select public.set_ai_key_enabled(h, 'anthropic', true) from kctx;
select t.assert((select string_agg(provider, ',' order by priority) = 'groq,anthropic,openrouter' from public.ai_keys_for_server((select h from kctx))), 'switched back on, it is tried again in its place');
select t.assert(t.throws($q$select public.set_ai_key_enabled((select h from kctx), 'gemini', false)$q$), 'a provider with no key cannot be switched');

-- reorder
select public.move_ai_key(h, 'groq', 'down') from kctx;
select t.assert((select string_agg(provider, ',' order by priority) = 'anthropic,groq,openrouter' from public.ai_keys), 'moving down swaps with the next key');
select public.move_ai_key(h, 'openrouter', 'up') from kctx;
select t.assert((select string_agg(provider, ',' order by priority) = 'anthropic,openrouter,groq' from public.ai_keys), 'moving up swaps with the previous key');
select public.move_ai_key(h, 'anthropic', 'up') from kctx;
select public.move_ai_key(h, 'groq', 'down') from kctx;
select t.assert((select string_agg(provider, ',' order by priority) = 'anthropic,openrouter,groq' from public.ai_keys), 'the first cannot go up and the last cannot go down');
select t.assert((select array_agg(priority order by priority) = array[1,2,3]::smallint[] from public.ai_keys), 'priorities stay 1, 2, 3');
select t.assert((select provider = 'anthropic' from public.ai_keys_for_server((select h from kctx)) order by priority limit 1), 'the server gets the new first choice first');
select t.assert(t.throws($q$select public.move_ai_key((select h from kctx), 'groq', 'sideways')$q$), 'only up and down are accepted');
select t.assert(t.throws($q$select public.move_ai_key((select h from kctx), 'gemini', 'up')$q$), 'a provider with no key cannot be moved');

-- status recording
select public.record_ai_key_use(h, 'groq', true, 200, null, 'llama-3.3-70b-versatile') from kctx;
select t.assert((select last_ok_at is not null and last_model = 'llama-3.3-70b-versatile' and last_error_at is null from public.ai_keys where provider = 'groq'), 'a good use records when and with which model');
select public.record_ai_key_use(h, 'groq', false, 429, repeat('busy ', 100), null) from kctx;
select t.assert((select last_error_at is not null and last_error_status = 429 and length(last_error) = 300 and last_ok_at is not null from public.ai_keys where provider = 'groq'), 'a failure records the status, a short reason and when, and keeps the last good time');
select public.record_ai_key_use(h, 'groq', false, 0, 'did not answer', null) from kctx;
select t.assert((select last_error_status = 0 and last_error = 'did not answer' from public.ai_keys where provider = 'groq'), 'a failure with no answer is status 0');
select public.record_ai_key_use(h, 'gemini', false, 500, 'x', null) from kctx;
select t.assert((select count(*) = 3 from public.ai_keys), 'recording for a key that is not saved changes nothing');
select public.record_ai_key_test(h, 'openrouter', false, 'No free model') from kctx;
select t.assert((select not test_ok and tested_at is not null and test_note = 'No free model' from public.ai_keys where provider = 'openrouter'), 'a test result is kept per key');

-- the single-key compatibility functions follow the first key switched on
select public.set_ai_key_enabled(h, 'anthropic', false) from kctx;
select t.assert((select provider = 'openrouter' from public.ai_credentials_for_test((select h from kctx))), 'the single-key test gets the first key that is switched on');
select public.record_ai_test((select h from kctx), true, 'Read a test alert');
select t.assert((select test_ok and test_note = 'Read a test alert' from public.ai_keys where provider = 'openrouter'), 'and its result lands on that key');

-- remove
select public.remove_ai_key(h, 'anthropic') from kctx;
select t.assert((select string_agg(provider || priority, ',' order by priority) = 'openrouter1,groq2' from public.ai_keys), 'removing a key closes the gap');
select public.remove_ai_key(h, 'gemini') from kctx;
select t.assert((select count(*) = 2 from public.ai_keys), 'removing a provider that has no key does nothing');

-- outsiders get nothing
select t.as_user('00000000-0000-0000-0000-0000000000be');
select t.assert((select count(*) = 0 from public.ai_keys), 'outsiders see no keys');
select t.assert(t.throws($q$select * from public.ai_keys_for_server((select h from kctx))$q$), 'outsiders cannot fetch the keys');
select t.assert(t.throws($q$select * from public.ai_keys_for_server((select h from kctx), true)$q$), 'not even the full list');
select t.assert(t.throws($q$select * from public.ai_credentials_for_test((select h from kctx))$q$), 'nor through the single-key function');
select t.assert(t.throws($q$select public.save_ai_key((select h from kctx), 'gemini', 'abcdefghij')$q$), 'outsiders cannot add a key');
select t.assert(t.throws($q$select public.set_ai_key_enabled((select h from kctx), 'groq', false)$q$), 'or switch one');
select t.assert(t.throws($q$select public.move_ai_key((select h from kctx), 'groq', 'up')$q$), 'or move one');
select t.assert(t.throws($q$select public.remove_ai_key((select h from kctx), 'groq')$q$), 'or remove one');
select t.assert(t.throws($q$select public.record_ai_key_use((select h from kctx), 'groq', true, 200, null, null)$q$), 'or record a use');
select t.assert(t.throws($q$select public.record_ai_key_test((select h from kctx), 'groq', true, 'x')$q$), 'or a test');
select t.assert(t.throws($q$select public.save_integrations((select h from kctx), 'groq', 'abcdefghij', 'x')$q$), 'or use the single-key function');
-- and a second household is separate
create temp table kctx2 as select public.create_household('Other household') as h;
grant all on kctx2 to authenticated;
select public.save_ai_key(h, 'gemini', 'AIza_other_key_12345') from kctx2;
select t.assert((select count(*) = 1 from public.ai_keys), 'each household sees only its own keys');
select t.assert((select count(*) = 1 from public.ai_keys_for_server((select h from kctx2))), 'and fetches only its own');
select t.as_user('00000000-0000-0000-0000-0000000000ae');
select t.assert((select count(*) = 2 from public.ai_keys), 'the first household still has its two');
select t.assert(t.throws($q$select * from public.ai_keys_for_server((select h from kctx2))$q$), 'and cannot fetch the other household''s keys');
select t.as_root();
rollback;
\echo 'ALL AI KEY TESTS PASSED'
