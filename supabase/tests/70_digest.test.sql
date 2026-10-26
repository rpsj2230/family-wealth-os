begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'd-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b7', 'd-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table dctx as select public.create_household('Digest household') as h;
grant all on dctx to authenticated;
insert into public.digest_settings (household_id, enabled, extra_recipients) select h, true, array['mum@example.test'] from dctx;
select t.assert((select enabled from public.digest_settings), 'settings saved, opt-in');
select t.assert(t.throws($q$update public.digest_settings set extra_recipients = array['not-an-email']$q$), 'bad address rejected');
select t.assert(t.throws($q$update public.digest_settings set extra_recipients = array['a@b.co','b@b.co','c@b.co','d@b.co','e@b.co','f@b.co']$q$), 'more than five extra recipients rejected');
select t.assert(t.throws($q$insert into public.digest_log (household_id, digest_date, status) select h, current_date, 'sending' from dctx$q$), 'users cannot write the delivery log');
-- the job (service role / owner) writes the log; the unique key prevents a second send for the same day
select t.as_root();
insert into public.digest_log (household_id, digest_date, status) select h, current_date, 'sending' from dctx;
select t.assert(t.throws($q$insert into public.digest_log (household_id, digest_date, status) select h, current_date, 'sending' from dctx$q$), 'duplicate for the same day is refused');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
select t.assert((select count(*) from public.digest_log) = 1, 'members can read the log');
select t.as_user('00000000-0000-0000-0000-0000000000b7');
select t.assert((select count(*) from public.digest_settings) = 0 and (select count(*) from public.digest_log) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL DIGEST TESTS PASSED'
