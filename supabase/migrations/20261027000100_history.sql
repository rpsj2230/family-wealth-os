-- History from every monthly tab of the workbook: closed deposits and accounts that are not on file are added from the older tabs.
-- The tabs never say when a deposit was paid out, nor (in the oldest ones) when it was booked, so those dates are estimates and
-- say so. Nothing here changes how a running deposit is valued.

alter table public.fixed_deposits
  add column ended_on         date,                          -- the day it left (paid out or closed), when known or estimated
  add column ended_estimated  boolean not null default false, -- the end date is read from the tabs (first month it is missing from), not from the bank
  add column start_estimated  boolean not null default false, -- the booking date is the first month the tabs list it (the tab gave none)
  add constraint fixed_deposits_ended_after_booked check (ended_on is null or ended_on >= booked_on);

comment on column public.fixed_deposits.ended_on is 'The day the deposit ended. Null: use the maturity date.';
comment on column public.fixed_deposits.ended_estimated is 'True when ended_on is estimated from the monthly tabs; edit it when the bank statement says otherwise.';
comment on column public.fixed_deposits.start_estimated is 'True when booked_on is the first month the monthly tabs list the deposit (they gave no start date).';

alter table public.assets
  add column from_history boolean not null default false;     -- added from the older monthly tabs, not from a current balance or statement

comment on column public.assets.from_history is 'Added by Import > History from all monthly tabs as a closed record.';
