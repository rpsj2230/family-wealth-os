import { notFound } from 'next/navigation';
import { pageAll } from '@fwos/data';
import { describeAudit, formatInr, personStyles, sourceTag, type PersonStyle } from '@fwos/core';
import type { Fact } from '@/components/AssetFacts';
import type { ActivityItem } from '@/components/ActivityLog';
import { loadContext } from './data';
import { buildActivity, type AuditIn, type InboxIn } from './detail-view';
import { loadPortfolio } from './portfolio-data';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const inr = (n: number | null | undefined) =>
  n === null || n === undefined ? '–' : formatInr(Math.round(n));
const num = (n: number | null | undefined, d = 4) =>
  n === null || n === undefined ? '–' : n.toLocaleString('en-IN', { maximumFractionDigits: d });
const when = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        timeZone: 'Asia/Singapore',
      })
    : '–';

const CONF: Record<string, string> = {
  verified: 'Verified',
  manual_confirmed: 'Confirmed by you',
  imported_unverified: 'Imported, not verified',
  manual_unverified: 'Typed, not confirmed',
  estimated: 'Estimate',
};
const KIND: Record<string, string> = {
  balance: 'Balance',
  ledger_balance: 'Ledger balance',
  available_balance: 'Available balance',
  valuation: 'Valuation',
  accrued_value: 'Accrued value',
};
const TXN: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  switch_out: 'Switch out',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  redeem: 'Sale',
  other: 'Other',
};

export interface RecordDetail {
  assetId: string;
  assetTitle: string;
  person: PersonStyle | undefined;
  kind: 'reading' | 'transaction';
  title: string;
  headline: string;
  headlineNote: string;
  facts: Fact[];
  /** earlier / later records of the same item */
  neighbours: { label: string; href: string; text: string }[];
  activity: ActivityItem[];
}

async function base(assetId: string) {
  if (!UUID.test(assetId)) notFound();
  const { supabase, householdId, userId } = await loadContext();
  if (!householdId) notFound();
  const l = await loadPortfolio(supabase);
  const asset = l.assetRows.find((a) => a.id === assetId);
  if (!asset) notFound();
  const owners = await supabase.from('owners').select('id, display_name').order('created_at');
  const styles = personStyles(
    ((owners.data ?? []) as { id: string; display_name: string }[]).map((o) => ({
      id: o.id,
      name: o.display_name,
    })),
  );
  return { supabase, userId, l, asset, styles };
}

