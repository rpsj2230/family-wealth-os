begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'u-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b9', 'u-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table uctx as select public.create_household('Usage household') as h;
grant all on uctx to authenticated;
select public.record_ai_usage((select h from uctx), 'anthropic', 'claude-haiku-5-5', 'rates_refresh', true, 200, 9000, 400, 700, 0, true, 2500, null);
select t.assert((select count(*) = 1 from public.ai_usage), 'a member records a call and reads it back');
select t.assert((select input_tokens = 9000 and cache_read_tokens = 700 and tokens_known from public.ai_usage), 'the tokens are kept');
select t.assert(t.throws($q$insert into public.ai_usage (household_id, provider, purpose, ok) select h, 'groq', 'other', true from uctx$q$), 'direct writes are refused');
select t.assert(t.throws($q$select public.record_ai_usage((select h from uctx), 'groq', null, 'bogus', true, 200, 1, 1, 0, 0, true, 1, null)$q$), 'an unknown purpose is refused');
select t.assert(t.throws($q$update public.ai_usage set input_tokens = 1$q$), 'rows cannot be edited from the app');
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.assert((select count(*) = 0 from public.ai_usage), 'outsiders see nothing');
select t.assert(t.throws($q$select public.record_ai_usage((select h from uctx), 'groq', null, 'other', true, 200, 1, 1, 0, 0, true, 1, null)$q$), 'outsiders cannot record');
select t.as_root();
rollback;
\echo 'ALL AI USAGE TESTS PASSED'
