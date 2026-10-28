-- Bank statements read line by line (Import > Bank statement; Explain movements > Bank statements).
--
-- bank_statements: one row per file you imported for one account: the days it covers, the balances before and after, how it was
-- read and how many lines did not follow the running balance. Deleting it removes its lines.
-- statement_lines: one row per transaction line, kept only as far as the figures need it: the date, the signed amount (+ in, − out),
-- the balance after it and the narration with long numbers already cut to their last four digits. line_key (date, amount, balance and
-- the line's place among identical ones) makes an overlapping statement add nothing twice. answer is what you said a line was when no
-- rule could place it. The class of every line is worked out again each time from the rules (core statement-classify.ts), so a better
-- rule or a new deposit on file re-sorts old lines without touching them.
-- No audit trigger on the lines: ten years are thousands of rows, and the audit log would copy every narration.
create table public.bank_statements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  asset_id     uuid not null,
  from_on      date not null,
  to_on        date not null check (to_on >= from_on),
  opening      numeric(18,2),
  closing      numeric(18,2),
  line_count   integer not null check (line_count >= 0),
  layout       text not null check (layout in ('debit-credit', 'amount-drcr', 'balance-moves')),
  breaks       integer not null default 0 check (breaks >= 0),
  file_label   text check (file_label is null or length(file_label) <= 120),
  uploaded_at  timestamptz not null default now(),
  created_by   uuid default auth.uid(),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index bank_statements_asset_idx on public.bank_statements (household_id, asset_id, from_on);

create table public.statement_lines (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households on delete cascade,
  statement_id uuid not null references public.bank_statements on delete cascade,
  asset_id     uuid not null,
  txn_on       date not null,
  amount       numeric(18,2) not null check (amount <> 0),
  balance      numeric(18,2),
  narration    text not null check (length(narration) <= 200),
  line_key     text not null check (length(line_key) between 8 and 120),
  answer       text check (answer is null or answer in ('outside', 'own', 'income', 'rent', 'out')),
  unique (household_id, asset_id, line_key),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index statement_lines_on_idx on public.statement_lines (household_id, txn_on);

alter table public.bank_statements enable row level security;
alter table public.statement_lines enable row level security;
create policy bank_statements_all on public.bank_statements for all using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy statement_lines_all on public.statement_lines for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.bank_statements, public.statement_lines from anon, authenticated;
grant select, insert, update, delete on public.bank_statements, public.statement_lines to authenticated;
create trigger audit_bank_statements after insert or update or delete on public.bank_statements for each row execute function public.audit_row();
