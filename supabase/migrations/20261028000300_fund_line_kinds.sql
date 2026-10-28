-- Fund statement lines: an IDCW (dividend) paid out in cash is its own kind (no units; money to the holder), and the CAMS short form
-- of a SIP instalment, "Sys. Investment (12/120)", which was read as "other", is a SIP. Its stored reference carries the kind, so it is
-- rewritten too: the next import of the same statement then finds these lines by reference and adds nothing twice.
alter table public.mf_transactions drop constraint if exists mf_transactions_kind_check;
alter table public.mf_transactions add constraint mf_transactions_kind_check
  check (kind in ('purchase', 'sip', 'switch_in', 'dividend_reinvest', 'dividend_payout', 'bonus', 'redeem', 'switch_out', 'other'));

update public.mf_transactions
   set kind = 'sip',
       source_ref = replace(source_ref, '|other|', '|sip|')
 where kind = 'other'
   and units > 0
   and description ~* '^\s*sys\.?\s*invest';
