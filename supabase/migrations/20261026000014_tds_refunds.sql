-- Tax withheld at source that comes back when the return is filed (for example on a tax-gain harvest by a non-resident).
-- One row per person, financial year and kind. Rows are created automatically from the harvest plan ("planned") and the
-- person moves them along as the sale happens, the return is filed and the refund arrives.
create table public.tds_refunds (
  id             uuid primary key default gen_random_uuid(),
  household_id   uuid not null references public.households on delete cascade,
  owner_id       uuid not null,
  fy             text not null check (fy ~ '^\d{4}-\d{2}$'),
  kind           text not null default 'harvest' check (kind in ('harvest', 'other')),
  description    text check (description is null or length(description) <= 300),
  expected_gain  numeric(18,2) not null default 0 check (expected_gain >= 0),
  expected_tds   numeric(18,2) not null default 0 check (expected_tds >= 0),
  expected_refund numeric(18,2) not null default 0 check (expected_refund >= 0),
  actual_gain    numeric(18,2) check (actual_gain is null or actual_gain >= 0),
  actual_tds     numeric(18,2) check (actual_tds is null or actual_tds >= 0),
  refund_received numeric(18,2) check (refund_received is null or refund_received >= 0),
  status         text not null default 'planned' check (status in ('planned', 'withheld', 'claimed', 'received')),
  notes          text check (notes is null or length(notes) <= 300),
  updated_at     timestamptz not null default now(),
  created_at     timestamptz not null default now(),
  foreign key (owner_id, household_id) references public.owners (id, household_id),
  unique (household_id, owner_id, fy, kind)
);

alter table public.tds_refunds enable row level security;
create policy tds_refunds_all on public.tds_refunds for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.tds_refunds from anon, authenticated;
grant select, insert, update, delete on public.tds_refunds to authenticated;
create trigger audit_tds_refunds after insert or update or delete on public.tds_refunds for each row execute function public.audit_row();
