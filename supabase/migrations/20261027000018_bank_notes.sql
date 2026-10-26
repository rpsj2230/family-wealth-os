-- Notes about a whole bank: minimum balance, cards, lounge access, who to call.
alter table public.institutions add column notes text check (notes is null or length(notes) <= 500);
