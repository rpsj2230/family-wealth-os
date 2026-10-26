/**
 * Shared data loading for the web app and the scheduled jobs. The Supabase client decides what is visible:
 * a signed-in user's client sees only their household (Row Level Security); the service-role client used by jobs
 * must be scoped explicitly with `householdId`.
 */
import {
  buildPortfolio,
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
}

export const todayDate = () => new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');

/** `householdId` is required for service-role clients (which bypass Row Level Security) and harmless for user clients. */
interface PositionRow {
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
  const [owners, assets, observations, fds, positions] = await Promise.all([
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
      'asset_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount, fd_ref_last4',
    ),
    sel('mf_positions', 'asset_id, amfi_code, sip_monthly, sip_stopped, started_on'),
  ]);
  const today = opts.today ?? todayDate();
  const code = new Map(
    ((positions.data ?? []) as unknown as PositionRow[]).map((p) => [
      p.asset_id,
      p.amfi_code ?? null,
    ]),
  );
  const sip = new Map(
    ((positions.data ?? []) as unknown as PositionRow[])
      .filter((p) => p.sip_monthly && p.started_on)
      .map((p) => [
        p.asset_id,
        {
          monthly: Number(p.sip_monthly),
          startedOn: p.started_on as string,
          stopped: p.sip_stopped,
        },
      ]),
  );
  const assetRows = ((assets.data ?? []) as unknown as AssetRow[]).map((a) => ({
    ...a,
    amfi_code: code.get(a.id) ?? null,
    sip: sip.get(a.id) ?? null,
  }));
  const obsRows = (observations.data ?? []) as unknown as ObservationRow[];
  const fdRows = (fds.data ?? []) as unknown as FdRow[];
  const ownerName = new Map(
    ((owners.data ?? []) as unknown as { id: string; display_name: string }[]).map((o) => [
      o.id,
      o.display_name,
    ]),
  );

  // Public market data for what the household holds. Failure only means "no market movement shown".
  const { config } = await loadSettings(supabase, opts.householdId);
  const market: PortfolioDefaults = {
    savingsRate: config.estimates.savingsRate,
    tdsRate: config.estimates.interestTdsRate,
    includeSip: config.estimates.includeSip,
    freshnessDays: config.estimates.freshnessDays,
  };
  const marketDates: LoadedPortfolio['marketDates'] = { navLatest: null, fx: {} };
  try {
    const codes = [...new Set(assetRows.map((a) => a.amfi_code).filter((c): c is string => !!c))];
    const earliest = obsRows.reduce<string>(
      (m, o) => (o.as_of < m ? o.as_of : m),
      today.toISOString().slice(0, 10),
    );
    const since = new Date(earliest + 'T00:00:00Z');
    since.setUTCDate(since.getUTCDate() - 10);
    const sinceIso = since.toISOString().slice(0, 10);
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
    const currencies = [...new Set(assetRows.map((a) => a.currency).filter((c) => c !== 'INR'))];
    const fx: Record<string, number> = {};
    await Promise.all(
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
    market.fxToday = fx;
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
  };
}
export * from './digest-input';
export * from './harvest';

export * from './settings';
export * from './rates';
export * from './handbook';
export * from './liquidity';
export * from './filing';
