-- Migrations written after 20261027000100_history.sql, in order, for the Supabase SQL editor (Dashboard > SQL Editor > New query > paste > Run).
-- Use this ONLY while the 'Apply database migrations' GitHub Action cannot run. It records each version in supabase_migrations.schema_migrations,
-- so the Action skips them once it runs again. Safe to run once; a second run stops at the first object that already exists.
begin;

-- ===== 20261027000110_rate_source_kind.sql =====
-- A bank can have several rate pages, each carrying savings rates, fixed deposit rates or both (some banks publish them on different
-- links). `kind` says which, so the reader takes only that kind from the page. The bank may have as many rows as it has pages:
-- the only uniqueness is (household, url).
--
-- `last_docs` is what the last sync did with each document it tried for the bank (address, kind, read or not and why, characters,
-- the date the bank gives), shown on the Sync bank rates page. Written to every row of the bank.
alter table public.rate_sources
  add column kind text not null default 'both' check (kind in ('savings', 'fd', 'both')),
  add column last_docs jsonb check (last_docs is null or (jsonb_typeof(last_docs) = 'array' and pg_column_size(last_docs) < 20000));

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000110', 'rate_source_kind') on conflict do nothing;

-- ===== 20261027000115_digest_goals.sql =====
-- Daily summary: a switch for the goals view, next to the retirement view. On by default, so households that saved their
-- settings before this existed keep getting everything (an absent value behaves as on).
alter table public.digest_settings add column if not exists include_goals boolean not null default true;

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000115', 'digest_goals') on conflict do nothing;

-- ===== 20261027000120_statement_scans.sql =====
-- Fund statements read from Gmail (the "Gmail statements" scan, workers/src/statements.ts): one row per scan, so the Import page can say
-- when the mailbox was last looked at and what came of it, and so "Scan now" has somewhere to leave its request.
--
--   * A row with requested_at set and started_at empty is a request from a member ("Scan now"): the next run of the job picks it up,
--     fills in started_at and finishes the same row. At most one request waits at a time.
--   * A row the job opens itself (trigger = 'schedule' or 'manual') has no requested_at.
--   * `mailbox` is the Gmail address the job read, masked (a***@g***.com), so the app can say which mailbox it is.
--   * `detail` is a short list of the statements met in this scan: date, registrar, person, outcome and a plain sentence. Never a PAN,
--     a password or the text of an e-mail.
-- Members read; only the service role (the job) writes, apart from the request function below.
create table public.statement_scans (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households on delete cascade,
  trigger        text not null check (trigger in ('schedule', 'requested', 'manual')),
  requested_at   timestamptz,
  requested_by   uuid,
  started_at     timestamptz,
  finished_at    timestamptz,
  mailbox        text check (mailbox is null or length(mailbox) <= 80),
  look_back_days integer check (look_back_days is null or look_back_days between 0 and 5000),
  found          integer not null default 0 check (found >= 0),
  imported       integer not null default 0 check (imported >= 0),
  skipped        integer not null default 0 check (skipped >= 0),
  problems       integer not null default 0 check (problems >= 0),
  ok             boolean,
  note           text check (note is null or length(note) <= 500),
  detail         jsonb check (detail is null or jsonb_typeof(detail) = 'array'),
  created_at     timestamptz not null default now()
);
create index statement_scans_household_idx on public.statement_scans (household_id, created_at desc);
-- at most one waiting request per household
create unique index statement_scans_one_request on public.statement_scans (household_id)
  where requested_at is not null and started_at is null;

alter table public.statement_scans enable row level security;
create policy statement_scans_read on public.statement_scans for select using (public.is_member(household_id));
revoke all on public.statement_scans from anon, authenticated;
grant select on public.statement_scans to authenticated;
create trigger audit_statement_scans after insert or update or delete on public.statement_scans for each row execute function public.audit_row();

