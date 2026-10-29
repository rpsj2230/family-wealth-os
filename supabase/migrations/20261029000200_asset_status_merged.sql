-- A record joined into another (the same holding entered twice): kept as history, counted on no day.
alter table public.assets drop constraint if exists assets_status_check;
alter table public.assets add constraint assets_status_check
  check (status in ('active','matured','matured_unconfirmed','renewed','closed','stopped','gifted','merged'));
