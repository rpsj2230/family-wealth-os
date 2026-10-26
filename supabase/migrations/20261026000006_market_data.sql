-- Public market data (AMFI scheme list, daily NAVs, FX rates). Same for everyone; written only by the scheduled job
-- (service role), readable by signed-in users. NAV history is kept only for schemes the household actually holds.
create table public.amfi_schemes (
  code         text primary key check (code ~ '^[0-9]+$'),
  name         text not null,
  plan         text,
  option       text,
  amc          text,
  category     text,
  isin_growth  text,
  isin_reinvest text,
  updated_on   date not null default current_date
);
create index amfi_schemes_name_idx on public.amfi_schemes using gin (to_tsvector('simple', name));

create table public.mf_navs (
  amfi_code text not null references public.amfi_schemes (code) on delete cascade,
  nav_date  date not null,
  nav       numeric(18,4) not null check (nav > 0),
  source    text not null default 'amfi',
  primary key (amfi_code, nav_date)
);

create table public.fx_rates (
  currency     char(3) not null check (currency ~ '^[A-Z]{3}$'),
  rate_date    date not null,
  inr_per_unit numeric(18,6) not null check (inr_per_unit > 0),
  source       text not null,
  primary key (currency, rate_date)
);

alter table public.amfi_schemes enable row level security;
alter table public.mf_navs      enable row level security;
alter table public.fx_rates     enable row level security;
create policy amfi_schemes_read on public.amfi_schemes for select to authenticated using (true);
create policy mf_navs_read      on public.mf_navs      for select to authenticated using (true);
create policy fx_rates_read     on public.fx_rates     for select to authenticated using (true);
revoke all on public.amfi_schemes, public.mf_navs, public.fx_rates from anon, authenticated;
grant select on public.amfi_schemes, public.mf_navs, public.fx_rates to authenticated;

-- You confirm which AMFI scheme a fund in your list is. Only codes that exist in the AMFI list are accepted.
create function public.confirm_scheme_match(p_household uuid, p_asset uuid, p_code text)
returns void language plpgsql as $$
begin
  if not public.is_member(p_household) then raise exception 'not a member of this household'; end if;
  if p_code is not null and not exists (select 1 from public.amfi_schemes where code = p_code) then
    raise exception 'unknown AMFI scheme code';
  end if;
  update public.mf_positions set amfi_code = p_code where asset_id = p_asset and household_id = p_household;
  if not found then raise exception 'unknown fund'; end if;
end $$;
revoke all on function public.confirm_scheme_match(uuid, uuid, text) from public;
grant execute on function public.confirm_scheme_match(uuid, uuid, text) to authenticated;