-- "Scan now": leaves one waiting request for the job. Members only. Asking twice changes nothing and returns the same request.
create function public.request_statement_scan(p_household uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  select id into v_id from public.statement_scans
    where household_id = p_household and requested_at is not null and started_at is null;
  if found then return v_id; end if;
  insert into public.statement_scans (household_id, trigger, requested_at, requested_by)
    values (p_household, 'requested', now(), auth.uid())
    returning id into v_id;
  return v_id;
end $$;
revoke all on function public.request_statement_scan(uuid) from public, anon;
grant execute on function public.request_statement_scan(uuid) to authenticated;

-- Requests for a full fund statement. CAMS and KFintech put a security check on their request pages that a program must not get
-- past, so the person asks on the registrar's own page and presses "I have asked" in the app. This table is that note: who it was
-- asked for, from which registrar, on what day, and whether the statement has arrived since (the mailbox scan or an upload of a
-- statement for that person marks it). A request still waiting after the number of days in Settings leaves a task (task_id) once.
-- No password, PAN or e-mail address is kept here.
create table public.statement_requests (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  owner_id     uuid not null,
  registrar    text not null check (registrar in ('cams', 'kfintech', 'mfcentral')),
  requested_on date not null default current_date,
  status       text not null default 'asked' check (status in ('asked', 'arrived', 'cancelled')),
  arrived_on   date,
  task_id      uuid references public.tasks (id) on delete set null,
  created_by   uuid,
  created_at   timestamptz not null default now(),
  foreign key (owner_id, household_id) references public.owners (id, household_id) on delete cascade
);
create index statement_requests_household_idx on public.statement_requests (household_id, requested_on desc);
alter table public.statement_requests enable row level security;
create policy statement_requests_all on public.statement_requests for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.statement_requests from anon, authenticated;
grant select, insert, update, delete on public.statement_requests to authenticated;
create trigger audit_statement_requests after insert or update or delete on public.statement_requests for each row execute function public.audit_row();

-- Extra statement passwords, per person. A statement e-mailed by CAMS or KFintech is protected by the password chosen when it was
-- requested; when that was not the PAN (some services pick a random one and mail it separately), the person can save it here. It is
-- write-only, like the PAN: members can add and remove passwords through the two functions below, nobody can read one back through the
-- app, and only the service role (the mailbox scan) reads them to open a PDF. The app never takes a password out of an e-mail.
-- No audit trigger: the log would copy the password.
create table public.statement_passwords (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  owner_id     uuid not null,
  password     text not null check (length(password) between 1 and 64),
  created_at   timestamptz not null default now(),
  unique (owner_id, password),
  foreign key (owner_id, household_id) references public.owners (id, household_id) on delete cascade
);
alter table public.statement_passwords enable row level security;
revoke all on public.statement_passwords from anon, authenticated;
-- deliberately no policies and no grants

-- Saves one password for a person (at most 5 are kept; the oldest is dropped when a sixth is added). Saving the same one again changes nothing.
create function public.add_statement_password(p_household uuid, p_owner uuid, p_password text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  if not exists (select 1 from public.owners where id = p_owner and household_id = p_household) then raise exception 'unknown person'; end if;
  if p_password is null or length(p_password) not between 1 and 64 then raise exception 'the password must be 1 to 64 characters'; end if;
  insert into public.statement_passwords (household_id, owner_id, password) values (p_household, p_owner, p_password)
    on conflict (owner_id, password) do nothing;
  delete from public.statement_passwords where id in (
    select id from public.statement_passwords where owner_id = p_owner order by created_at desc, id offset 5);
end $$;
revoke all on function public.add_statement_password(uuid, uuid, text) from public, anon;
grant execute on function public.add_statement_password(uuid, uuid, text) to authenticated;

-- Removes every extra password of a person (all of them, since none can be shown to pick one).
create function public.clear_statement_passwords(p_household uuid, p_owner uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  delete from public.statement_passwords where household_id = p_household and owner_id = p_owner;
end $$;
revoke all on function public.clear_statement_passwords(uuid, uuid) from public, anon;
grant execute on function public.clear_statement_passwords(uuid, uuid) to authenticated;

-- How many extra passwords each person has: the only thing the app can learn about them.
create function public.statement_password_counts(p_household uuid)
returns table (owner_id uuid, saved integer) language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household' using errcode = '42501'; end if;
  return query select p.owner_id, count(*)::integer from public.statement_passwords p where p.household_id = p_household group by p.owner_id;
end $$;
revoke all on function public.statement_password_counts(uuid) from public, anon;
grant execute on function public.statement_password_counts(uuid) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000120', 'statement_scans') on conflict do nothing;

-- ===== 20261027000130_cas_priority.sql =====
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

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000130', 'cas_priority') on conflict do nothing;

-- ===== 20261027000150_snapshots_rebuilt.sql =====
-- Net-worth history rebuilt from the monthly tabs: past month ends worked out by the app from what is on file (balances, deposit terms,
-- fund units and prices), stored next to the snapshots taken on the day. A day's own snapshot is always the authority; a rebuilt row only
-- ever fills a day that has none (or replaces an older rebuilt row of the same day). Nothing is deleted.

alter table public.snapshots drop constraint snapshots_source_check;
alter table public.snapshots
  add constraint snapshots_source_check check (source in ('daily','import','monthly_update','manual','rebuilt'));
comment on column public.snapshots.source is
  'Where the row came from. rebuilt: worked out afterwards from the history on file (not recorded on the day); every other value was recorded on the day.';

-- Adds rebuilt rows for past days. p is an array of the same payloads save_snapshot takes. Idempotent: running it again leaves the same rows.
-- A day that already has a row recorded on the day is skipped, never overwritten. Returns how many rows were added or refreshed.
create function public.backfill_snapshots(p_household uuid, p jsonb)
returns int language plpgsql as $$
declare
  item jsonb;
  n int := 0;
  got int;
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'expected an array of snapshots'; end if;
  for item in select * from jsonb_array_elements(p) loop
    if (item->>'takenOn')::date >= current_date then raise exception 'a rebuilt snapshot must be for a day before today'; end if;
    insert into public.snapshots (household_id, taken_on, total, investable, by_owner, by_liquidity, by_type, components, basis,
                                  counted, excluded, latest_recorded_as_of, status, source)
    values (p_household, (item->>'takenOn')::date, (item->>'total')::numeric, (item->>'investable')::numeric,
            coalesce(item->'byOwner', '{}'), coalesce(item->'byLiquidity', '{}'), coalesce(item->'byType', '{}'),
            coalesce(item->'components', '{}'), coalesce(item->'basis', '{}'),
            coalesce((item->>'counted')::int, 0), coalesce((item->>'excluded')::int, 0),
            (item->>'latestRecordedAsOf')::date, item->>'status', 'rebuilt')
    on conflict (household_id, taken_on) do update set
      total = excluded.total, investable = excluded.investable, by_owner = excluded.by_owner, by_liquidity = excluded.by_liquidity,
      by_type = excluded.by_type, components = excluded.components, basis = excluded.basis, counted = excluded.counted,
      excluded = excluded.excluded, latest_recorded_as_of = excluded.latest_recorded_as_of, status = excluded.status,
      created_by = auth.uid(), created_at = now()
    where public.snapshots.source = 'rebuilt';
    get diagnostics got = row_count;
    n := n + got;
  end loop;
  return n;
end $$;
revoke all on function public.backfill_snapshots(uuid, jsonb) from public;
grant execute on function public.backfill_snapshots(uuid, jsonb) to authenticated;

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000150', 'snapshots_rebuilt') on conflict do nothing;

-- ===== 20261027000160_fund_folio_links.sql =====
-- A fund statement folio that the person has said belongs to one of their funds.
--
-- When a statement folio could be more than one of a person's funds (two funds share an ISIN, or a fund has been added twice), the preview
-- no longer says "needs a look": it suggests the likeliest fund with the reason and asks the person to approve it, pick another or add a
-- new fund (see docs/UI-GUIDE.md, "Suggest, do not hand back"). The approved answer is kept here, so the same statement folio is matched
-- to that fund from then on and the question is never asked again. mf_positions has only one folio_last4 per fund, so it cannot say that
-- a second folio of the same scheme belongs to the fund; this table can.
--
--  - folio_last4: the last four characters of the folio number on the statement (never the whole folio, never a PAN);
--  - scheme_key: the scheme's ISIN in lower case, or `name:` and the normalised name when the statement gives no ISIN;
--  - one row per (person, folio, scheme): writing the same answer again changes nothing; a different answer replaces the fund it points to;
--  - the fund must belong to the same person: a statement only ever changes the funds of the person it belongs to;
--  - nothing is ever deleted by the importer (rows go only with the fund or the person).
create table public.fund_folio_links (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  owner_id     uuid not null,
  asset_id     uuid not null,
  folio_last4  text not null check (folio_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  scheme_key   text not null check (length(scheme_key) between 1 and 200),
  created_at   timestamptz not null default now(),
  unique (household_id, owner_id, folio_last4, scheme_key),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade,
  foreign key (owner_id, household_id) references public.owners (id, household_id) on delete cascade
);
create index fund_folio_links_asset_idx on public.fund_folio_links (household_id, asset_id);

create function public.fund_folio_links_same_owner() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.assets a where a.id = new.asset_id and a.household_id = new.household_id and a.owner_id = new.owner_id) then
    raise exception 'the fund must belong to the same person as the statement folio';
  end if;
  return new;
end $$;
create trigger fund_folio_links_owner before insert or update on public.fund_folio_links
  for each row execute function public.fund_folio_links_same_owner();

alter table public.fund_folio_links enable row level security;
create policy fund_folio_links_all on public.fund_folio_links for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.fund_folio_links from anon, authenticated;
grant select, insert, update, delete on public.fund_folio_links to authenticated;
create trigger audit_fund_folio_links after insert or update or delete on public.fund_folio_links for each row execute function public.audit_row();

insert into supabase_migrations.schema_migrations (version, name) values ('20261027000160', 'fund_folio_links') on conflict do nothing;

commit;
