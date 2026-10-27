-- A detailed fund statement (CAS) is the most accurate record there is (docs/USER-GUIDE.md, "Which record wins"). Where it covers a fund,
-- a stored line from a lower source (an app export, the workbook, an estimate, typed by hand) that the statement does not have is
-- REPLACED: set aside under the statement that replaced it, never deleted, and ignored by every reader that sums or lists lines.
--  1. mf_transactions.superseded_*: when, by which statement, which statement date and why a line was set aside. A line with no
--     superseded_on is live. The columns are all set or all empty.
--  2. mf_transactions.source: lines that came from an app export used to be stored as 'cas'; the ones that read exactly like the export's
--     own wording are now 'csv', so the precedence can tell them from a statement's lines.
--  3. mf_positions.cas_detail_from / cas_detail_to: the period of the latest detailed statement that decided the fund, so an older
--     statement can never override it and a later export cannot overwrite what it decided.
--  4. supersede_fund_lines / restore_fund_lines: the only two ways a line is set aside or brought back, both limited to the household
--     (row-level security applies to the caller) and never touching a line that came from a statement.
--  5. The estimate-dropping triggers leave set-aside lines alone.
alter table public.mf_transactions
  add column superseded_on        timestamptz,
  add column superseded_by_ref    text check (superseded_by_ref is null or length(superseded_by_ref) between 1 and 200),
  add column superseded_statement_on date,
  add column superseded_reason    text check (superseded_reason is null or length(superseded_reason) <= 200),
  add constraint mf_transactions_superseded_whole check (
    (superseded_on is null) = (superseded_by_ref is null) and (superseded_on is null) = (superseded_reason is null)
  );
create index mf_transactions_live_idx on public.mf_transactions (household_id, asset_id, txn_on) where superseded_on is null;
create index mf_transactions_superseded_idx on public.mf_transactions (household_id, asset_id, superseded_on) where superseded_on is not null;

-- lines read from an app export carry its own wording ("Purchase (folio 1234)"), never a registrar's
update public.mf_transactions set source = 'csv'
  where source = 'cas' and description ~ '^(Purchase|SIP purchase|Redemption) \(folio [^)]*\)$';

alter table public.mf_positions
  add column cas_detail_from date,
  add column cas_detail_to   date,
  add constraint mf_positions_cas_detail_order check (cas_detail_from is null or cas_detail_to is null or cas_detail_from <= cas_detail_to);

-- Set aside the lines with these references (they are replaced by a statement). A line from a statement is never set aside here.
create function public.supersede_fund_lines(
  p_household uuid, p_asset uuid, p_refs text[], p_statement_ref text, p_statement_on date, p_reason text
) returns integer language plpgsql as $$
declare n integer;
begin
  if p_statement_ref is null or length(p_statement_ref) = 0 then raise exception 'the statement that replaces the lines is needed'; end if;
  if p_refs is null or cardinality(p_refs) = 0 then return 0; end if;
  update public.mf_transactions set
    superseded_on = now(),
    superseded_by_ref = left(p_statement_ref, 200),
    superseded_statement_on = p_statement_on,
    superseded_reason = left(coalesce(nullif(p_reason, ''), 'Replaced by a fund statement'), 200)
  where household_id = p_household and asset_id = p_asset
    and source_ref = any (p_refs) and superseded_on is null and source <> 'cas';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.supersede_fund_lines(uuid, uuid, text[], text, date, text) from public, anon;
grant execute on function public.supersede_fund_lines(uuid, uuid, text[], text, date, text) to authenticated, service_role;

-- Bring set-aside lines back as statement lines: a later statement has the very same line, so the statement is now its source.
create function public.restore_fund_lines(p_household uuid, p_asset uuid, p_refs text[])
returns integer language plpgsql as $$
declare n integer;
begin
  if p_refs is null or cardinality(p_refs) = 0 then return 0; end if;
  update public.mf_transactions set
    superseded_on = null, superseded_by_ref = null, superseded_statement_on = null, superseded_reason = null, source = 'cas'
  where household_id = p_household and asset_id = p_asset and source_ref = any (p_refs) and superseded_on is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.restore_fund_lines(uuid, uuid, text[]) from public, anon;
grant execute on function public.restore_fund_lines(uuid, uuid, text[]) to authenticated, service_role;

-- a line set aside is kept: the estimate-dropping triggers only drop live estimates
create or replace function public.drop_estimates_on_real() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.source <> 'estimate' then
    delete from public.mf_transactions
      where asset_id = new.asset_id and source = 'estimate' and txn_on <= new.txn_on and superseded_on is null;
  end if;
  return new;
end $$;

create or replace function public.drop_estimates_on_count() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.units_as_of is not null and new.units_as_of is distinct from old.units_as_of then
    delete from public.mf_transactions
      where asset_id = new.asset_id and source = 'estimate' and txn_on <= new.units_as_of and superseded_on is null;
  end if;
  return new;
end $$;

-- only the setting aside and the bringing back are logged (a statement import adds hundreds of lines, which are not)
create trigger audit_mf_transactions_superseded after update on public.mf_transactions
  for each row when (old.superseded_on is distinct from new.superseded_on) execute function public.audit_row();
