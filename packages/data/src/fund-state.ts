/**
 * What is stored for a person's funds, in the shape the statement comparison wants (`diffFundImport` in core): the position, the
 * dated SIP history, every real transaction line, the latest value, the stored values on the statement dates and the verdicts the
 * person has overruled. Read only. Works with a user client (RLS) or the service role.
 */
import type { IgnorableVerdict, OnFileLine, OnFileState } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageAll } from './paging';

const must = <T>(r: { data: T | null; error: { message: string } | null }, what: string): T => {
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  return r.data as T;
};

export interface FundPosition {
  asset_id: string;
  units: number | null;
  invested: number | null;
  sip_monthly: number | null;
  sip_stopped: boolean | null;
}

export async function loadFundStates(
  db: SupabaseClient,
  hh: string,
  assetIds: string[],
  positions: FundPosition[],
  dates: string[],
): Promise<Map<string, OnFileState>> {
  const out = new Map<string, OnFileState>();
  if (assetIds.length === 0) return out;
  const pos = new Map(positions.map((p) => [p.asset_id, p]));

  const changes = new Map<string, { from: string; monthly: number }[]>();
  for (const c of must(
    await db
      .from('mf_sip_changes')
      .select('asset_id, effective_on, monthly')
      .eq('household_id', hh)
      .in('asset_id', assetIds)
      .order('effective_on'),
    'SIP history',
  ) as { asset_id: string; effective_on: string; monthly: number }[])
    changes.set(c.asset_id, [
      ...(changes.get(c.asset_id) ?? []),
      { from: c.effective_on, monthly: Number(c.monthly) },
    ]);

  // read in pages: the API returns at most 1,000 rows a request, and a comparison that misses stored lines counts them as new
  const lines = new Map<string, OnFileLine[]>();
  for (const t of await pageAll<{
    asset_id: string;
    source_ref: string;
    txn_on: string;
    kind: string;
    amount: number;
    units: number;
    source: string;
  }>((from, to) =>
    db
      .from('mf_transactions')
      .select('asset_id, source_ref, txn_on, kind, amount, units, source')
      .eq('household_id', hh)
      .in('asset_id', assetIds)
      .order('id')
      .range(from, to),
  ))
    lines.set(t.asset_id, [
      ...(lines.get(t.asset_id) ?? []),
      {
        key: t.source_ref,
        date: t.txn_on,
        kind: t.kind,
        amount: Number(t.amount),
        units: Number(t.units),
        source: t.source,
      },
    ]);

  const latest = new Map<string, { asOf: string; amount: number }>();
  await Promise.all(
    assetIds.map(async (id) => {
      const r = must(
        await db
          .from('observations')
          .select('as_of, amount')
          .eq('asset_id', id)
          .eq('kind', 'balance')
          .is('superseded_by', null)
          .order('as_of', { ascending: false })
          .limit(1),
        'latest value',
      ) as { as_of: string; amount: number }[];
      if (r[0]) latest.set(id, { asOf: r[0].as_of, amount: Number(r[0].amount) });
    }),
  );

  const snaps = new Map<string, { asOf: string; value: number; units: number | null }[]>();
  if (dates.length > 0)
    for (const s of must(
      await db
        .from('mf_snapshots')
        .select('asset_id, as_of, value, units')
        .eq('household_id', hh)
        .in('asset_id', assetIds)
        .in('as_of', dates),
      'stored values',
    ) as { asset_id: string; as_of: string; value: number; units: number | null }[])
      snaps.set(s.asset_id, [
        ...(snaps.get(s.asset_id) ?? []),
        { asOf: s.as_of, value: Number(s.value), units: s.units === null ? null : Number(s.units) },
      ]);

  const ignored = new Map<string, { verdict: IgnorableVerdict; basis: string }[]>();
  for (const i of must(
    await db
      .from('fund_import_ignores')
      .select('asset_id, verdict, basis')
      .eq('household_id', hh)
      .in('asset_id', assetIds),
    'overruled verdicts',
  ) as { asset_id: string; verdict: IgnorableVerdict; basis: string }[])
    ignored.set(i.asset_id, [
      ...(ignored.get(i.asset_id) ?? []),
      { verdict: i.verdict, basis: i.basis },
    ]);

  for (const id of assetIds) {
    const p = pos.get(id);
    out.set(id, {
      units: p?.units === null || p?.units === undefined ? null : Number(p.units),
      invested: p?.invested === null || p?.invested === undefined ? null : Number(p.invested),
      sipMonthly:
        p?.sip_monthly === null || p?.sip_monthly === undefined ? null : Number(p.sip_monthly),
      sipStopped: !!p?.sip_stopped,
      sipChanges: changes.get(id) ?? [],
      lines: lines.get(id) ?? [],
      latestValue: latest.get(id) ?? null,
      snapshots: snaps.get(id) ?? [],
      ignored: ignored.get(id) ?? [],
    });
  }
  return out;
}
