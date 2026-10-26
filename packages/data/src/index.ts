/**
 * Shared data loading for the web app and the scheduled jobs. The Supabase client decides what is visible:
 * a signed-in user's client sees only their household (Row Level Security); the service-role client used by jobs
 * must be scoped explicitly with `householdId`.
 */
import {
  buildPortfolio,
  lastNavMove,
  rateOfferFromRow,
  savingsRateFor,
  type AssetRow,
  type FdRow,
  type ObservationRow,
  type Portfolio,
  type PortfolioDefaults,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadSettings } from './settings';

export interface LoadedPortfolio {
  today: Date;
  assetRows: AssetRow[];
  obsRows: ObservationRow[];
  fdRows: FdRow[];
  ownerName: Map<string, string>;
  portfolio: Portfolio;
  marketDates: { navLatest: string | null; fx: Record<string, { rate: number; date: string }> };
  /** units held (when known) and the latest price, by fund */
  fundInfo: Record<
    string,
    { units: number | null; unitsAsOf: string | null; nav: number | null; navDate: string | null }
  >;
  /** how each fund's price moved between its last two prices, by asset */
  fundDay: Record<string, { pct: number; from: string; to: string }>;
}

export const todayDate = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

/** `householdId` is required for service-role clients (which bypass Row Level Security) and harmless for user clients. */
interface PositionRow {
  units: number | null;
  units_as_of: string | null;
  asset_id: string;
  amfi_code: string | null;
  sip_monthly: number | null;
  sip_stopped: boolean;
  started_on: string | null;
}

