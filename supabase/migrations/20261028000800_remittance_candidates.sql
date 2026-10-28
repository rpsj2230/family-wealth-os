-- The Indian accounts a transfer from Singapore can have gone to (the accounts it is sent to), so a bank statement that covers the day
-- and does not show it rules that account out, and the trail can name the others.
alter table public.remittances add column candidate_asset_ids uuid[] not null default '{}';
