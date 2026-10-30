/**
 * Shared data loading for the web app and the scheduled jobs. The Supabase client decides what is visible:
 * a signed-in user's client sees only their household (Row Level Security); the service-role client used by jobs
 * must be scoped explicitly with `householdId`.
 */
import {
  buildPortfolio,
  creditEvery,
  isEstimatedTxn,
  lastNavMove,
  mergeSavingsTxns,
  sipDebits,
  addDaysIso,
  planLedger,
  posFundFrom,
  rateOfferFromRow,
  savingsRateFor,
  type AssetRow,
  type FdRow,
  type ObservationRow,
  type PosFund,
  type Portfolio,
  type PortfolioDefaults,
  type ValuationExtras,
} from '@fwos/core';
import { HIST_FUND_REF } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { columnExists, liveLinesFilter } from './columns';
import {
  loadMoneyMoves,
  loadSavingsSchedules,
  placementsOf,
  savingsMovesOf,
  type MoneyMove,
} from './ledger';
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
  /** each bank's name, by institution id */
  institutionName?: Map<string, string>;
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
  /**
   * What the central engine was given beyond the rows (fund ledgers and statement values, savings movements and rates by date, where
   * maturity proceeds went), so the history (loadPositionInput) is built from exactly the same input as today's figures.
   */
  engine: {
    extras: ValuationExtras;
    fundLines: Map<string, Record<string, unknown>[]>;
    fundSnaps: Map<string, { date: string; value: number }[]>;
    moves: MoneyMove[];
  };
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
  /** the savings account the SIP is paid from (when the column is there) */
  sip_from_asset_id?: string | null;
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
  // the account a SIP is paid from is a newer column: a deploy can reach the app before the database has it
  const sipFromCol = await columnExists(supabase, 'mf_positions', 'sip_from_asset_id');
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
        'asset_id, principal, rate, booked_on, maturity_on, compounding, payout, renewed_from, bank_maturity_amount, fd_ref_last4, fd_ref, ended_on, ended_estimated, start_estimated',
      ),
      sel(
        'mf_positions',
        `asset_id, amfi_code, sip_monthly, sip_stopped, started_on, units, units_as_of, invested${sipFromCol ? ', sip_from_asset_id' : ''}`,
      ),
      sel('institutions', 'id, name'),
      sel(
        'rate_offers',
        'id, bank, product, account_kind, tenure_from_months, tenure_to_months, rate, conditions, source_kind, checked_on, balance_from, balance_to',
      ).eq('product', 'savings'),
      sel('mf_sip_changes', 'asset_id, effective_on, monthly').order('effective_on'),
    ]);
  // a record joined into another (the same holding entered twice) is history only: it is in no figure, on any day
  const mergedIds = new Set(
    ((assets.data ?? []) as unknown as { id: string; status: string }[])
      .filter((a) => a.status === 'merged')
      .map((a) => a.id),
  );
  const kept = <T extends { asset_id: string }>(rows: T[]): T[] =>
    mergedIds.size ? rows.filter((r) => !mergedIds.has(r.asset_id)) : rows;
  if (mergedIds.size) {
    assets.data = (assets.data ?? []).filter(
      (a) => !mergedIds.has((a as unknown as { id: string }).id),
    );
    positions.data = kept((positions.data ?? []) as unknown as PositionRow[]) as never;
    fds.data = kept((fds.data ?? []) as unknown as FdRow[]) as never;
    sipChangeRows.data = kept(
      (sipChangeRows.data ?? []) as unknown as { asset_id: string }[],
    ) as never;
  }
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
  const obsRows = kept(obsRowsRead).filter((o) => !isSheet(o));
  const sheetObs = kept(obsRowsRead).filter(isSheet);
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
  const planPrior = new Map<
    string,
    { units: number | null; asOf: string | null; source: 'plan' | null }
  >();
  const planNavs = new Map<string, { date: string; nav: number }[]>();
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
      for (const [code, rows] of hist) planNavs.set(code, rows);
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
          planPrior.set(a.id, {
            units: a.units ?? null,
            asOf: a.units_as_of ?? null,
            source: a.units_source ?? null,
          });
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
    notCounted: config.capital.countProperty ? [] : ['property'],
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
  // the funds as the engine reads them: every ledger line a statement has not replaced, the statement values, the plan, and the prices
  // read above (the plan's full history where the units are rebuilt from it, else from a little before the last value)
  const fundIds = assetRows.filter((a) => a.type === 'mutual_fund').map((a) => a.id);
  const fundLines = new Map<string, Record<string, unknown>[]>();
  const fundSnaps = new Map<string, { date: string; value: number }[]>();
  const funds: Record<string, PosFund> = {};
  const [moves, rates] = await Promise.all([
    loadMoneyMoves(supabase, opts.householdId),
    loadSavingsSchedules(supabase, assetRows, config, opts.householdId).catch(() => ({})),
  ]);
  if (fundIds.length > 0) {
    const live = await liveLinesFilter(supabase);
    const [lines, snaps] = await Promise.all([
      pageAll<Record<string, unknown>>((from, to) =>
        sel(
          'mf_transactions',
          'id, asset_id, txn_on, kind, units, amount, nav, balance_units, description, source',
        )
          .or(live)
          .order('txn_on')
          .order('id')
          .range(from, to),
      ).catch(() => [] as Record<string, unknown>[]),
      pageAll<Record<string, unknown>>((from, to) =>
        sel('mf_snapshots', 'asset_id, as_of, value').order('as_of').range(from, to),
      ).catch(() => [] as Record<string, unknown>[]),
    ]);
    for (const l of lines) {
      const id = l.asset_id as string;
      (fundLines.get(id) ?? fundLines.set(id, []).get(id)!).push(l);
    }
    // statement lines replace the plan: a fund with real lines never shows units rebuilt from its plan as the units it records
    for (const [id, prior] of planPrior) {
      const real = (fundLines.get(id) ?? []).some(
        (l) => !isEstimatedTxn({ description: (l.description as string | null) ?? null }),
      );
      if (!real) continue;
      planUnits.delete(id);
      const a = assetRows.find((x) => x.id === id);
      if (a) {
        a.units = prior.units;
        a.units_as_of = prior.asOf;
        a.units_source = prior.source;
      }
      const pos = ((positions.data ?? []) as unknown as PositionRow[]).find(
        (x) => x.asset_id === id,
      );
      const info = fundInfo[id];
      if (info && pos) {
        info.units = pos.units === null ? null : Number(pos.units);
        info.unitsAsOf = pos.units_as_of;
      }
    }
    for (const x of snaps) {
      const id = x.asset_id as string;
      (fundSnaps.get(id) ?? fundSnaps.set(id, []).get(id)!).push({
        date: x.as_of as string,
        value: Number(x.value),
      });
    }
    const posOf = new Map(
      ((positions.data ?? []) as unknown as PositionRow[]).map((p) => [p.asset_id, p]),
    );
    for (const a of assetRows) {
      if (a.type !== 'mutual_fund') continue;
      const p = posOf.get(a.id);
      const navs = mergeNavs(
        planNavs.get(a.amfi_code ?? '') ?? [],
        (a.amfi_code && market.navs?.[a.amfi_code]) || [],
      );
      funds[a.id] = posFundFrom({
        lines: (fundLines.get(a.id) ?? []).map((l) => ({
          date: l.txn_on as string,
          kind: (l.kind as string | null) ?? null,
          units: Number(l.units),
          amount: Number(l.amount),
          nav: l.nav === null ? null : Number(l.nav),
          balance: l.balance_units === null ? null : Number(l.balance_units),
          source: (l.source as string | null) ?? null,
          description: (l.description as string | null) ?? null,
        })),
        navs,
        units:
          a.units !== null && a.units !== undefined && a.units_as_of && a.units_source !== 'plan'
            ? { units: a.units, asOf: a.units_as_of }
            : null,
        snapshots: fundSnaps.get(a.id) ?? [],
        plan: p
          ? {
              invested: Number(p.invested ?? 0),
              startedOn: p.started_on ?? null,
              sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
              sipStopped: !!p.sip_stopped,
            }
          : null,
        sip: a.sip ?? null,
        today: todayIso0,
        unitTolerance: config.funds.unitTolerance,
      });
    }
  }
  const accountIds = new Set(assetRows.filter((a) => a.type === 'bank_account').map((a) => a.id));
  const depositIds = new Set(assetRows.filter((a) => a.type === 'fixed_deposit').map((a) => a.id));
  const extras: ValuationExtras = {
    funds,
    // a SIP paid from a savings account takes each instalment out of that account's estimated balance
    moves: mergeSavingsTxns(
      savingsMovesOf(moves, accountIds),
      sipDebits(
        ((positions.data ?? []) as unknown as PositionRow[]).flatMap((p) => {
          const fund = assetRows.find((a) => a.id === p.asset_id);
          const plan = sip.get(p.asset_id);
          return p.sip_from_asset_id &&
            accountIds.has(p.sip_from_asset_id) &&
            plan &&
            fund &&
            (fund.status === 'active' || fund.status === 'stopped')
            ? [{ fundId: p.asset_id, accountId: p.sip_from_asset_id, plan }]
            : [];
        }),
        moves
          .filter((m) => m.status === 'confirmed')
          .map((m) => ({
            date: m.movedOn,
            amount: m.amount,
            fromAssetId: m.fromAssetId,
            toAssetId: m.toAssetId,
          })),
        todayIso0,
      ),
    ),
    rates,
    placements: placementsOf(moves, depositIds),
    config: {
      navGapDays: config.funds.navGapDays,
      planTolerance: config.funds.planTolerance,
      growth: {
        property: config.estimates.assumedGrowthProperty,
        retirement: config.estimates.assumedGrowthRetirement,
        other: config.estimates.assumedGrowthOther,
      },
      hideMaturedAfterDays: config.deposits.hideMaturedAfterDays,
      savingsCredit: creditEvery(config.estimates.savingsCreditMonths),
      slabMethod: config.estimates.savingsSlabIncremental ? 'incremental' : 'whole',
    },
  };
  return {
    today,
    assetRows,
    obsRows,
    sheetObs,
    fdRows,
    ownerName,
    institutionName: bankName,
    // the sheet's fund values go in as such: never a valuation, only the last resort and the date a plan's amount invested was recorded
    portfolio: buildPortfolio(assetRows, [...obsRows, ...sheetObs], fdRows, today, market, extras),
    hideMaturedAfterDays: config.deposits.hideMaturedAfterDays,
    marketDates,
    fundDay,
    fundInfo,
    engine: { extras, fundLines, fundSnaps, moves },
  };
}

/** Two price lists of one fund as one, oldest first, one price a day. */
function mergeNavs(
  a: { date: string; nav: number }[],
  b: { date: string; nav: number }[],
): { date: string; nav: number }[] {
  const by = new Map<string, number>();
  for (const n of a) by.set(n.date, n.nav);
  for (const n of b) by.set(n.date, n.nav);
  return [...by.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, nav]) => ({ date, nav }));
}
export * from './digest-input';
export * from './nav-history';
export * from './harvest';
export * from './columns';
export * from './price-source';
export * from './sip-estimates';
export * from './rate-sync';
export * from './ledger';

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
export * from './daily-valuation';
export * from './statement-store';
export * from './statement-rebuild';
export * from './statement-save';
export * from './bank-statement-mail';
export * from './remittance-store';
export * from './trail-store';
export * from './needed-store';
export * from './household-client';
export * from './inactivity';
