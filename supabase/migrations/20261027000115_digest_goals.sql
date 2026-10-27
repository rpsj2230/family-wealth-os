-- Daily summary: a switch for the goals view, next to the retirement view. On by default, so households that saved their
-- settings before this existed keep getting everything (an absent value behaves as on).
alter table public.digest_settings add column if not exists include_goals boolean not null default true;
