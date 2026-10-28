begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a5', 'r-a@example.test'), ('00000000-0000-0000-0000-0000000000b5', 'r-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
create temp table rctx as select public.create_household('Remittance household') as h;
grant all on rctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Parent' from rctx;
insert into public.assets (household_id, type, owner_id, nickname)
  select h, 'bank_account', (select id from public.owners where display_name = 'Parent'), 'Sample NRE' from rctx;
insert into public.remittances (household_id, received_on, amount_inr, idem_key) select h, '2020-11-19', 1100000, 'wise:a' from rctx;
select t.assert((select count(*) from public.remittances) = 1, 'a transfer can be stored without knowing where it went');
select t.assert(t.throws($q$insert into public.remittances (household_id, received_on, amount_inr, idem_key) select h, '2020-11-19', 1100000, 'wise:a' from rctx$q$), 'the same transfer cannot be stored twice');
select t.assert(t.throws($q$update public.remittances set to_asset_id = (select id from public.assets)$q$), 'an account needs to say how it is known');
update public.remittances set to_asset_id = (select id from public.assets), to_basis = 'balances';
select t.assert((select to_basis from public.remittances) = 'balances', 'an account and how it is known can be set');
select t.assert(t.throws($q$insert into public.remittances (household_id, received_on, amount_inr, idem_key) select h, '2020-11-19', 0, 'wise:b' from rctx$q$), 'a transfer of nothing is refused');
delete from public.assets;
select t.assert((select to_asset_id is null and to_basis is null from public.remittances), 'removing the account keeps the transfer');
select t.as_user('00000000-0000-0000-0000-0000000000b5');
select t.assert((select count(*) from public.remittances) = 0, 'outsiders see nothing');
select t.as_root();
rollback;
\echo 'ALL REMITTANCE TESTS PASSED'