/** One recorded balance or valuation: every field kept about it, where it came from, what replaced it, and its neighbours. */
export async function loadReadingDetail(assetId: string, obsId: string): Promise<RecordDetail> {
  if (!UUID.test(obsId)) notFound();
  const { supabase, userId, asset, styles } = await base(assetId);
  const [o, all, replaced, audit] = await Promise.all([
    supabase.from('observations').select('*').eq('id', obsId).eq('asset_id', assetId).maybeSingle(),
    supabase
      .from('observations')
      .select('id, as_of, amount, fx_rate, created_at')
      .eq('asset_id', assetId)
      .is('superseded_by', null)
      .order('as_of')
      .order('created_at')
      .limit(1000),
    supabase.from('observations').select('id, as_of, amount').eq('superseded_by', obsId),
    supabase
      .from('audit_events')
      .select('actor, table_name, row_id, action, before, after, at')
      .eq('table_name', 'observations')
      .eq('row_id', obsId)
      .order('at', { ascending: false })
      .limit(50),
  ]);
  const r = o.data as Record<string, unknown> | null;
  if (!r) notFound();
  const amount = Number(r.amount);
  const fx = r.fx_rate === null ? null : Number(r.fx_rate);
  const rupees = amount * (fx ?? 1);
  const list = ((all.data ?? []) as Record<string, unknown>[]).map((x) => ({
    id: x.id as string,
    asOf: x.as_of as string,
    value: Number(x.amount) * (x.fx_rate === null ? 1 : Number(x.fx_rate)),
  }));
  const idx = list.findIndex((x) => x.id === obsId);
  const prev = idx > 0 ? list[idx - 1] : undefined;
  const next = idx >= 0 ? list[idx + 1] : undefined;
  const superseded = r.superseded_by as string | null;
  const src = sourceTag(r.source as string, r.as_of as string, false);
  const ref = (r.source_ref as string | null) ?? null;
  const mail = ref
    ? await supabase
        .from('inbox_messages')
        .select('received_on, created_at, from_domain, subject, outcome, reason')
        .eq('message_id', ref)
        .limit(1)
    : { data: [] };
  const m = ((mail.data ?? []) as InboxIn[])[0];
  const by = r.created_by as string | null;
  const facts: Fact[] = [
    { label: 'Date the value is for', value: r.as_of as string },
    {
      label: 'Amount',
      value: r.currency === 'INR' ? inr(amount) : `${r.currency as string} ${num(amount, 2)}`,
    },
    ...(r.currency !== 'INR'
      ? [
          {
            label: 'Exchange rate used',
            value: fx === null ? '–' : `₹${num(fx, 4)} per ${r.currency as string}`,
          },
        ]
      : []),
    { label: 'In rupees', value: inr(rupees) },
    ...(prev
      ? [
          {
            label: 'Change since the reading before',
            value: `${rupees - prev.value >= 0 ? '+' : '−'}${inr(Math.abs(rupees - prev.value))}`,
            note: `from ${inr(prev.value)} on ${prev.asOf}`,
          },
        ]
      : []),
    { label: 'Kind of value', value: KIND[r.kind as string] ?? (r.kind as string) },
    { label: 'Source', value: src.label, note: `recorded as “${r.source as string}”` },
    { label: 'Confidence', value: CONF[r.confidence as string] ?? (r.confidence as string) },
    { label: 'Recorded on', value: when(r.created_at as string) },
    ...(r.received_at
      ? [{ label: 'E-mail or file arrived', value: when(r.received_at as string) }]
      : []),
    {
      label: 'Entered by',
      value: by === null ? 'Automatic job' : by === userId ? 'You' : 'A family member',
    },
    {
      label: 'Used in totals',
      value: superseded ? 'No: replaced by a later correction' : 'Yes',
      ...(superseded ? { href: `/asset/${assetId}/reading/${superseded}` } : {}),
    },
    ...(((replaced.data ?? []) as unknown[]).length > 0
      ? [
          {
            label: 'This corrected',
            value: ((replaced.data ?? []) as { as_of: string; amount: number }[])
              .map((x) => `${x.as_of}: ${inr(Number(x.amount))}`)
              .join(', '),
          },
        ]
      : []),
    ...(r.note ? [{ label: 'Note', value: r.note as string }] : []),
    ...(ref
      ? [{ label: 'Source reference', value: ref.length > 80 ? `${ref.slice(0, 80)}…` : ref }]
      : []),
    ...(m
      ? [
          {
            label: 'E-mail it was read from',
            value: m.subject ?? '(no subject)',
            note: `${m.from_domain ?? 'unknown sender'} · ${m.received_on ?? ''} · ${m.outcome}${m.reason ? `: ${m.reason}` : ''}`,
          },
        ]
      : []),
  ];
  const activity = buildActivity({
    audit: ((audit.data ?? []) as AuditIn[]).filter((a) => describeAudit(a).title !== ''),
    viewerId: userId ?? '',
  });
  return {
    assetId,
    assetTitle: asset.label || asset.nickname,
    person: styles[asset.owner_id],
    kind: 'reading',
    title: `${inr(rupees)} on ${r.as_of as string}`,
    headline: inr(rupees),
    headlineNote: `as of ${r.as_of as string}`,
    facts,
    neighbours: [
      ...(prev
        ? [
            {
              label: 'Reading before',
              href: `/asset/${assetId}/reading/${prev.id}`,
              text: `${prev.asOf} · ${inr(prev.value)}`,
            },
          ]
        : []),
      ...(next
        ? [
            {
              label: 'Reading after',
              href: `/asset/${assetId}/reading/${next.id}`,
              text: `${next.asOf} · ${inr(next.value)}`,
            },
          ]
        : []),
    ],
    activity,
  };
}

