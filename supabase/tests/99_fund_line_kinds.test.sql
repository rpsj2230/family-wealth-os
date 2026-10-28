begin;
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000c8', 'flk@example.test');
select t.as_user('00000000-0000-0000-0000-0000000000c8');
create temp table flk as select public.create_household('Fund line kinds') as h;
grant all on flk to authenticated;
insert into public.owners (household_id, display_name) select h, 'Someone' from flk;
insert into public.assets (household_id, type, owner_id, nickname)
  select c.h, 'mutual_fund', o.id, 'Sample fund' from flk c join public.owners o on o.household_id = c.h;

-- an IDCW paid out in cash is stored as its own kind, with no units
insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, description, source_ref)
  select c.h, a.id, '2026-03-15', 'dividend_payout', 51.25, 0, 'IDCW Paid', '2026-03-15|dividend_payout|51.25|0|f1|1'
  from flk c join public.assets a on a.household_id = c.h;
do $$ begin
  if (select count(*) from public.mf_transactions where kind = 'dividend_payout') <> 1 then raise exception 'payout not stored'; end if;
end $$;

-- an unknown kind is still refused
do $$ begin
  begin
    insert into public.mf_transactions (household_id, asset_id, txn_on, kind, amount, units, source_ref)
      select c.h, a.id, '2026-03-16', 'made_up', 1, 1, 'x' from flk c join public.assets a on a.household_id = c.h;
    raise exception 'an unknown kind was accepted';
  exception when check_violation then null;
  end;
end $$;
rollback;
