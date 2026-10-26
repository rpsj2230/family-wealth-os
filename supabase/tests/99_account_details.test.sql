begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a9', 'd-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b9', 'd-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a9');
create temp table dctx as select public.create_household('Details household') as h;
grant all on dctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from dctx;
insert into public.owners (household_id, display_name) select h, 'Partner' from dctx;
insert into public.institutions (household_id, name) select h, 'Sample Bank' from dctx;
insert into public.institutions (household_id, name) select h, 'Other Bank' from dctx;
create temp table dref as select
  (select id from public.owners where display_name = 'Parent') as p,
  (select id from public.owners where display_name = 'Partner') as q,
  (select id from public.institutions where name = 'Sample Bank') as b1,
  (select id from public.institutions where name = 'Other Bank') as b2;
grant all on dref to authenticated;
insert into public.assets (household_id, type, owner_id, institution_id, nickname, identifier_last4)
  select h, 'bank_account', (select p from dref), (select b1 from dref), 'Cash A', '0266' from dctx;
insert into public.assets (household_id, type, owner_id, institution_id, nickname)
  select h, 'fixed_deposit', (select p from dref), (select b1 from dref), 'FD A' from dctx;
create temp table dass as select
  (select id from public.assets where nickname = 'Cash A') as cash,
  (select id from public.assets where nickname = 'FD A') as fd;
grant all on dass to authenticated;
insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on)
  select (select fd from dass), h, 1000000, 0.07, '2025-11-01', '2026-11-01' from dctx;
insert into public.observations (household_id, asset_id, kind, amount, currency, as_of, source, confidence)
  select h, (select cash from dass), 'balance', 12345, 'INR', '2026-10-25', 'manual', 'manual_confirmed' from dctx;

-- changes are applied, only for the keys sent
select t.assert((public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object(
  'id', (select cash from dass), 'accountKind', 'NRE', 'isJoint', true, 'last4', '0278', 'label', 'Cash-NRE JO-0278',
  'notes', 'AMB 10k', 'status', 'active', 'ownerId', (select q from dref), 'institutionId', (select b2 from dref)))))->>'accounts' = '1', 'one account was changed');
select t.assert((select account_kind = 'NRE' and is_joint and identifier_last4 = '0278' and label = 'Cash-NRE JO-0278' and notes = 'AMB 10k' and owner_id = (select q from dref) and institution_id = (select b2 from dref) from public.assets where id = (select cash from dass)), 'type, joint, digits, label, note, person and bank are saved');
select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'notes', null)));
select t.assert((select notes is null and account_kind = 'NRE' and label = 'Cash-NRE JO-0278' from public.assets where id = (select cash from dass)), 'a key left out is left alone, and null clears');
select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select fd from dass), 'accountKind', 'NRE', 'linkedLast4', '0278', 'fdRate', 0.0725, 'fdMaturityOn', '2026-12-01', 'fdPrincipal', 1100000, 'fdMaturityAmount', 1190000, 'fdRefLast4', '5076')));
select t.assert((select rate = 0.0725 and maturity_on = '2026-12-01' and principal = 1100000 and bank_maturity_amount = 1190000 and fd_ref_last4 = '5076' from public.fixed_deposits), 'a deposit''s terms are saved');
select t.assert((select account_kind = 'NRE' and linked_last4 = '0278' from public.assets where id = (select fd from dass)), 'and its tags');

-- balances are never touched
select t.assert((select count(*) = 1 and max(amount) = 12345 from public.observations), 'balances are untouched');

-- refusals
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'last4', '12345')))$q$), 'malformed last four digits are refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'accountKind', 'MARS')))$q$), 'an unknown type is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'ownerId', gen_random_uuid())))$q$), 'a person from nowhere is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'institutionId', gen_random_uuid())))$q$), 'a bank from nowhere is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select fd from dass), 'fdRate', 0.5)))$q$), 'an impossible rate is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select fd from dass), 'fdMaturityOn', '2025-01-01')))$q$), 'a maturity before the start is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'fdRate', 0.05)))$q$), 'deposit terms on a savings account are refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', gen_random_uuid(), 'notes', 'x')))$q$), 'an unknown account is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'notes', repeat('x', 501))))$q$), 'an overlong note is refused');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'accountKind', 'NRO'), jsonb_build_object('id', gen_random_uuid())))$q$), 'one bad row refuses the whole save');
select t.assert((select account_kind = 'NRE' from public.assets where id = (select cash from dass)), 'and nothing from it was applied');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), (select jsonb_agg(jsonb_build_object('id', gen_random_uuid())) from generate_series(1, 501)))$q$), 'more than 500 rows is refused');

-- the same type on many accounts
select t.assert(public.set_account_kind((select h from dctx), array[(select cash from dass), (select fd from dass)], 'NRO') = 2, 'two accounts were retyped');
select t.assert((select count(*) = 2 from public.assets where account_kind = 'NRO'), 'both carry the new type');
select t.assert(public.set_account_kind((select h from dctx), array[(select cash from dass)], '') = 1, 'an empty type clears the tag');
select t.assert((select account_kind is null from public.assets where id = (select cash from dass)), 'it is cleared');
select t.assert(t.throws($q$select public.set_account_kind((select h from dctx), array[(select cash from dass)], 'MARS')$q$), 'bulk: an unknown type is refused');
select t.assert(t.throws($q$select public.set_account_kind((select h from dctx), array[gen_random_uuid()], 'NRE')$q$), 'bulk: an unknown account is refused');

-- an outsider
select t.as_user('00000000-0000-0000-0000-0000000000b9');
select t.assert(t.throws($q$select public.save_account_details((select h from dctx), jsonb_build_array(jsonb_build_object('id', (select cash from dass), 'notes', 'hijack')))$q$), 'outsiders cannot save details');
select t.assert(t.throws($q$select public.set_account_kind((select h from dctx), array[(select cash from dass)], 'NRE')$q$), 'outsiders cannot retype accounts');
select t.as_root();
select t.assert((select notes is null from public.assets where id = (select cash from dass)), 'and nothing changed');
rollback;
\echo 'ALL ACCOUNT DETAIL TESTS PASSED'
