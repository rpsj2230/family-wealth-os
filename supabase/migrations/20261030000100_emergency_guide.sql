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
