-- Savings rates come in balance slabs (2.5% up to 1 lakh, 3.5% from 1 to 5 lakh, ...), and some deposits are quoted in days.
alter table public.rate_offers
  add column balance_from numeric(16,2) check (balance_from is null or balance_from >= 0),
  add column balance_to   numeric(16,2) check (balance_to is null or balance_to > 0),
  add column tenure_days  int check (tenure_days is null or tenure_days between 1 and 7300),
  add constraint rate_offers_slab_order check (balance_to is null or balance_to > coalesce(balance_from, 0));

-- the old uniqueness (one rate per bank, product, kind and tenure) would reject the second slab of the same account
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.rate_offers'::regclass and contype = 'u'
  loop
    execute format('alter table public.rate_offers drop constraint %I', c);
  end loop;
end $$;

create unique index rate_offers_slot on public.rate_offers
  (household_id, bank, product, account_kind, tenure_from_months, tenure_to_months, coalesce(balance_from, 0), coalesce(balance_to, -1));
