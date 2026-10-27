-- A bank can have several rate pages, each carrying savings rates, fixed deposit rates or both (some banks publish them on different
-- links). `kind` says which, so the reader takes only that kind from the page. The bank may have as many rows as it has pages:
-- the only uniqueness is (household, url).
--
-- `last_docs` is what the last sync did with each document it tried for the bank (address, kind, read or not and why, characters,
-- the date the bank gives), shown on the Sync bank rates page. Written to every row of the bank.
alter table public.rate_sources
  add column kind text not null default 'both' check (kind in ('savings', 'fd', 'both')),
  add column last_docs jsonb check (last_docs is null or (jsonb_typeof(last_docs) = 'array' and pg_column_size(last_docs) < 20000));
