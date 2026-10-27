begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'fl-a@example.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'fl-b@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000e1');
create temp table lctx as select public.create_household('Folio link household') as h;
grant all on lctx to authenticated;
select t.as_root();
insert into public.owners (household_id, display_name) select h, 'Asha' from lctx;
insert into public.owners (household_id, display_name) select h, 'Bela' from lctx;
create temp table lown as
  select (select id from public.owners where display_name = 'Asha') as asha, (select id from public.owners where display_name = 'Bela') as bela;
grant all on lown to authenticated;
-- two funds of Asha with the same scheme (one added twice), and one of Bela
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select asha from lown), 'mutual_fund', 'Axis Large Cap A', 'INR' from lctx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select asha from lown), 'mutual_fund', 'Axis Large Cap B', 'INR' from lctx;
insert into public.assets (household_id, owner_id, type, nickname, currency)
  select h, (select bela from lown), 'mutual_fund', 'Bela fund', 'INR' from lctx;
create temp table lasset as
  select (select id from public.assets where nickname = 'Axis Large Cap A') as a,
         (select id from public.assets where nickname = 'Axis Large Cap B') as b,
         (select id from public.assets where nickname = 'Bela fund') as c;
grant all on lasset to authenticated;

select t.as_user('00000000-0000-0000-0000-0000000000e1');
-- the answer to "which fund is folio ...3820?" is kept
insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '3820', 'inf846k01131' from lctx;
select t.assert((select count(*) from public.fund_folio_links) = 1, 'a member can record which fund a statement folio belongs to');
-- the same answer twice is one row
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '3820', 'inf846k01131' from lctx$q$), 'the same folio and scheme is recorded once');
-- the importer writes it idempotently with an upsert
insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '3820', 'inf846k01131' from lctx
  on conflict (household_id, owner_id, folio_last4, scheme_key) do update set asset_id = excluded.asset_id;
select t.assert((select count(*) from public.fund_folio_links) = 1, 'writing the answer again changes nothing');
-- another folio of the same scheme may point to the other fund, or to the same one
insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select b from lasset), '8540', 'inf846k01131' from lctx;
select t.assert((select count(*) from public.fund_folio_links) = 2, 'a second folio of the scheme has its own answer');
-- the answer can be changed to another fund of the same person
update public.fund_folio_links set asset_id = (select a from lasset) where folio_last4 = '8540';
select t.assert((select count(distinct asset_id) from public.fund_folio_links) = 1, 'an answer can be pointed at another fund');

-- a statement only ever changes the funds of the person it belongs to
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select c from lasset), '1111', 'x' from lctx$q$), 'a folio cannot be linked to another person''s fund');
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), gen_random_uuid(), '1111', 'x' from lctx$q$), 'the fund must exist in the household');
-- only the last four characters of a folio are kept
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '12345678', 'x' from lctx$q$), 'a whole folio number is refused');
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '12 4', 'x' from lctx$q$), 'only letters and digits are kept');

-- every change is in the audit log
select t.as_root();
select t.assert((select count(*) from public.audit_events where table_name = 'fund_folio_links') >= 3, 'links are audited');

-- outsiders see nothing and cannot write
select t.as_user('00000000-0000-0000-0000-0000000000e2');
select t.assert((select count(*) from public.fund_folio_links) = 0, 'outsiders see no links');
select t.assert(t.throws($q$insert into public.fund_folio_links (household_id, owner_id, asset_id, folio_last4, scheme_key)
  select h, (select asha from lown), (select a from lasset), '9999', 'x' from lctx$q$), 'a stranger cannot write a link');

-- removing the fund removes its links, never the other way round
select t.as_root();
delete from public.assets where id = (select b from lasset);
select t.assert((select count(*) from public.fund_folio_links) = 2, 'links of other funds stay');
delete from public.assets where id = (select a from lasset);
select t.assert((select count(*) from public.fund_folio_links) = 0, 'links go with the fund they point to');
rollback;
\echo 'ALL FOLIO LINK TESTS PASSED'
