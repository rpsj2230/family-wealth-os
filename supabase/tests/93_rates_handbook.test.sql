begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000ad', 'r-a@example.test'),
  ('00000000-0000-0000-0000-0000000000bd', 'r-b@example.test'),
  ('00000000-0000-0000-0000-0000000000cd', 'r-c@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000ad');
create temp table rctx as select public.create_household('Rates household') as h;
grant all on rctx to authenticated;
select t.as_root();
insert into public.household_members (household_id, user_id, role) select h, '00000000-0000-0000-0000-0000000000cd', 'emergency_viewer' from rctx;

select t.as_user('00000000-0000-0000-0000-0000000000ad');
insert into public.rate_offers (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate) select h, 'Sample Bank', 'fd', 'NRE', 12, 24, 0.0775 from rctx;
select t.assert((select count(*) from public.rate_offers) = 1, 'a member can store a rate');
select t.assert(t.throws($q$insert into public.rate_offers (household_id, bank, product, rate) select h, 'X', 'fd', 0.5 from rctx$q$), 'an impossible rate is refused');
select t.assert(t.throws($q$insert into public.rate_offers (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate) select h, 'Sample Bank', 'fd', 'NRE', 12, 24, 0.07 from rctx$q$), 'the same offer cannot be stored twice');
select t.assert(t.throws($q$insert into public.rate_sources (household_id, bank, url) select h, 'X', 'http://insecure.example' from rctx$q$), 'only https pages');
insert into public.emergency_profile (household_id, content) select h, '{"message":"hello"}' from rctx;
select public.save_emergency_document((select h from rctx), '{"sections":[]}');
select t.assert((select count(*) from public.emergency_documents) = 1, 'a member can save the handbook');

select t.as_user('00000000-0000-0000-0000-0000000000cd');
select t.assert((select count(*) from public.emergency_documents) = 1, 'the emergency viewer can read the handbook');
select t.assert((select count(*) from public.rate_offers) + (select count(*) from public.emergency_profile) = 0, 'but nothing else');
select t.assert(t.throws($q$select public.save_emergency_document((select h from rctx), '{}')$q$), 'and cannot change it');

select t.as_user('00000000-0000-0000-0000-0000000000bd');
select t.assert((select count(*) from public.emergency_documents) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL RATES AND HANDBOOK TESTS PASSED'
