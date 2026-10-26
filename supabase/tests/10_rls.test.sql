-- Behavioural tests for tenant isolation, append-only observations, audit trail and keep-alive.
-- Run with:  psql -v ON_ERROR_STOP=1 -f 10_rls.test.sql   (after 00_stub.sql and all migrations)
create schema if not exists t;

create or replace function t.assert(cond boolean, msg text) returns void language plpgsql as $$
begin if cond is not true then raise exception 'ASSERTION FAILED: %', msg; end if; end $$;

-- true if the statement raises any error
create or replace function t.throws(stmt text) returns boolean language plpgsql as $$
begin execute stmt; return false; exception when others then return true; end $$;

create or replace function t.as_user(u uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), false);
  execute 'set role authenticated';
end $$;

create or replace function t.as_anon() returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', '', false); execute 'set role anon'; end $$;

create or replace function t.as_root() returns void language plpgsql as $$
begin execute 'reset role'; perform set_config('request.jwt.claim.sub', '', false); end $$;

grant usage on schema t to anon, authenticated;
grant execute on all functions in schema t to anon, authenticated;

begin;
-- Users (as the auth system would create them)
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'rupash@example.test'),
  ('00000000-0000-0000-0000-00000000000b', 'ragini@example.test'),
  ('00000000-0000-0000-0000-00000000000c', 'outsider@example.test');

-- 1. Household bootstrap
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table ctx as select public.create_household('Test household') as h;
grant all on ctx to authenticated;
select t.assert((select count(*) from public.households) = 1, 'creator sees their household');

insert into public.owners (household_id, display_name, pan_last4) select h, 'Rupash', 'AB1C' from ctx;
insert into public.owners (household_id, display_name) select h, 'Ragini' from ctx;
insert into public.institutions (household_id, name, kind) select h, 'Test Bank', 'bank' from ctx;
insert into public.assets (household_id, type, owner_id, institution_id, nickname, account_kind, identifier_last4)
  select c.h, 'bank_account', o.id, i.id, 'NRE savings', 'NRE', '1234'
  from ctx c join public.owners o on o.household_id = c.h and o.display_name = 'Rupash'
  join public.institutions i on i.household_id = c.h;
insert into public.observations (household_id, asset_id, kind, amount, as_of, source, confidence)
  select a.household_id, a.id, 'balance', 100000.50, date '2026-10-01', 'manual', 'manual_confirmed' from public.assets a;
select t.assert((select count(*) from public.observations) = 1, 'member can add and read an observation');

-- 2. Outsider sees nothing and cannot write
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.assert((select count(*) from public.households) = 0, 'outsider sees no households');
select t.assert((select count(*) from public.owners) = 0, 'outsider sees no owners');
select t.assert((select count(*) from public.assets) = 0, 'outsider sees no assets');
select t.assert((select count(*) from public.observations) = 0, 'outsider sees no observations');
select t.assert((select count(*) from public.audit_events) = 0, 'outsider sees no audit events');
select t.assert(t.throws($q$insert into public.owners (household_id, display_name) select h, 'Intruder' from ctx$q$), 'outsider cannot insert into the household');
select t.assert(t.throws($q$select public.add_household_member((select h from ctx), 'outsider@example.test', 'admin')$q$), 'outsider cannot add themselves');

-- 3. Admin adds spouse; spouse sees everything
select t.as_user('00000000-0000-0000-0000-00000000000a');
select public.add_household_member((select h from ctx), 'ragini@example.test', 'member');
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.assert((select count(*) from public.owners) = 2, 'spouse sees both owners');
select t.assert((select count(*) from public.assets) = 1, 'spouse sees assets');
select t.assert((select count(*) from public.observations) = 1, 'spouse sees observations');
-- a plain member cannot add members
select t.assert(t.throws($q$select public.add_household_member((select h from ctx), 'outsider@example.test', 'member')$q$), 'plain member cannot add members');

