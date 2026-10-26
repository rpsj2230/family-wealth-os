-- Daily summary email: who receives it (opt-in) and a delivery log. A row is only ever marked
-- "accepted_by_provider" when the mail server accepted the message; the app never claims "delivered".
create table public.digest_settings (
  household_id     uuid primary key references public.households on delete cascade,
  enabled          boolean not null default false,
  extra_recipients text[] not null default '{}',
  include_retirement boolean not null default true,
  updated_at       timestamptz not null default now(),
  check (cardinality(extra_recipients) <= 5),
  check (array_to_string(extra_recipients, ',') ~ '^([^@,\s]+@[^@,\s]+\.[^@,\s]+(,|$))*$')
);

create table public.digest_log (
  id            uuid primary key default gen_random_uuid(),
  household_id  uuid not null references public.households on delete cascade,
  digest_date   date not null,
  channel       text not null default 'email' check (channel in ('email')),
  status        text not null check (status in ('sending','accepted_by_provider','failed')),
  recipients    int not null default 0,
  provider_id   text,
  error         text,
  attempts      int not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (household_id, digest_date, channel)
);

alter table public.digest_settings enable row level security;
alter table public.digest_log      enable row level security;
create policy digest_settings_all on public.digest_settings for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy digest_log_read     on public.digest_log      for select using (public.is_member(household_id));
revoke all on public.digest_settings, public.digest_log from anon, authenticated;
grant select, insert, update on public.digest_settings to authenticated;
grant select on public.digest_log to authenticated;
create trigger audit_digest_settings after insert or update or delete on public.digest_settings for each row execute function public.audit_row();
