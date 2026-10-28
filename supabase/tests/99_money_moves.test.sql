begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'mm-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b7', 'mm-b@example.test');

select t.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table mmctx as select public.create_household('Money moves household') as h;
grant all on mmctx to authenticated;
insert into public.owners (household_id, display_name) select h, 'Rupash' from mmctx;
insert into public.assets (household_id, type, owner_id, nickname)
  select c.h, 'bank_account', o.id, 'Savings' from mmctx c join public.owners o on o.household_id = c.h;
insert into public.assets (household_id, type, owner_id, nickname)
  select c.h, 'fixed_deposit', o.id, 'Old FD' from mmctx c join public.owners o on o.household_id = c.h;
create temp table mma as select id, nickname from public.assets;
grant all on mma to authenticated;

-- 1. a confirmed movement from a matured deposit to a savings account, and outside money in
insert into public.money_moves (household_id, moved_on, amount, from_asset_id, to_asset_id, kind, idem_key)
  select h, '2026-10-02', 1070000, (select id from mma where nickname = 'Old FD'), (select id from mma where nickname = 'Savings'), 'fd_proceeds', 'proceeds:old-fd' from mmctx;
insert into public.money_moves (household_id, moved_on, amount, to_asset_id, kind)
  select h, '2026-10-05', 50000, (select id from mma where nickname = 'Savings'), 'contribution' from mmctx;
select t.assert((select count(*) from public.money_moves) = 2, 'two movements stored');
select t.assert((select status from public.money_moves where kind = 'contribution') = 'confirmed', 'confirmed by default');

-- 2. idempotent: the same movement written twice is refused, not doubled
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, from_asset_id, to_asset_id, kind, idem_key)
  select h, '2026-10-02', 1070000, (select id from mma where nickname = 'Old FD'), (select id from mma where nickname = 'Savings'), 'fd_proceeds', 'proceeds:old-fd' from mmctx$q$), 'a repeated movement is refused');
select t.assert((select count(*) from public.money_moves) = 2, 'still two');

-- 3. checks: a movement goes somewhere, never to itself, never zero or negative
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, kind) select h, '2026-10-01', 10, 'transfer' from mmctx$q$), 'from nowhere to nowhere is refused');
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, from_asset_id, to_asset_id, kind) select h, '2026-10-01', 10, a.id, a.id, 'transfer' from mmctx, mma a where a.nickname = 'Savings'$q$), 'to itself is refused');
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, to_asset_id, kind) select h, '2026-10-01', -5, a.id, 'contribution' from mmctx, mma a where a.nickname = 'Savings'$q$), 'a negative amount is refused');
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, to_asset_id, kind) select h, '2026-10-01', 5, a.id, 'salary' from mmctx, mma a where a.nickname = 'Savings'$q$), 'an unknown kind is refused');

-- 4. the account's own rate keeps its history
update public.assets set interest_rate = 0.035 where nickname = 'Savings';
update public.assets set interest_rate = 0.04 where nickname = 'Savings';
update public.assets set nickname = 'Savings A' where nickname = 'Savings';
select t.assert((select count(*) from public.asset_rate_history) = 2, 'two rate changes recorded, a rename is not one');
select t.assert((select new_rate from public.asset_rate_history order by id desc limit 1) = 0.04, 'the latest change is recorded');
select t.assert(t.throws($q$insert into public.asset_rate_history (household_id, asset_id, new_rate) select h, (select id from mma limit 1), 0.1 from mmctx$q$), 'the history is written only by the trigger');

-- 5. a bank's slab method
update public.institutions set savings_slab_method = 'incremental' where false;
select t.assert(t.throws($q$insert into public.institutions (household_id, name, savings_slab_method) select h, 'Bank X', 'tiered' from mmctx$q$), 'an unknown slab method is refused');

-- 6. outsiders and anonymous users see nothing and write nothing
select t.as_user('00000000-0000-0000-0000-0000000000b7');
select t.assert((select count(*) from public.money_moves) = 0, 'an outsider sees no movements');
select t.assert((select count(*) from public.asset_rate_history) = 0, 'an outsider sees no rate history');
select t.assert(t.throws($q$insert into public.money_moves (household_id, moved_on, amount, to_asset_id, kind) select h, '2026-10-01', 5, (select id from mma limit 1), 'contribution' from mmctx$q$), 'an outsider cannot write');
select t.as_anon();
select t.assert(t.throws($q$select count(*) from public.money_moves$q$), 'anonymous users cannot read');
select t.as_root();
rollback;
\echo 'ALL MONEY MOVES TESTS PASSED'
