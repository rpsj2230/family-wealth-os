begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000aa', 'j-a@example.test'),
  ('00000000-0000-0000-0000-0000000000ba', 'j-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000aa');
create temp table jctx as select public.create_household('Joint household') as h;
grant all on jctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'First' from jctx;
insert into public.owners (household_id, display_name) select h, 'Second' from jctx;
insert into public.institutions (household_id, name) select h, 'Sample Bank' from jctx;
create temp table jref as select
  (select id from public.owners where display_name = 'First') as p,
  (select id from public.owners where display_name = 'Second') as q,
  (select id from public.institutions where name = 'Sample Bank') as b;
grant all on jref to authenticated;
insert into public.assets (household_id, type, owner_id, institution_id, nickname)
  select h, 'bank_account', (select p from jref), (select b from jref), 'Joint cash' from jctx;
create temp table jass as select id as a from public.assets where nickname = 'Joint cash';
grant all on jass to authenticated;

-- the joint holder is stored with the account when it is joint
select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'isJoint', true, 'jointHolderId', (select q from jref))));
select t.assert((select is_joint and joint_holder_id = (select q from jref) from public.assets where nickname = 'Joint cash'), 'the second name is stored on a joint account');

-- names can be swapped: owner and joint holder together
select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'ownerId', (select q from jref), 'jointHolderId', (select p from jref))));
select t.assert((select owner_id = (select q from jref) and joint_holder_id = (select p from jref) from public.assets where nickname = 'Joint cash'), 'the order of the names can be swapped');

-- the second name must differ from the first, must be a person of the household
select t.assert(t.throws($q$select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'jointHolderId', (select q from jref))))$q$), 'the second name cannot be the same person as the first');
select t.assert(t.throws($q$select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'jointHolderId', gen_random_uuid())))$q$), 'the second name must be someone in the household');
select t.assert(t.throws($q$update public.assets set joint_holder_id = owner_id$q$), 'the table itself refuses the same person twice');

-- not joint: the second name is dropped
select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'isJoint', false)));
select t.assert((select joint_holder_id is null and not is_joint from public.assets where nickname = 'Joint cash'), 'an account that is not joint has no second name');

-- other keys keep their old behaviour: only keys sent change
select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'isJoint', true)));
select t.assert((select is_joint and joint_holder_id is null from public.assets where nickname = 'Joint cash'), 'joint without a second name is allowed (shown as not set)');

-- an outsider can change nothing
select t.as_user('00000000-0000-0000-0000-0000000000ba');
select t.assert(t.throws($q$select public.save_account_details((select h from jctx), jsonb_build_array(jsonb_build_object('id', (select a from jass), 'jointHolderId', (select q from jref))))$q$), 'an outsider cannot set a joint holder');
select t.as_root();
rollback;
\echo 'ALL JOINT HOLDER TESTS PASSED'
