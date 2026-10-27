-- Bank-email inbox: keep a copy of each email's text so a reading can be checked against the original, the email can be read
-- again by the AI on its own, and a wrong number can be corrected. The copy is text only (no attachments), account numbers are cut
-- to their last four digits before it is stored, and it is capped in length.
alter table public.inbox_messages
  add column body_text text check (body_text is null or length(body_text) <= 8000),
  -- set when you press Read again on a message that has no copy yet; the next mailbox run reads that message again and clears it
  add column rescan_requested_at timestamptz;

grant update (resolved_at, rescan_requested_at) on public.inbox_messages to authenticated;

-- What the app records after reading one message again, or after you correct its number. Members only; touches nothing but the log row.
create function public.save_inbox_result(
  p_id uuid, p_outcome text, p_reason text, p_reading jsonb, p_asset uuid, p_resolved boolean default false
) returns void language plpgsql security definer set search_path = public as $$
begin
  if p_outcome not in ('applied','needs_review','ignored','error') then raise exception 'unknown outcome' using errcode = '22023'; end if;
  update public.inbox_messages m set
    outcome = p_outcome,
    reason = left(p_reason, 500),
    reading = p_reading,
    asset_id = p_asset,
    resolved_at = case when p_resolved then coalesce(m.resolved_at, now()) else null end,
    rescan_requested_at = null
  where m.id = p_id and public.is_member(m.household_id);
  if not found then raise exception 'message not found' using errcode = '42501'; end if;
end $$;
revoke all on function public.save_inbox_result(uuid, text, text, jsonb, uuid, boolean) from public, anon;
grant execute on function public.save_inbox_result(uuid, text, text, jsonb, uuid, boolean) to authenticated;
