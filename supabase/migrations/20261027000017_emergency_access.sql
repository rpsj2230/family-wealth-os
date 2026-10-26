-- When the read-only family login may open the handbook: always, only after nobody from the household has signed in for
-- a while, or only when a member releases it. Members always have it.
create table public.emergency_access (
  household_id     uuid primary key references public.households on delete cascade,
  mode             text not null default 'always' check (mode in ('always', 'inactive', 'manual')),
  inactive_days    int not null default 30 check (inactive_days between 7 and 365),
  released         boolean not null default false,
  last_member_seen timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
alter table public.emergency_access enable row level security;
create policy eaccess_members on public.emergency_access for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.emergency_access from anon, authenticated;
grant select, insert, update on public.emergency_access to authenticated;

-- true when the caller may read the handbook of this household right now
create function public.emergency_open(h uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_member(h) or (
    public.has_access(h) and coalesce((
      select case a.mode
        when 'always' then true
        when 'manual' then a.released
        else a.released or a.last_member_seen < now() - make_interval(days => a.inactive_days)
      end
      from public.emergency_access a where a.household_id = h), true))
$$;
revoke all on function public.emergency_open(uuid) from public, anon;
grant execute on function public.emergency_open(uuid) to authenticated;

-- what a locked viewer is told (no financial data)
create function public.emergency_status(h uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.has_access(h) then null else jsonb_build_object(
    'open', public.emergency_open(h),
    'mode', coalesce(a.mode, 'always'),
    'inactiveDays', coalesce(a.inactive_days, 30),
    'daysUntilOpen', case when coalesce(a.mode, 'always') = 'inactive'
      then greatest(0, ceil(extract(epoch from (a.last_member_seen + make_interval(days => a.inactive_days) - now())) / 86400))::int end)
  end
  from (select 1) x left join public.emergency_access a on a.household_id = h
$$;
revoke all on function public.emergency_status(uuid) from public, anon;
grant execute on function public.emergency_status(uuid) to authenticated;

-- called when a member uses the app; at most once an hour per household
create function public.touch_member_activity(p_household uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_member(p_household) then return; end if;
  insert into public.emergency_access (household_id, last_member_seen) values (p_household, now())
    on conflict (household_id) do update set last_member_seen = now()
    where public.emergency_access.last_member_seen < now() - interval '1 hour';
end $$;
revoke all on function public.touch_member_activity(uuid) from public, anon;
grant execute on function public.touch_member_activity(uuid) to authenticated;

drop policy edoc_read on public.emergency_documents;
create policy edoc_read on public.emergency_documents for select using (public.emergency_open(household_id));
