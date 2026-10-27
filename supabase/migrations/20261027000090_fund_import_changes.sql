-- Fund statements and transaction files are compared with what is on file before anything is written (see docs/USER-GUIDE.md, fund
-- statements). Three small additions carry that:
--  1. cas_imports.changes: the list of changes an import proposed or made (per fund: new, sold, SIP stopped, new lines, units before and after),
--     kept with the import so the Import page and the Recorded tab can show what changed and why;
--  2. fund_import_ignores: a verdict the person overruled at the preview ("this SIP is not stopped", "this fund is not sold"), remembered under
--     the facts it was based on, so the same statement does not propose it again;
--  3. apply_sip_change: a dated change of a fund's SIP that also works for the background jobs (which have no signed-in member): the amount
--     takes effect on the given day in mf_sip_changes, never on the day the statement was read.
alter table public.cas_imports add column changes jsonb;

create table public.fund_import_ignores (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null,
  asset_id     uuid not null,
  verdict      text not null check (verdict in ('sold', 'sip_stopped', 'sip_new', 'sip_resumed', 'sip_changed')),
  basis        text not null check (length(basis) between 1 and 120),
  created_at   timestamptz not null default now(),
  unique (asset_id, verdict, basis),
  foreign key (asset_id, household_id) references public.assets (id, household_id) on delete cascade
);
create index fund_import_ignores_asset_idx on public.fund_import_ignores (household_id, asset_id);
alter table public.fund_import_ignores enable row level security;
create policy fund_import_ignores_all on public.fund_import_ignores for all using (public.is_member(household_id)) with check (public.is_member(household_id));
revoke all on public.fund_import_ignores from anon, authenticated;
grant select, insert, update, delete on public.fund_import_ignores to authenticated;
create trigger audit_fund_import_ignores after insert or update or delete on public.fund_import_ignores for each row execute function public.audit_row();

-- Change, stop or restart a SIP from a given day. p_monthly = 0 stops it. Unlike set_sip it checks no membership itself: it runs with the
-- caller's rights, so Row Level Security lets a member change only their own household, and the service role (the mailbox job) can change any.
create function public.apply_sip_change(p_household uuid, p_asset uuid, p_monthly numeric, p_effective_on date)
returns void language plpgsql as $$
declare
  v_pos public.mf_positions%rowtype;
  v_monthly numeric;
begin
  if p_monthly is null or p_monthly < 0 then raise exception 'the SIP amount must be zero or more'; end if;
  if p_effective_on is null then raise exception 'the day the change takes effect is needed'; end if;
  if p_effective_on > current_date + 31 then raise exception 'date too far ahead'; end if;
  select * into v_pos from public.mf_positions where asset_id = p_asset and household_id = p_household;
  if not found then raise exception 'unknown fund'; end if;
  v_monthly := case when p_monthly > 0 then p_monthly else v_pos.sip_monthly end;
  -- nothing to write when the fund already has this amount and state
  if v_monthly is not distinct from v_pos.sip_monthly and (p_monthly = 0) = v_pos.sip_stopped then return; end if;
  perform set_config('app.sip_effective_on', p_effective_on::text, true);
  update public.mf_positions set sip_monthly = v_monthly, sip_stopped = (p_monthly = 0)
    where asset_id = p_asset and household_id = p_household;
  perform set_config('app.sip_effective_on', '', true);
end $$;
revoke all on function public.apply_sip_change(uuid, uuid, numeric, date) from public, anon;
grant execute on function public.apply_sip_change(uuid, uuid, numeric, date) to authenticated, service_role;
