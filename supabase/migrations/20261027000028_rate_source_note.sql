-- Where a rate came from, in words: "Pasted notes", "Typed in the form", "Edited by you", or the bank page it was read from.
alter table public.rate_offers add column source_note text check (source_note is null or length(source_note) <= 120);
