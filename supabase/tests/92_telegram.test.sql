begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a6', 't-a@example.test'), ('00000000-0000-0000-0000-0000000000b6', 't-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
create temp table tctx as select public.create_household('Telegram household') as h;
grant all on tctx to authenticated;

select public.save_telegram((select h from tctx), '123456789:AAEexampleTokenThatIsLongEnough_xyz', '-100123456,987654', false);
select t.assert((select telegram_set from public.integration_settings), 'saving a token and chat ids marks Telegram as set');
select t.assert((select telegram_chat_ids = '-100123456,987654' from public.integration_settings), 'the chat ids can be read back');
select t.assert(t.throws($q$select telegram_bot_token from public.integration_settings$q$), 'the token cannot be read through the app');
select t.assert(t.throws($q$select public.save_telegram((select h from tctx), 'short', '1', false)$q$), 'a token that is too short is refused');
select t.assert(t.throws($q$select public.save_telegram((select h from tctx), '123456789:AAEexampleTokenThatIsLongEnough_xyz', 'abc', false)$q$), 'chat ids must be numbers');
select public.save_telegram((select h from tctx), null, '555', false);
select t.assert((select telegram_chat_ids = '555' and telegram_set from public.integration_settings), 'the chat ids can change without sending the token again');
select t.as_user('00000000-0000-0000-0000-0000000000b6');
select t.assert(t.throws($q$select public.save_telegram((select h from tctx), '123456789:AAEexampleTokenThatIsLongEnough_xyz', '1', false)$q$), 'someone outside the household cannot save');
select t.as_user('00000000-0000-0000-0000-0000000000a6');
select public.save_telegram((select h from tctx), null, null, true);
select t.assert((select not telegram_set from public.integration_settings), 'removing it switches Telegram off');
select t.as_root();
rollback;
\echo 'ALL TELEGRAM TESTS PASSED'