export async function loadPortfolioData(
  supabase: SupabaseClient,
  opts: { householdId?: string; today?: Date } = {},
): Promise<LoadedPortfolio> {
  const sel = (table: string, cols: string) => {
    const q = supabase.from(table).select(cols);
    return opts.householdId ? q.eq('household_id', opts.householdId) : q;
  };
  // settings are read in step with the first batch, not after it
  const settingsP = loadSettings(supabase, opts.householdId);
  const [owners, assets, observations, fds, positions, institutions, offerRows, sipChangeRows] =
    await Promise.all([
      sel('owners', 'id, display_name'),
      sel(
        'assets',
        'id, owner_id, type, status, nickname, currency, account_kind, expected_freshness_days, interest_rate, tds_rate, institution_id, identifier_last4, holder_name, label, sort_order, is_joint, linked_last4, notes',
      ),
      sel(
        'observations',
        'id, asset_id, kind, amount, currency, fx_rate, as_of, confidence, source, created_at, superseded_by',
      ),
      sel(
        'fixed_deposits',
        'asset_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount, fd_ref_last4, fd_ref',
      ),
      sel(
        'mf_positions',
        'asset_id, amfi_code, sip_monthly, sip_stopped, started_on, units, units_as_of',
      ),
      sel('institutions', 'id, name'),
      sel(
        'rate_offers',
        'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to',
      ).eq('product', 'savings'),
      sel('mf_sip_changes', 'asset_id, effective_on, monthly').order('effective_on'),
    ]);
  const today = opts.today ?? todayDate();
  const code = new Map(
    ((positions.data ?? []) as unknown as PositionRow[]).map((p) => [
      p.asset_id,
      p.amfi_code ?? null,
    ]),
  );
  const units = new Map(
    ((positions.data ?? []) as unknown as PositionRow[]).map((p) => [
      p.asset_id,
      { units: p.units === null ? null : Number(p.units), asOf: p.units_as_of },
    ]),
  );
  // dated changes of each SIP's amount (0 = stopped from that date), so changing the amount never rewrites past instalments
  const sipChanges = new Map<string, { from: string; monthly: number }[]>();
  for (const c of (sipChangeRows.data ?? []) as unknown as {
    asset_id: string;
    effective_on: string;
    monthly: number;
  }[])
    sipChanges.set(c.asset_id, [
      ...(sipChanges.get(c.asset_id) ?? []),
      { from: c.effective_on, monthly: Number(c.monthly) },
    ]);
  const sip = new Map(
    ((positions.data ?? []) as unknown as PositionRow[])
      .filter((p) => p.sip_monthly && p.started_on)
      .map((p) => [
        p.asset_id,
        {
          monthly: Number(p.sip_monthly),
          startedOn: p.started_on as string,
          stopped: p.sip_stopped,
          ...(sipChanges.has(p.asset_id) ? { changes: sipChanges.get(p.asset_id)! } : {}),
        },
      ]),
  );
  const obsRows = (observations.data ?? []) as unknown as ObservationRow[];
  // a savings account with no rate of its own earns what the rate list says for its bank, kind and balance slab
  const bankName = new Map(
    ((institutions.data ?? []) as unknown as { id: string; name: string }[]).map((i) => [
      i.id,
      i.name,
    ]),
  );
  const savingsOffers = ((offerRows.data ?? []) as unknown as Record<string, unknown>[]).map(
    rateOfferFromRow,
  );
  const lastBalance = new Map<string, { asOf: string; amount: number }>();
  for (const o of obsRows) {
    if (o.superseded_by) continue;
    const cur = lastBalance.get(o.asset_id);
    if (!cur || o.as_of > cur.asOf)
      lastBalance.set(o.asset_id, { asOf: o.as_of, amount: o.amount });
  }
  const listedRate = (a: AssetRow): number | null => {
    if (a.type !== 'bank_account' || a.currency !== 'INR' || (a.interest_rate ?? null) !== null)
      return null;
    const bank = a.institution_id ? bankName.get(a.institution_id) : undefined;
    if (!bank) return null;
    const kind = a.account_kind === 'NRE' || a.account_kind === 'NRO' ? a.account_kind : null;
    return (
      savingsRateFor(savingsOffers, bank, kind, Math.max(0, lastBalance.get(a.id)?.amount ?? 0))
        ?.rate ?? null
    );
  };
  const assetRows = ((assets.data ?? []) as unknown as AssetRow[]).map((a) => ({
    ...a,
    amfi_code: code.get(a.id) ?? null,
    units: units.get(a.id)?.units ?? null,
    units_as_of: units.get(a.id)?.asOf ?? null,
    sip: sip.get(a.id) ?? null,
    listed_rate: listedRate(a),
  }));
  const fdRows = (fds.data ?? []) as unknown as FdRow[];
  const ownerName = new Map(
    ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map((o) => [
      o.id,
      o.display_name,
    ]),
  );

  // Public market data for what the household holds. Failure only means "no market movement shown".
  const { config } = await settingsP;
  const market: PortfolioDefaults = {
    savingsRate: config.estimates.savingsRate,
    tdsRate: config.estimates.interestTdsRate,
    includeSip: config.estimates.includeSip,
    freshnessDays: config.estimates.freshnessDays,
  };
  const marketDates: LoadedPortfolio['marketDates'] = { navLatest: null, fx: {} };
  const fundDay: LoadedPortfolio['fundDay'] = {};
  const fundInfo: LoadedPortfolio['fundInfo'] = {};
  try {
    const codes = [...new Set(assetRows.map((a) => a.amfi_code).filter((c): c is string => !!c))];
    const earliest = obsRows.reduce<string>(
      (m, o) => (o.as_of < m ? o.as_of : m),
      today.toISOString().slice(0, 10),
    );
    const since = new Date(earliest + 'T00:00:00Z');
    since.setUTCDate(since.getUTCDate() - 10);
    const sinceIso = since.toISOString().slice(0, 10);
    const currencies = [...new Set(assetRows.map((a) => a.currency).filter((c) => c !== 'INR'))];
    const fx: Record<string, number> = {};
    const fxP = Promise.all(
      currencies.map(async (c) => {
        const r = await supabase
          .from('fx_rates')
          .select('inr_per_unit, rate_date')
          .eq('currency', c)
          .order('rate_date', { ascending: false })
          .limit(1);
        const row = r.data?.[0];
        if (row?.inr_per_unit) {
          fx[c] = Number(row.inr_per_unit);
          marketDates.fx[c] = { rate: Number(row.inr_per_unit), date: row.rate_date as string };
        }
      }),
    );
    const navs = await Promise.all(
      codes.map(async (c) => {
        const r = await supabase
          .from('mf_navs')
          .select('nav_date, nav')
          .eq('amfi_code', c)
          .gte('nav_date', sinceIso)
          .order('nav_date', { ascending: true })
          .limit(1000);
        return [
          c,
          (r.data ?? []).map((x) => ({ date: x.nav_date as string, nav: Number(x.nav) })),
        ] as const;
      }),
    );
    market.navs = Object.fromEntries(navs.filter(([, v]) => v.length > 0));
    for (const series of Object.values(market.navs)) {
      const d = series[series.length - 1]!.date;
      if (!marketDates.navLatest || d > marketDates.navLatest) marketDates.navLatest = d;
    }
    await fxP;
    market.fxToday = fx;
    for (const a of assetRows) {
      const move = a.amfi_code && market.navs ? lastNavMove(market.navs[a.amfi_code] ?? []) : null;
      if (move) fundDay[a.id] = move;
      const series = a.amfi_code && market.navs ? (market.navs[a.amfi_code] ?? []) : [];
      const latest = series[series.length - 1];
      const pos = ((positions.data ?? []) as unknown as PositionRow[]).find(
        (x) => x.asset_id === a.id,
      );
      if (pos)
        fundInfo[a.id] = {
          units: pos.units === null ? null : Number(pos.units),
          unitsAsOf: pos.units_as_of,
          nav: latest?.nav ?? null,
          navDate: latest?.date ?? null,
        };
    }
  } catch {
    // market data is optional
  }
  return {
    today,
    assetRows,
    obsRows,
    fdRows,
    ownerName,
    portfolio: buildPortfolio(assetRows, obsRows, fdRows, today, market),
    marketDates,
    fundDay,
    fundInfo,
  };
}
export * from './digest-input';
export * from './harvest';
export * from './sip-estimates';

export * from './settings';
export * from './rates';
export * from './handbook';
export * from './liquidity';
export * from './filing';
export * from './cas';
export * from './gains';
export * from './taxfiles';
export * from './fund-snapshots';
export * from './paging';
