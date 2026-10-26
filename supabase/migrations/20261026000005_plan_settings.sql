-- Retirement/forecast assumptions saved by the household. These are inputs, never facts about holdings.
create table public.plan_settings (
  household_id uuid primary key references public.households on delete cascade,
  settings     jsonb not null default '{}'::jsonb,
  updated_by   uuid default auth.uid(),
  updated_at   timestamptz not null default now(),
  check (jsonb_typeof(settings) = 'object' and pg_column_size(settings) < 20000)
);
alter table public.plan_settings enable row level security;
create policy plan_settings_all on public.plan_settings for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.plan_settings from anon, authenticated;
grant select, insert, update on public.plan_settings to authenticated;
create trigger audit_plan_settings after insert or update or delete on public.plan_settings for each row execute function public.audit_row();
