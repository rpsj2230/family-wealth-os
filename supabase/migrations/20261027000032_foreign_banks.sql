-- A bank outside the Indian deposit insurance scheme (a foreign bank): its money is left out of the cover figures.
alter table public.institutions add column deposit_insured boolean not null default true;
-- UOB and DBS are the family's Singapore banks
update public.institutions set deposit_insured = false where upper(trim(name)) in ('UOB', 'DBS');
