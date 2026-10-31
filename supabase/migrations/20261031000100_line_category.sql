-- What a bank statement line was spent on or came in as (food, travel, flights, a card bill, tax, a refund, salary …): the tag a
-- person gives a line, and the tag a rule gives every line it covers. The app guesses the rest from the merchant and the words
-- (core statement-categories.ts); a tag given here always wins over the guess. Additive only: nothing existing changes.
alter table public.statement_lines
  add column category text check (category is null or length(category) between 1 and 40);
alter table public.statement_rules
  add column category text check (category is null or length(category) between 1 and 40);
