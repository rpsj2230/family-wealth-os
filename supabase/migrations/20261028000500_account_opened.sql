-- When an account was opened, as far as the records tell. opened_on is the latest day it can have been opened (the first record that
-- has it); opened_after, when known, is the last day it was certainly not open yet (a record of that day does not list it). Both empty:
-- not known. The money trail never takes money from an account before it was open.
alter table public.assets
  add column opened_on    date,
  add column opened_after date,
  add column opened_note  text check (opened_note is null or length(opened_note) <= 200),
  add constraint assets_opened_order check (opened_after is null or opened_on is null or opened_after < opened_on);
