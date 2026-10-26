-- Refunds of tax withheld on NRO deposit interest, tracked next to the harvest refunds.
alter table public.tds_refunds drop constraint tds_refunds_kind_check;
alter table public.tds_refunds add constraint tds_refunds_kind_check check (kind in ('harvest', 'interest', 'other'));
