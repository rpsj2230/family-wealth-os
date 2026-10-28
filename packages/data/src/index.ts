/**
 * Shared data loading for the web app and the scheduled jobs. The Supabase client decides what is visible:
 * a signed-in user's client sees only their household (Row Level Security); the service-role client used by jobs
 * must be scoped explicitly with `householdId`.
 */
import {
  buildPortfolio,
  lastNavMove,
  addDaysIso,
  planLedger,
  rateOfferFromRow,
  savingsRateFor,
  type AssetRow,
  type FdRow,
  type ObservationRow,
  type Portfolio,
  type PortfolioDefaults,
} from '@fwos/core';
import { HIST_FUND_REF } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadNavHistory } from './nav-history';
import { pageAll } from './paging';
import { loadSettings } from './settings';

export interface LoadedPortfolio {
  today: Date;
  assetRows: AssetRow[];
  obsRows: ObservationRow[];
  /** a fund's value copied from the monthly sheet: kept only to check against, never a valuation; the history engine uses it as a last resort */
  sheetObs: ObservationRow[];
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
  /** Settings: a deposit matured longer ago than this many days is hidden from the lists */
  hideMaturedAfterDays: number;
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
  invested: number | null;
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
  const [owners, assets, obsRowsRead, fds, positions, institutions, offerRows, sipChangeRows] =
    await Promise.all([
      sel('owners', 'id, display_name'),
      sel(
        'assets',
        'id, owner_id, type, status, nickname, currency, account_kind, expected_freshness_days, interest_rate, tds_rate, institution_id, identifier_last4, holder_name, label, sort_order, is_joint, linked_last4, notes',
      ),
      // the API returns at most 1,000 rows a request: years of monthly values for many accounts need several, in a fixed order
      pageAll<ObservationRow>((from, to) =>
        sel(
          'observations',
          'id, asset_id, kind, amount, currency, fx_rate, as_of, confidence, source, created_at, superseded_by, source_ref',
        )
          // a fund's value copied from the monthly sheet is kept only to check against; it is never a valuation
          .order('as_of', { ascending: true })
          .order('id')
          .range(from, to),
      ),
      sel(
        'fixed_deposits',
        'asset_id, principal, rate, booked_on, maturity_on, compounding, bank_maturity_amount, fd_ref_last4, fd_ref, ended_on, ended_estimated, start_estimated',
      ),
      sel(
        'mf_positions',
        'asset_id, amfi_code, sip_monthly, sip_stopped, started_on, units, units_as_of, invested',
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
  // a fund's value copied from the monthly sheet is kept only to check against: it is never a valuation
  const isSheet = (o: ObservationRow) =>
    ((o as { source_ref?: string | null }).source_ref ?? '').startsWith(HIST_FUND_REF);
  const obsRows = obsRowsRead.filter((o) => !isSheet(o));
  const sheetObs = obsRowsRead.filter(isSheet);
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
  const todayIso0 = today.toISOString().slice(0, 10);
  // A fund with no unit count (nothing was counted, no statement was read) has its units rebuilt from the plan the household gave: the
  // start date, the amount invested and the SIP with its changes, each instalment bought at the price of its day. One function (core
  // fund-plan.ts) shared with the position engine, so today's value here and the value on any past day agree. A counted unit count or
  // a statement replaces them. Prices are public and read once (nav-history.ts); without them the fund is valued from its last record.
  const planUnits = new Map<string, number>();
  try {
    const startedOf = new Map(
      ((positions.data ?? []) as unknown as PositionRow[]).map((p) => [p.asset_id, p]),
    );
    const wants = assetRows.flatMap((a) => {
      const p = startedOf.get(a.id);
      return a.type === 'mutual_fund' &&
        a.status !== 'gifted' &&
        a.currency === 'INR' &&
        a.amfi_code &&
        !(typeof a.units === 'number' && a.units > 0) &&
        p?.started_on
        ? [{ a, p, from: addDaysIso(p.started_on, -config.funds.navGapDays) }]
        : [];
    });
    if (wants.length > 0) {
      const hist = await loadNavHistory(
        supabase,
        wants.map((w) => ({ code: w.a.amfi_code!, from: w.from })),
      );
      for (const { a, p } of wants) {
        const dates = [...obsRows, ...sheetObs]
          .filter((o) => o.asset_id === a.id && !o.superseded_by)
          .map((o) => o.as_of)
          .sort();
        const pl = planLedger(
          {
            startedOn: p.started_on,
            invested: p.invested === null ? null : Number(p.invested),
            investedAsOf: dates.pop() ?? null,
            sip: a.sip ?? null,
          },
          hist.get(a.amfi_code!) ?? [],
          todayIso0,
          {
            gapDays: config.funds.navGapDays,
            tolerance: config.funds.planTolerance,
            includeSip: config.estimates.includeSip,
          },
        );
        if (pl && pl.units > 0) {
          planUnits.set(a.id, pl.units);
          a.units = pl.units;
          a.units_as_of = todayIso0;
          a.units_source = 'plan';
        }
      }
    }
  } catch {
    // prices are optional: the fund is valued from its last record
  }
  const market: PortfolioDefaults = {
    savingsRate: config.estimates.savingsRate,
    tdsRate: config.estimates.interestTdsRate,
    includeSip: config.estimates.includeSip,
    freshnessDays: config.estimates.freshnessDays,
    fdRateGap: config.estimates.observedRateGap,
  };
  const marketDates: LoadedPortfolio['marketDates'] = { navLatest: null, fx: {} };
  const fundDay: LoadedPortfolio['fundDay'] = {};
  const fundInfo: LoadedPortfolio['fundInfo'] = {};
  try {
    const codes = [...new Set(assetRows.map((a) => a.amfi_code).filter((c): c is string => !!c))];
    const todayIso = today.toISOString().slice(0, 10);
    // prices are needed from a little before the fund's latest recorded value or unit count (the value is rolled forward from there)
    const lastObsOn = new Map<string, string>();
    for (const o of obsRows)
      if (!o.superseded_by && o.as_of > (lastObsOn.get(o.asset_id) ?? ''))
        lastObsOn.set(o.asset_id, o.as_of);
    const sinceOf = new Map<string, string>();
    for (const a of assetRows) {
      if (!a.amfi_code) continue;
      const from = [lastObsOn.get(a.id), a.units_as_of ?? undefined]
        .filter((x): x is string => !!x)
        .sort()[0];
      const cur = sinceOf.get(a.amfi_code) ?? todayIso;
      sinceOf.set(a.amfi_code, (from ?? todayIso) < cur ? (from ?? todayIso) : cur);
    }
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
        const since = new Date(`${sinceOf.get(c) ?? todayIso}T00:00:00Z`);
        since.setUTCDate(since.getUTCDate() - 10);
        // read in pages: a plain limit would return the OLDEST 1,000 prices and leave the latest one out
        const rows = await pageAll<{ nav_date: string; nav: number }>((from, to) =>
          supabase
            .from('mf_navs')
            .select('nav_date, nav')
            .eq('amfi_code', c)
            .gte('nav_date', since.toISOString().slice(0, 10))
            .order('nav_date', { ascending: true })
            .range(from, to),
        );
        return [c, rows.map((x) => ({ date: x.nav_date, nav: Number(x.nav) }))] as const;
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
          units: planUnits.get(a.id) ?? (pos.units === null ? null : Number(pos.units)),
          unitsAsOf: planUnits.has(a.id) ? todayIso0 : pos.units_as_of,
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
    sheetObs,
    fdRows,
    ownerName,
    portfolio: buildPortfolio(assetRows, obsRows, fdRows, today, market),
    hideMaturedAfterDays: config.deposits.hideMaturedAfterDays,
    marketDates,
    fundDay,
    fundInfo,
  };
}
export * from './digest-input';
export * from './nav-history';
export * from './harvest';
export * from './columns';
export * from './sip-estimates';
export * from './rate-sync';

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
export * from './ai-keys';
export * from './history';
export * from './position';
export * from './snapshots';