/** One fund transaction with the units held around it, what those units are worth now, and its neighbours. */
export async function loadTxnDetail(assetId: string, txnId: string): Promise<RecordDetail> {
  if (!UUID.test(txnId)) notFound();
  const { supabase, userId, l, asset, styles } = await base(assetId);
  const [t, all, audit] = await Promise.all([
    supabase
      .from('mf_transactions')
      .select('*')
      .eq('id', txnId)
      .eq('asset_id', assetId)
      .maybeSingle(),
    pageAll<Record<string, unknown>>((from, to) =>
      supabase
        .from('mf_transactions')
        .select('id, txn_on, kind, amount, units, created_at')
        .eq('asset_id', assetId)
        .is('superseded_on', null)
        .order('txn_on')
        .order('created_at')
        .order('id')
        .range(from, to),
    ),
    supabase
      .from('audit_events')
      .select('actor, table_name, row_id, action, before, after, at')
      .eq('row_id', txnId)
      .order('at', { ascending: false })
      .limit(20),
  ]);
  const r = t.data as Record<string, unknown> | null;
  if (!r) notFound();
  const pos = await supabase
    .from('mf_positions')
    .select('fund_name')
    .eq('asset_id', assetId)
    .maybeSingle();
  const fundName = ((pos.data as { fund_name: string } | null)?.fund_name ??
    asset.nickname) as string;
  const units = Number(r.units);
  const amount = Number(r.amount);
  const sell = units < 0 || ['redeem', 'switch_out'].includes(r.kind as string);
  const navNow = l.fundInfo[assetId]?.nav ?? null;
  const list = all.map((x) => ({
    id: x.id as string,
    on: x.txn_on as string,
    kind: x.kind as string,
    amount: Number(x.amount),
  }));
  const idx = list.findIndex((x) => x.id === txnId);
  const prev = idx > 0 ? list[idx - 1] : undefined;
  const next = idx >= 0 ? list[idx + 1] : undefined;
  const nowValue = navNow !== null && !sell ? Math.abs(units) * navNow : null;
  const facts: Fact[] = [
    { label: 'Date', value: r.txn_on as string },
    { label: 'Type', value: TXN[r.kind as string] ?? (r.kind as string) },
    { label: 'Amount', value: inr(Math.abs(amount)) },
    { label: sell ? 'Units sold' : 'Units', value: num(Math.abs(units)) },
    { label: 'Price per unit (NAV)', value: num(r.nav === null ? null : Number(r.nav)) },
    {
      label: 'Units held after this',
      value: num(r.balance_units === null ? null : Number(r.balance_units)),
    },
    ...(nowValue !== null
      ? [
          {
            label: 'These units are worth now',
            value: inr(nowValue),
            note: `${nowValue - Math.abs(amount) >= 0 ? '+' : '−'}${inr(Math.abs(nowValue - Math.abs(amount)))} against what was paid, at today's price ${num(navNow, 4)}`,
          },
        ]
      : []),
    ...(r.description
      ? [{ label: 'Description in the statement', value: r.description as string }]
      : []),
    {
      label: 'Where it came from',
      value:
        r.source === 'manual'
          ? 'Entered by hand'
          : r.source === 'cas'
            ? 'Fund statement import'
            : r.source === 'csv'
              ? 'App export (transactions file)'
              : (r.source as string),
      note: r.source_ref ? `reference ${String(r.source_ref).slice(0, 60)}` : undefined,
    },
    { label: 'Added on', value: when(r.created_at as string) },
    ...(r.superseded_on
      ? [
          {
            label: 'Replaced by a fund statement',
            value: when(r.superseded_on as string),
            note: `${String(r.superseded_reason ?? 'Replaced by a fund statement')}. This line is kept here for review and is not counted anywhere.`,
          },
        ]
      : []),
  ];
  return {
    assetId,
    assetTitle: fundName,
    person: styles[asset.owner_id],
    kind: 'transaction',
    title: `${TXN[r.kind as string] ?? 'Transaction'} on ${r.txn_on as string}`,
    headline: inr(Math.abs(amount)),
    headlineNote: sell ? 'sold' : 'invested',
    facts,
    neighbours: [
      ...(prev
        ? [
            {
              label: 'Transaction before',
              href: `/asset/${assetId}/txn/${prev.id}`,
              text: `${prev.on} · ${TXN[prev.kind] ?? prev.kind} · ${inr(Math.abs(prev.amount))}`,
            },
          ]
        : []),
      ...(next
        ? [
            {
              label: 'Transaction after',
              href: `/asset/${assetId}/txn/${next.id}`,
              text: `${next.on} · ${TXN[next.kind] ?? next.kind} · ${inr(Math.abs(next.amount))}`,
            },
          ]
        : []),
    ],
    activity: buildActivity({ audit: (audit.data ?? []) as AuditIn[], viewerId: userId ?? '' }),
  };
}
