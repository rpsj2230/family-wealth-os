import { buildBankBlocks, type AppConfig, type RateHolding, type RateOffer } from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadPortfolioData } from './index';
import { loadSettings } from './settings';

export interface RatesContext {
  offers: RateOffer[];
  holdings: RateHolding[];
  config: AppConfig;
  today: Date;
  ownerName: Map<string, string>;
  /** the usual savings rate, used as the "do nothing" comparison */
  baselineRate: number;
}

/** Rates on file plus what the household holds at each bank, in the shape the comparison needs. */
export async function loadRatesContext(
  db: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<RatesContext> {
  const scoped = (table: string, cols: string) => {
    const q = db.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  const [l, st, inst, offerRows, jointRows] = await Promise.all([
    loadPortfolioData(db, {
      ...(opts.householdId ? { householdId: opts.householdId } : {}),
      ...(opts.today ? { today: opts.today } : {}),
    }),
    loadSettings(db, opts.householdId),
    scoped('institutions', 'id, name'),
    scoped(
      'rate_offers',
      'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to, tenure_days, source_note, source_url',
    ).order('bank'),
    scoped('assets', 'id, joint_holder_id').not('joint_holder_id', 'is', null),
  ]);
  const jointHolder = new Map(
    ((jointRows.data ?? []) as unknown as { id: string; joint_holder_id: string }[]).map((j) => [
      j.id,
      j.joint_holder_id,
    ]),
  );
  const names = Object.fromEntries(
    ((inst.data ?? []) as unknown as { id: string; name: string }[]).map((i) => [i.id, i.name]),
  );
  const blocks = buildBankBlocks({
    assets: l.assetRows,
    observations: l.obsRows,
    fds: l.fdRows,
    portfolio: l.portfolio,
    institutionNames: names,
    today: l.today,
  });
  const ownRate = new Map(l.assetRows.map((a) => [a.id, a.interest_rate ?? null]));
  const holdings: RateHolding[] = [];
  for (const b of blocks) {
    for (const s of b.sections) {
      for (const r of s.rows) {
        if (
          r.kind === 'held' ||
          r.currency !== 'INR' ||
          r.status === 'closed' ||
          r.status === 'stopped' ||
          r.status === 'renewed'
        )
          continue;
        holdings.push({
          assetId: r.assetId,
          ownerId: r.ownerId,
          ownerName: l.ownerName.get(r.ownerId) ?? 'Owner',
          bank: b.name,
          product: r.kind === 'fd' ? 'fd' : 'savings',
          kind: r.accountKind,
          joint: r.joint,
          jointHolderId: r.joint ? (jointHolder.get(r.assetId) ?? null) : null,
          current: r.current ?? 0,
          rate: r.fd ? r.fd.rate : (ownRate.get(r.assetId) ?? st.config.estimates.savingsRate),
          maturityOn: r.fd?.maturityOn ?? null,
          needsConfirmation: !!r.fd?.needsConfirmation,
        });
      }
    }
  }
  const offers: RateOffer[] = ((offerRows.data ?? []) as unknown as Record<string, unknown>[]).map(
    (o) => ({
      id: o.id as string,
      bank: o.bank as string,
      product: o.product as 'savings' | 'fd',
      accountKind: o.account_kind as RateOffer['accountKind'],
      tenureFrom: Number(o.tenure_from_months),
      tenureTo: Number(o.tenure_to_months),
      rate: Number(o.rate),
      conditions: (o.conditions as string | null) ?? null,
      sourceKind: o.source_kind as 'manual' | 'ai',
      checkedOn: o.checked_on as string,
      balanceFrom:
        o.balance_from === null || o.balance_from === undefined ? null : Number(o.balance_from),
      balanceTo: o.balance_to === null || o.balance_to === undefined ? null : Number(o.balance_to),
      tenureDays: (o.tenure_days as number | null | undefined) ?? null,
      sourceNote: (o.source_note as string | null | undefined) ?? null,
      sourceUrl: (o.source_url as string | null | undefined) ?? null,
    }),
  );
  return {
    offers,
    holdings,
    config: st.config,
    today: l.today,
    ownerName: l.ownerName,
    baselineRate: st.config.estimates.savingsRate,
  };
}
