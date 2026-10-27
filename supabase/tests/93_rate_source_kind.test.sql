begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a7', 'k-a@example.test'),
  ('00000000-0000-0000-0000-0000000000b7', 'k-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a7');
create temp table kctx as select public.create_household('Rate kinds household') as h;
grant all on kctx to authenticated;

-- a page defaults to carrying both kinds of rate
insert into public.rate_sources (household_id, bank, url) select h, 'Sample Bank', 'https://bank.example.test/rates' from kctx;
select t.assert((select kind from public.rate_sources) = 'both', 'a page carries both kinds of rate by default');

-- one bank can have several pages, each with its own kind
insert into public.rate_sources (household_id, bank, url, kind) select h, 'Sample Bank', 'https://bank.example.test/savings', 'savings' from kctx;
insert into public.rate_sources (household_id, bank, url, kind) select h, 'Sample Bank', 'https://bank.example.test/deposits.pdf', 'fd' from kctx;
select t.assert((select count(*) from public.rate_sources where bank = 'Sample Bank') = 3, 'a bank can have several rate pages');
select t.assert((select count(distinct kind) from public.rate_sources) = 3, 'each page has its own kind');

-- the same address is still listed once, and an unknown kind is refused
select t.assert(t.throws($q$insert into public.rate_sources (household_id, bank, url) select h, 'Sample Bank', 'https://bank.example.test/savings' from kctx$q$), 'the same address cannot be listed twice');
select t.assert(t.throws($q$insert into public.rate_sources (household_id, bank, url, kind) select h, 'Sample Bank', 'https://bank.example.test/x', 'recurring' from kctx$q$), 'only savings, fd or both');

-- the sync records what it did with each document
update public.rate_sources set last_docs = '[{"url":"https://bank.example.test/savings","kind":"savings","ok":true,"chars":4200,"note":"read 4,200 characters"}]'::jsonb where url = 'https://bank.example.test/savings';
select t.assert((select jsonb_array_length(last_docs) from public.rate_sources where url = 'https://bank.example.test/savings') = 1, 'the documents of the last sync are kept');
select t.assert(t.throws($q$update public.rate_sources set last_docs = '{"not":"a list"}'::jsonb$q$), 'the documents are a list');

-- rates saved from a comparison website can be removed by a member, and only that household's
insert into public.rate_offers (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, source_kind, source_note)
  select h, 'Sample Bank', 'fd', 'NRE', 12, 24, 0.07, 'ai', 'Reference only, from comparison.example.test' from kctx;
insert into public.rate_offers (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, source_kind, source_note)
  select h, 'Sample Bank', 'fd', 'NRE', 25, 36, 0.071, 'ai', 'Read from bank.example.test' from kctx;
delete from public.rate_offers where source_kind = 'ai' and source_note like 'Reference only%';
select t.assert((select count(*) from public.rate_offers) = 1, 'only the rates from comparison websites were removed');

select t.as_user('00000000-0000-0000-0000-0000000000b7');
select t.assert((select count(*) from public.rate_sources) = 0, 'outsiders see no rate pages');
select t.as_root();
rollback;
\echo 'ALL RATE SOURCE KIND TESTS PASSED'
