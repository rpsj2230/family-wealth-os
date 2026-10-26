-- Form 26AS and Annual Information Statement, as read from the files the person uploaded. Only the figures are kept: never the PAN
-- (the last four digits at most) and never the file itself.
create table public.tax_statements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  owner_id     uuid not null,
  fy           text not null check (fy ~ '^\d{4}-\d{2}$'),
  kind         text not null check (kind in ('26as', 'ais')),
  parsed       jsonb not null check (jsonb_typeof(parsed) = 'object' and pg_column_size(parsed) < 600000),
  read_by      text not null default 'rules' check (read_by in ('rules', 'ai')),
  uploaded_on  date not null default current_date,
  updated_at   timestamptz not null default now(),
  foreign key (owner_id, household_id) references public.owners (id, household_id),
  unique (household_id, owner_id, fy, kind)
);
alter table public.tax_statements enable row level security;
create policy tax_statements_all on public.tax_statements for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.tax_statements from anon, authenticated;
grant select, insert, update, delete on public.tax_statements to authenticated;
-- no audit trigger: the log would copy the whole statement