-- 4. emergency_viewer is not a full member
select t.as_user('00000000-0000-0000-0000-00000000000a');
select public.add_household_member((select h from ctx), 'outsider@example.test', 'emergency_viewer');
select t.as_user('00000000-0000-0000-0000-00000000000c');
select t.assert((select count(*) from public.assets) = 0, 'emergency_viewer cannot read financial assets');
select t.assert((select count(*) from public.observations) = 0, 'emergency_viewer cannot read observations');
select t.assert(t.throws($q$insert into public.owners (household_id, display_name) select h, 'Intruder' from ctx$q$), 'emergency_viewer cannot write');

-- 5. Append-only observations
select t.as_user('00000000-0000-0000-0000-00000000000b');
select t.assert(t.throws($q$update public.observations set amount = 1$q$), 'cannot change an observation amount');
select t.assert(t.throws($q$delete from public.observations$q$), 'cannot delete an observation');
-- correction = new row, old one marked superseded
insert into public.observations (household_id, asset_id, kind, amount, as_of, source, confidence)
  select household_id, asset_id, 'balance', 105000.00, date '2026-10-01', 'manual', 'manual_confirmed' from public.observations limit 1;
update public.observations set superseded_by = (select id from public.observations where amount = 105000.00)
  where amount = 100000.50;
select t.assert((select count(*) from public.observations) = 2, 'history preserved after correction');

-- 6. Tenant isolation via composite foreign keys
select t.as_user('00000000-0000-0000-0000-00000000000a');
create temp table ctx2 as select public.create_household('Other household') as h;
grant all on ctx2 to authenticated;
insert into public.owners (household_id, display_name) select h, 'Stranger' from ctx2;
select t.assert(
  t.throws($q$insert into public.assets (household_id, type, owner_id, nickname)
              select (select h from ctx), 'bank_account', o.id, 'Cross-tenant'
              from public.owners o where o.display_name = 'Stranger'$q$),
  'asset cannot reference an owner from another household');
select t.assert((select count(*) from public.owners where display_name = 'Stranger') = 1, 'user in two households sees both');

-- 7. Data validation
select t.assert(t.throws($q$insert into public.owners (household_id, display_name, pan_last4) select h, 'Bad', 'ABCDEFGHIJ' from ctx$q$), 'full PAN rejected');
select t.assert(t.throws($q$insert into public.assets (household_id, type, owner_id, nickname, identifier_last4)
   select c.h, 'bank_account', o.id, 'X', '1234567890' from ctx c join public.owners o on o.household_id = c.h limit 1$q$), 'long account number rejected');

-- 8. Fixed deposit rules
insert into public.assets (household_id, type, owner_id, institution_id, nickname, account_kind)
  select c.h, 'fixed_deposit', o.id, i.id, 'FD 1', 'NRE'
  from ctx c join public.owners o on o.household_id = c.h and o.display_name = 'Rupash'
  join public.institutions i on i.household_id = c.h;
insert into public.fixed_deposits (asset_id, household_id, principal, rate, booked_on, maturity_on, bank_maturity_amount)
  select id, household_id, 500000, 0.08, date '2026-09-14', date '2029-09-15', 634399 from public.assets where nickname = 'FD 1';
select t.assert(t.throws($q$update public.fixed_deposits set maturity_on = booked_on$q$), 'maturity must be after booking');
select t.assert(t.throws($q$update public.fixed_deposits set rate = 8$q$), 'rate must be a decimal fraction');

-- 9. Audit trail
select t.assert((select count(*) from public.audit_events where table_name = 'assets') >= 2, 'asset inserts audited');
select t.assert((select count(*) from public.audit_events where table_name = 'fixed_deposits' and row_id is not null) = 1, 'fd audited with asset_id as row id');
select t.assert(t.throws($q$insert into public.audit_events (table_name, action) values ('x','y')$q$), 'audit cannot be written directly');
select t.assert(t.throws($q$delete from public.audit_events$q$), 'audit cannot be deleted');

-- 10. Anonymous access
select t.as_anon();
select t.assert(t.throws($q$select * from public.assets$q$), 'anon has no table access');
select t.assert((select public.ping()) = 'ok', 'anon can call ping');
select t.assert(t.throws($q$select public.create_household('x')$q$), 'anon cannot create households');

select t.as_root();
rollback;
\echo 'ALL RLS TESTS PASSED'
