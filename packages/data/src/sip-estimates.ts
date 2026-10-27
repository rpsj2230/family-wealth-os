/**
 * Keeps the instalments a SIP is assumed to have made, since the units were last counted, in the transaction list as estimates
 * (source 'estimate', reference 'est:<date>', worded "Estimated"). They make lots, returns and graphs agree with the valuation, which
 * already counts them. They never stand in for a real line: a statement or entry that covers a date removes the estimates up to it
 * (a database trigger), and this job drops and re-creates the rest, so a changed SIP amount or a SIP that stopped is followed.
 * Works with a user client (RLS) or the service role.
 */
import { ESTIMATED_TXN_NOTE, sipInstalments } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageAll } from './paging';

interface Position {
  asset_id: string;
  household_id: string;
  amfi_code: string | null;
  sip_monthly: number | null;
  sip_stopped: boolean;
  started_on: string | null;
  units: number | null;
  units_as_of: string | null;
}

export interface SipEstimateReport {
  funds: number;
  added: number;
  removed: number;
}

export async function syncSipEstimates(
  db: SupabaseClient,
  opts: { householdId?: string; today: Date },
): Promise<SipEstimateReport> {
  const today = opts.today.toISOString().slice(0, 10);
  const pq = db
    .from('mf_positions')
    .select(
      'asset_id, household_id, amfi_code, sip_monthly, sip_stopped, started_on, units, units_as_of',
    );
  const posRes = await (opts.householdId ? pq.eq('household_id', opts.householdId) : pq);
  if (posRes.error) throw new Error(`positions: ${posRes.error.message}`);
  const positions = ((posRes.data ?? []) as unknown as Position[]).filter(
    (p) => p.units_as_of && p.sip_monthly && p.started_on && p.amfi_code,
  );
  if (positions.length === 0) return { funds: 0, added: 0, removed: 0 };

  const ids = positions.map((p) => p.asset_id);
  const live = new Set(
    (
      ((await db.from('assets').select('id').in('id', ids).eq('status', 'active')).data ?? []) as {
        id: string;
      }[]
    ).map((a) => a.id),
  );
  const changes = new Map<string, { from: string; monthly: number }[]>();
  for (const c of ((
    await db
      .from('mf_sip_changes')
      .select('asset_id, effective_on, monthly')
      .in('asset_id', ids)
      .order('effective_on')
  ).data ?? []) as { asset_id: string; effective_on: string; monthly: number }[])
    changes.set(c.asset_id, [
      ...(changes.get(c.asset_id) ?? []),
      { from: c.effective_on, monthly: Number(c.monthly) },
    ]);

  const txns = await pageAll<{
    id: string;
    asset_id: string;
    txn_on: string;
    source: string;
    source_ref: string;
    amount: number;
  }>((from, to) =>
    db
      .from('mf_transactions')
      .select('id, asset_id, txn_on, source, source_ref, amount')
      .in('asset_id', ids)
      .is('superseded_on', null)
      .order('txn_on')
      .order('id')
      .range(from, to),
  );
  const lastReal = new Map<string, string>();
  const estimates = new Map<string, typeof txns>();
  for (const t of txns) {
    if (t.source === 'estimate')
      estimates.set(t.asset_id, [...(estimates.get(t.asset_id) ?? []), t]);
    else if (t.txn_on > (lastReal.get(t.asset_id) ?? '')) lastReal.set(t.asset_id, t.txn_on);
  }

  const codes = [...new Set(positions.map((p) => p.amfi_code as string))];
  const earliest = positions.map((p) => p.units_as_of as string).sort()[0]!;
  const navRows = await pageAll<{ amfi_code: string; nav_date: string; nav: number }>((from, to) =>
    db
      .from('mf_navs')
      .select('amfi_code, nav_date, nav')
      .in('amfi_code', codes)
      .gte('nav_date', earliest)
      .order('nav_date')
      .range(from, to),
  );
  const navs = new Map<string, { date: string; nav: number }[]>();
  for (const n of navRows)
    navs.set(n.amfi_code, [
      ...(navs.get(n.amfi_code) ?? []),
      { date: n.nav_date, nav: Number(n.nav) },
    ]);

  const report: SipEstimateReport = { funds: 0, added: 0, removed: 0 };
  for (const p of positions) {
    const have = estimates.get(p.asset_id) ?? [];
    const wanted = new Map<string, { date: string; amount: number; nav: number; units: number }>();
    if (live.has(p.asset_id)) {
      const anchor = [p.units_as_of as string, lastReal.get(p.asset_id) ?? ''].sort().pop()!;
      const series = navs.get(p.amfi_code as string) ?? [];
      const plan = {
        monthly: Number(p.sip_monthly),
        startedOn: p.started_on as string,
        stopped: p.sip_stopped,
        ...(changes.has(p.asset_id) ? { changes: changes.get(p.asset_id)! } : {}),
      };
      for (const i of sipInstalments(
        plan,
        new Date(`${anchor}T00:00:00Z`),
        new Date(`${today}T00:00:00Z`),
      )) {
        // the price of the day, or the last one before it; an instalment with no price yet is left out until there is one
        const n = [...series].reverse().find((x) => x.date <= i.date);
        if (n && n.nav > 0)
          wanted.set(`est:${i.date}`, {
            date: i.date,
            amount: i.amount,
            nav: n.nav,
            units: Math.round((i.amount / n.nav) * 10_000) / 10_000,
          });
      }
    }
    const stale = have.filter((t) => {
      const w = wanted.get(t.source_ref);
      return !w || Number(t.amount) !== w.amount;
    });
    if (stale.length > 0) {
      const r = await db
        .from('mf_transactions')
        .delete()
        .in(
          'id',
          stale.map((t) => t.id),
        );
      if (r.error) throw new Error(`drop estimates: ${r.error.message}`);
      report.removed += stale.length;
    }
    const kept = new Set(have.filter((t) => !stale.includes(t)).map((t) => t.source_ref));
    const add = [...wanted.entries()]
      .filter(([ref]) => !kept.has(ref))
      .map(([ref, w]) => ({
        household_id: p.household_id,
        asset_id: p.asset_id,
        txn_on: w.date,
        kind: 'sip',
        amount: w.amount,
        units: w.units,
        nav: w.nav,
        description: ESTIMATED_TXN_NOTE,
        source: 'estimate',
        source_ref: ref,
      }));
    if (add.length > 0) {
      const r = await db.from('mf_transactions').upsert(add, { onConflict: 'asset_id,source_ref' });
      if (r.error) throw new Error(`save estimates: ${r.error.message}`);
      report.added += add.length;
    }
    if (add.length > 0 || stale.length > 0 || have.length > 0) report.funds++;
  }
  return report;
}
