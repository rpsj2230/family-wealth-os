-- A loan that was really a gift: recorded for the family's own memory, never counted in net worth, liquidity or reminders.
alter table public.assets drop constraint if exists assets_status_check;
alter table public.assets add constraint assets_status_check
  check (status in ('active','matured','matured_unconfirmed','renewed','closed','stopped','gifted'));
