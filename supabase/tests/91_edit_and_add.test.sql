begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000aa', 'e-a@example.test'), ('00000000-0000-0000-0000-0000000000ba', 'e-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000aa');
create temp table ectx as select public.create_household('Edit household') as h;
grant all on ectx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Rupash' from ectx;
insert into public.institutions (household_id, name) select h, 'Jana' from ectx;
create temp table ids as select (select id from public.owners limit 1) as o, (select id from public.institutions limit 1) as i;
grant all on ids to authenticated;

select public.add_bank_item((select h from ectx), jsonb_build_object('type','bank_account','ownerId',(select o from ids),'institutionId',(select i from ids),'accountKind','NRE','isJoint',true,'last4','1111'));
select public.add_bank_item((select h from ectx), jsonb_build_object('type','fixed_deposit','ownerId',(select o from ids),'institutionId',(select i from ids),'accountKind','NRE','isJoint',true,'last4','1111',
  'principal',500000,'rate',0.08,'bookedOn','2026-09-08','maturityOn','2028-09-11','maturityAmount',586293,'refLast4','2222','notes','FD Number : 2222'));
select t.assert((select count(*) from public.assets) = 2, 'a savings account and a deposit were added');
select t.assert((select label = 'FD-NRE JO-1111' and linked_last4 = '1111' and is_joint from public.assets where type = 'fixed_deposit'), 'the deposit is labelled and linked to its savings account by last four');
select t.assert((select (select sort_order from public.assets where type = 'fixed_deposit') > (select sort_order from public.assets where type = 'bank_account')), 'a new row is placed after the last row of that person at that bank');
select t.assert((select fd_ref_last4 = '2222' and bank_maturity_amount = 586293 from public.fixed_deposits), 'deposit terms stored');

-- edits from the monthly sheet
select public.save_monthly_update((select h from ectx), jsonb_build_array(
  jsonb_build_object('assetId', (select id from public.assets where type='bank_account'), 'amount', 1234, 'notes', 'AMB - 10K, No Debit Card'),
  jsonb_build_object('assetId', (select id from public.assets where type='fixed_deposit'), 'fdRate', 0.0825, 'fdMaturityAmount', 590000, 'status', 'active')));
select t.assert((select notes = 'AMB - 10K, No Debit Card' from public.assets where type='bank_account'), 'a note can be edited');
select t.assert((select rate = 0.0825 and bank_maturity_amount = 590000 from public.fixed_deposits), 'deposit rate and maturity amount can be corrected');
select t.assert((select count(*) from public.observations) = 1, 'the new balance is stored as history, not an overwrite');
select t.assert(t.throws($q$select public.add_bank_item((select h from ectx), jsonb_build_object('type','stock','ownerId',(select o from ids),'institutionId',(select i from ids)))$q$), 'only accounts and deposits can be added here');
select t.as_user('00000000-0000-0000-0000-0000000000ba');
select t.assert(t.throws($q$select public.add_bank_item((select h from ectx), jsonb_build_object('type','bank_account','ownerId',(select o from ids),'institutionId',(select i from ids)))$q$), 'outsiders cannot add');
select t.as_root();
rollback;
\echo 'ALL EDIT AND ADD TESTS PASSED'
