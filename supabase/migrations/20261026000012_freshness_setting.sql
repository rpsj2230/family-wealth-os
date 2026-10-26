-- A balance's "out of date" window now comes from Settings unless an account has its own value.
alter table public.assets alter column expected_freshness_days drop not null;
alter table public.assets alter column expected_freshness_days drop default;
update public.assets set expected_freshness_days = null where expected_freshness_days = 35;
