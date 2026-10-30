-- The family handbook, made easier to act on (docs/USER-GUIDE.md, "Family handbook"):
--  1. assets.nominee_note: who is registered as nominee on an account, deposit or fund folio ("Ragini, 100%"), so each institution card
--     in the handbook can say it, and the "what's missing" meter can count the ones nobody has written down.
--  2. institutions.helpline: the phone number to call at a bank, fund house or insurer, shown on its card with a button that dials it.
--  3. emergency_progress: the steps the family ticks off ("Bank informed", "Death certificate collected"), shared by everyone who can
--     open the handbook. Anyone who may read the handbook may tick; nobody else sees the ticks.
--  4. emergency_access: the inactivity alert. When nobody from the household has used the portal for warn_days, the members get an
--     e-mail ("Are you all right? Sign in to postpone"); at inactive_days (the day the handbook opens to the family login) the people in
--     alert_contacts are told the portal exists and how to sign in. warned_at / alerted_at stop it repeating, and a member using the
--     portal again clears both.

-- 1 ------------------------------------------------------------------------------------------------------------------------------
alter table public.assets add column nominee_note text check (nominee_note is null or length(nominee_note) <= 200);

-- 2 ------------------------------------------------------------------------------------------------------------------------------
alter table public.institutions add column helpline text check (helpline is null or length(helpline) <= 60);

-- 3 ------------------------------------------------------------------------------------------------------------------------------
create table public.emergency_progress (
  household_id uuid not null references public.households on delete cascade,
  step_key     text not null check (length(step_key) between 1 and 120),
  done_by      uuid default auth.uid() references auth.users on delete set null,
  done_at      timestamptz not null default now(),
  primary key (household_id, step_key)
);
alter table public.emergency_progress enable row level security;
create policy eprogress_open on public.emergency_progress for all
  using (public.emergency_open(household_id)) with check (public.emergency_open(household_id));
revoke all on public.emergency_progress from anon, authenticated;
grant select, insert, delete on public.emergency_progress to authenticated;

-- 4 ------------------------------------------------------------------------------------------------------------------------------
alter table public.emergency_access
  add column warn_days      int not null default 20 check (warn_days between 3 and 365),
  -- [{ "name": "...", "email": "...", "phone": "..." }], at most a handful; members only (RLS on this table)
  add column alert_contacts jsonb not null default '[]'::jsonb check (jsonb_typeof(alert_contacts) = 'array'),
  add column warned_at      timestamptz,
  add column alerted_at     timestamptz;

-- a member using the portal again ends any warning or alert, so the next long absence starts afresh
create or replace function public.touch_member_activity(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then return; end if;
  insert into public.emergency_access (household_id, last_member_seen) values (p_household, now())
    on conflict (household_id) do update set last_member_seen = now(), warned_at = null, alerted_at = null
    where public.emergency_access.last_member_seen < now() - interval '1 hour'
       or public.emergency_access.warned_at is not null
       or public.emergency_access.alerted_at is not null;
end $$;
revoke all on function public.touch_member_activity(uuid) from public, anon;
grant execute on function public.touch_member_activity(uuid) to authenticated;

-- 5 ------------------------------------------------------------------------------------------------------------------------------
-- Telling the trusted people in order. alert_contacts is in priority order. At inactive_days the first person is told, with a link
-- "I have received this"; if they do not confirm, they are reminded `reminders` times, `remind_every_days` apart, and then the next
-- person is told the same way. The chain stops when anyone confirms, or when a member uses the portal again (a new absence starts a
-- new chain). The owner's warning carries a link "I'm fine" that postpones without signing in.
alter table public.emergency_access
  add column remind_every_days   int not null default 2 check (remind_every_days between 1 and 14),
  add column reminders           int not null default 3 check (reminders between 0 and 10),
  add column postpone_token_hash text;

create table public.emergency_alert_log (
  household_id    uuid not null references public.households on delete cascade,
  -- last_member_seen when this absence's chain began: one chain per absence
  absence_from    timestamptz not null,
  -- position in alert_contacts (0 = first priority)
  contact_pos     int not null check (contact_pos between 0 and 19),
  sends           int not null default 0,
  first_sent_at   timestamptz,
  last_sent_at    timestamptz,
  token_hash      text not null,
  confirmed_at    timestamptz,
  primary key (household_id, absence_from, contact_pos)
);
alter table public.emergency_alert_log enable row level security;
-- members see who was told and who confirmed; nobody else, and only the daily job (service role) writes
create policy ealert_members_read on public.emergency_alert_log for select using (public.is_member(household_id));
revoke all on public.emergency_alert_log from anon, authenticated;
grant select on public.emergency_alert_log to authenticated;

-- "I have received this": the link in the message carries a random token; only its hash is stored. Works without signing in,
-- reveals nothing, and only marks that message as received.
create function public.confirm_emergency_alert(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  update public.emergency_alert_log set confirmed_at = coalesce(confirmed_at, now())
    where token_hash = encode(digest(p_token, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.confirm_emergency_alert(text) from public;
grant execute on function public.confirm_emergency_alert(text) to anon, authenticated;

-- "I'm fine": the link in the owner's warning postpones the alert as if a member had used the portal
create function public.postpone_emergency_alert(p_token text) returns boolean
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if p_token is null or length(p_token) < 32 then return false; end if;
  update public.emergency_access
    set last_member_seen = now(), warned_at = null, alerted_at = null, postpone_token_hash = null
    where postpone_token_hash = encode(digest(p_token, 'sha256'), 'hex');
  get diagnostics n = row_count;
  return n > 0;
end $$;
revoke all on function public.postpone_emergency_alert(text) from public;
grant execute on function public.postpone_emergency_alert(text) to anon, authenticated;
