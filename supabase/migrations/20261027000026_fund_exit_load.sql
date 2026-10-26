-- A fund's own exit load (1% within 365 days is typical, but each scheme sets its own); empty = use the household default in Settings.
alter table public.mf_positions
  add column exit_load_pct  numeric(6,5) check (exit_load_pct is null or (exit_load_pct >= 0 and exit_load_pct <= 0.1)),
  add column exit_load_days int check (exit_load_days is null or (exit_load_days >= 0 and exit_load_days <= 1095));
