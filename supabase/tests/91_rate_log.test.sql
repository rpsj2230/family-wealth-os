begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a5', 'l-a@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000a5');
create temp table lctx as select public.create_household('Log household') as h;
grant all on lctx to authenticated;

insert into public.rate_offers (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, source_kind) select h, 'Jana', 'fd', 'NRE', 24, 24, 0.085, 'ai' from lctx;
select t.assert((select count(*) from public.rate_events where kind = 'added' and new_rate = 0.085 and source = 'ai') = 1, 'a new rate is logged as added');
update public.rate_offers set rate = 0.0825, checked_on = current_date where bank = 'Jana';
select t.assert((select count(*) from public.rate_events where kind = 'changed' and old_rate = 0.085 and new_rate = 0.0825) = 1, 'a changed rate is logged with the old and new value');
update public.rate_offers set checked_on = current_date where bank = 'Jana';
select t.assert((select count(*) from public.rate_events) = 2, 'only re-checking a rate logs nothing');
update public.rate_offers set source_kind = 'manual', ai_rate = 0.0825, rate = 0.08, correction_reason = 'senior_citizen', corrected_on = current_date where bank = 'Jana';
select t.assert((select count(*) from public.rate_events where kind = 'corrected' and old_rate = 0.0825 and new_rate = 0.08 and reason = 'senior_citizen' and source = 'manual') = 1, 'your correction is logged with its reason');
update public.rate_offers set source_kind = 'ai', ai_rate = null, correction_reason = null, corrected_on = null where bank = 'Jana';
select t.assert((select count(*) from public.rate_events where kind = 'confirmed' and new_rate = 0.08 and reason = 'senior_citizen') = 1, 'the page agreeing with your correction is logged as confirmed');
delete from public.rate_offers where bank = 'Jana';
select t.assert((select count(*) from public.rate_events where kind = 'removed' and old_rate = 0.08) = 1, 'a removed rate is logged');
select t.assert(t.throws($q$update public.rate_events set new_rate = 0.5$q$), 'the log cannot be edited');
select t.assert(t.throws($q$delete from public.rate_events$q$), 'or deleted');

insert into public.rate_hints (household_id, bank, cause, hint) select h, 'Jana', 'senior_citizen', 'The 2 year NRE rate is the regular column, not the senior one.' from lctx;
select t.assert((select count(*) from public.rate_hints) = 1, 'hints can be kept per bank');
select t.as_root();
rollback;
\echo 'ALL RATE LOG TESTS PASSED'
