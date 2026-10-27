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
