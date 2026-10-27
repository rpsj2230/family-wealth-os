-- A fund statement folio that the person has said belongs to one of their funds.
--
-- When a statement folio could be more than one of a person's funds (two funds share an ISIN, or a fund has been added twice), the preview
-- no longer says "needs a look": it suggests the likeliest fund with the reason and asks the person to approve it, pick another or add a
-- new fund (see docs/UI-GUIDE.md, "Suggest, do not hand back"). The approved answer is kept here, so the same statement folio is matched
-- to that fund from then on and the question is never asked again. mf_positions has only one folio_last4 per fund, so it cannot say that
-- a second folio of the same scheme belongs to the fund; this table can.
--
--  - folio_last4: the last four characters of the folio number on the statement (never the whole folio, never a PAN);
--  - scheme_key: the scheme's ISIN in lower case, or `name:` and the normalised name when the statement gives no ISIN;
--  - one row per (person, folio, scheme): writing the same answer again changes nothing; a different answer replaces the fund it points to;
--  - the fund must belong to the same person: a statement only ever changes the funds of the person it belongs to;
--  - nothing is ever deleted by the importer (rows go only with the fund or the person).
create table public.fund_folio_links (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  owner_id     uuid not null,
  asset_id     uuid not null,
  folio_last4  text not null check (folio_last4 ~ '^[0-9A-Za-z]{1,4}$'),
  scheme_key   text not null check (length(scheme_key) between 1 and 200),
  created_at   timestamptz not null default now(),
  unique (household_id, owner_id, folio_last4, scheme_key),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade,
  foreign key (owner_id, household_id) references public.owners (id, household_id) on delete cascade
);
create index fund_folio_links_asset_idx on public.fund_folio_links (household_id, asset_id);

create function public.fund_folio_links_same_owner() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.assets a where a.id = new.asset_id and a.household_id = new.household_id and a.owner_id = new.owner_id) then
    raise exception 'the fund must belong to the same person as the statement folio';
  end if;
  return new;
end $$;
create trigger fund_folio_links_owner before insert or update on public.fund_folio_links
  for each row execute function public.fund_folio_links_same_owner();

alter table public.fund_folio_links enable row level security;
create policy fund_folio_links_all on public.fund_folio_links for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.fund_folio_links from anon, authenticated;
grant select, insert, update, delete on public.fund_folio_links to authenticated;
create trigger audit_fund_folio_links after insert or update or delete on public.fund_folio_links for each row execute function public.audit_row();
