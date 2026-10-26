begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a4', 'r-a@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a4');
create temp table rctx as select public.create_household('Rate household') as h;
grant all on rctx to authenticated;

insert into public.rate_offers (household_id, bank, product, account_kind, rate, balance_to) select h, 'Jana', 'savings', 'any', 0.025, 100000 from rctx;
insert into public.rate_offers (household_id, bank, product, account_kind, rate, balance_from, balance_to) select h, 'Jana', 'savings', 'any', 0.035, 100000, 500000 from rctx;
insert into public.rate_offers (household_id, bank, product, account_kind, rate, balance_from) select h, 'Jana', 'savings', 'any', 0.07, 5000000 from rctx;
select t.assert((select count(*) from public.rate_offers where bank = 'Jana' and product = 'savings') = 3, 'one account can have a rate for each balance slab');
select t.assert(t.throws($q$insert into public.rate_offers (household_id, bank, product, account_kind, rate, balance_to) select h, 'Jana', 'savings', 'any', 0.03, 100000 from rctx$q$), 'the same slab twice is refused');
select t.assert(t.throws($q$insert into public.rate_offers (household_id, bank, product, account_kind, rate, balance_from, balance_to) select h, 'Jana', 'savings', 'any', 0.03, 900, 100 from rctx$q$), 'a slab that ends before it starts is refused');
insert into public.rate_offers (household_id, bank, product, account_kind, rate, tenure_from_months, tenure_to_months, tenure_days) select h, 'ESAF', 'fd', 'NRE', 0.08, 26, 26, 800 from rctx;
select t.assert((select tenure_days = 800 from public.rate_offers where bank = 'ESAF'), 'a deposit keeps the exact days it was quoted in');
select t.assert(t.throws($q$insert into public.rate_offers (household_id, bank, product, account_kind, rate, tenure_days) select h, 'X', 'fd', 'NRE', 0.08, 0 from rctx$q$), 'zero days is refused');
select t.as_root();
rollback;
\echo 'ALL RATE SLAB TESTS PASSED'
