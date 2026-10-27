import {
  amcLabel,
  chartDates,
  combineSeries,
  estimateLots,
  fundCategory,
  fundTaxClass,
  effectiveRules,
  type AppConfig,
  type CategoryKey,
  type FundCategory,
  type FundRangeKey,
  type FundTaxClass,
  type LotsBasis,
  type StatLot,
  type StatRealised,
  type StatTxn,
  folioOfRef,
  isEstimateLine,
  ledgerCheck,
  ledgerSummary,
  openingFlow,
  orderLines,
  paceFromSeries,
  periodDates,
  projectCorpus,
  projectionPath,
  fundSeries,
  moveAmount,
  sourceTag,
  type SourceTag,
  returnsFor,
  flowsOfFund,
  perfDates,
  trailingTable,
  type Flow,
  type IndexPoint,
  type PeriodDef,
  type TrailingReturn,
  type FundForReturns,
  type FundTxn,
  type LedgerLine,
  type LedgerVerdict,
  type PersonLedgerSummary,
  type SeriesPoint,
  type TaxRuleSet,
} from '@fwos/core';
import { loadSettings, pageAll, type LoadedPortfolio } from '@fwos/data';
import type { CasTxn } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fundLedger } from './fund-ledger';
import { loadPortfolio } from './portfolio-data';
import type { Ctx } from './data';

export interface FundRow {
  assetId: string;
  ownerId: string;
  name: string;
  value: number;
  invested: number;
  startedOn: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** annual return from the transactions, or estimated from the start date and SIP when there is no statement */
  xirr: number | null;
  xirrEstimated: boolean;
  gain: number;
  /** how much the fund moved over its last two prices, in rupees and as a share */
  dayAmount: number | null;
  dayPct: number | null;
  dayFrom: string | null;
  dayTo: string | null;
  goalIds: string[];
  /** how today's value was worked out */
  valueBasis: string;
  units: number | null;
  nav: number | null;
  navDate: string | null;
  /** the official scheme this fund is matched to; null until the person confirms it */
  amfiCode: string | null;
  /** month by month: what the fund was worth and what had been put in */
  history: SeriesPoint[];
  /** when the value was last set, and by what */
  updatedOn: string | null;
  updatedSource: SourceTag;
  /** the same, for the range being looked at (every day, week or month end); equals `history` for 3 years and All */
  trend: SeriesPoint[];
  folioLast4: string | null;
  category: FundCategory;
  amc: string | null;
  taxClass: FundTaxClass;
  /** how the class was decided: its words, whether it is only a guess from the name, and the ELSS lock-in in months */
  taxInfo: { label: string; note: string; certain: boolean; lockInMonths: number };
  /** the name given on the Accounts side (empty when none), and the asset's status: active, or closed once sold */
  label: string | null;
  status: string;
  /** this fund's own exit load as a fraction and in days; null = the default in Settings */
  exitLoadPct: number | null;
  exitLoadDays: number | null;
  /** Direct or Regular plan, from the saved position (unknown until a statement or the scheme list says) */
  plan: 'direct' | 'regular' | 'unknown';
  /** the fund's own price return over each period, from its published prices; empty without a price history */
  navReturns: { def: PeriodDef; r: TrailingReturn | null }[];
  /** the fund valued on every month end, the start of each period and today: the input of the performance figures */
  perf: SeriesPoint[];
  /** the fund valued on each day the profit-by-period figures are measured on (see periodDates in core): a few points, not the history */
  periodPoints: SeriesPoint[];
  /** money in (positive) and out (negative), from the statement or, marked estimated, from the start date and SIP */
  flows: Flow[];
  flowsEstimated: boolean;
  /** transactions of a fund statement are on file */
  hasStatement: boolean;
  txns: StatTxn[];
  /** whether the transaction history adds up: the verdict the Investments page and the fund page show */
  ledger: LedgerVerdict;
  /** units still held by purchase, from the statement or (marked) estimated from the SIP plan and prices */
  lots: StatLot[];
  lotsBasis: LotsBasis;
  /** sales and the purchases they used, from the statement */
  realised: StatRealised[];
}

export interface Totals {
  funds: number;
  value: number;
  invested: number;
  gain: number;
  xirr: number | null;
  xirrEstimated: boolean;
  dayAmount: number;
  /** share of yesterday's value; null when no fund has a day move */
  dayPct: number | null;
  sipMonthly: number;
}

export interface OwnerGroup {
  ownerId: string;
  name: string;
  panLast4: string | null;
  funds: FundRow[];
  totals: Totals;
  series: SeriesPoint[];
  trend: SeriesPoint[];
  /** how many of the person's funds reconcile with their statements, and which need earlier history */
  ledger: PersonLedgerSummary;
}

export interface InvestmentView {
  today: string;
  groups: OwnerGroup[];
  household: Totals;
  /** all funds together, month by month */
  series: SeriesPoint[];
  /** all funds together for the range being looked at */
  trend: SeriesPoint[];
  range: FundRangeKey;
  /** the keys of every kind, house and fund the household holds, for stable colours */
  palette: { categories: CategoryKey[]; amcs: string[]; funds: string[] };
  /** months after which equity-fund units are long-term, from the tax rules in Settings; null when no rule is known */
  holdingMonths: number | null;
  config: AppConfig['funds'];
  /** the tax rules and harvest settings behind the exit-load and tax panel of a fund */
  tax: { rules: TaxRuleSet[]; harvest: AppConfig['harvest'] };
  goals: { id: string; name: string }[];
  /** the benchmark proxy: an index fund's published prices, when the daily job has loaded them */
  benchmark: { code: string; name: string | null; navs: IndexPoint[] } | null;
}

type Supabase = Ctx['supabase'];

/** In plain words, where today's value of a fund comes from. */
const basisText = (method: string | undefined) =>
  method === 'units_nav'
    ? 'units × live price'
    : method === 'units_nav_sip'
      ? 'units × live price + SIPs since'
      : method === 'nav_ratio' || method === 'nav_ratio_sip'
        ? 'last value moved with the live price'
        : 'last recorded value (no live price yet)';

function totalsOf(rows: FundRow[], forReturns: FundForReturns[], today: string): Totals {
  const r = returnsFor(forReturns, today);
  const value = rows.reduce((a, f) => a + f.value, 0);
  const invested = rows.reduce((a, f) => a + f.invested, 0);
  const withDay = rows.filter((f) => f.dayAmount !== null);
  const dayAmount = withDay.reduce((a, f) => a + (f.dayAmount ?? 0), 0);
  const prior = withDay.reduce((a, f) => a + f.value - (f.dayAmount ?? 0), 0);
  return {
    funds: rows.length,
    value,
    invested,
    gain: r.funds > 0 ? r.gain : value - invested,
    xirr: r.xirr,
    xirrEstimated: r.estimatedFunds > 0 || rows.some((f) => f.ledger.figuresEstimated),
    dayAmount,
    dayPct: withDay.length > 0 && prior > 0 ? dayAmount / prior : null,
    sipMonthly: rows.filter((f) => !f.sipStopped).reduce((a, f) => a + (f.sipMonthly ?? 0), 0),
  };
}

/** Everything the Investments page and the dashboard show about mutual funds. `loaded` avoids reading the portfolio twice. */
export async function loadInvestmentView(
  supabase: Supabase,
  loaded?: LoadedPortfolio,
  onlyOwner?: string | null,
  range: FundRangeKey = 'all',
): Promise<InvestmentView> {
  const l = loaded ?? (await loadPortfolio(supabase));
  const codes = [...new Set(l.assetRows.map((a) => a.amfi_code).filter((c): c is string => !!c))];
  const [pos, tx, obsAll, snaps, navAll, goals, allocs, owners, schemes, settings] =
    await Promise.all([
      supabase
        .from('mf_positions')
        .select(
          'asset_id, fund_name, invested, started_on, sip_monthly, sip_stopped, folio_last4, plan_type, exit_load_pct, exit_load_days',
        ),
      pageAll<{
        id: string;
        asset_id: string;
        txn_on: string;
        kind: CasTxn['kind'];
        units: number;
        amount: number;
        nav: number | null;
        balance_units: number | null;
        description: string | null;
        source: string | null;
        source_ref: string | null;
      }>((from, to) =>
        supabase
          .from('mf_transactions')
          .select(
            'id, asset_id, txn_on, kind, units, amount, nav, balance_units, description, source, source_ref',
          )
          .is('superseded_on', null)
          .order('txn_on')
          .order('id')
          .range(from, to),
      ),
      pageAll<{ asset_id: string; as_of: string; amount: number }>((from, to) =>
        supabase
          .from('observations')
          .select('asset_id, as_of, amount')
          .is('superseded_by', null)
          .in('kind', ['valuation', 'balance'])
          .order('as_of')
          .order('id')
          .range(from, to),
      ),
      pageAll<{ asset_id: string; as_of: string; value: number; invested: number | null }>(
        (from, to) =>
          supabase
            .from('mf_snapshots')
            .select('asset_id, as_of, value, invested')
            .order('as_of')
            .range(from, to),
      ),
      codes.length === 0
        ? Promise.resolve([] as { amfi_code: string; nav_date: string; nav: number }[])
        : pageAll<{ amfi_code: string; nav_date: string; nav: number }>((from, to) =>
            supabase
              .from('mf_navs')
              .select('amfi_code, nav_date, nav')
              .in('amfi_code', codes)
              .order('nav_date')
              .range(from, to),
          ),
      supabase.from('goals').select('id, name').order('name'),
      supabase.from('goal_allocations').select('goal_id, asset_id'),
      supabase.from('owners').select('id, display_name, pan_last4').order('created_at'),
      codes.length === 0
        ? Promise.resolve({ data: [] as unknown[] })
        : supabase.from('amfi_schemes').select('code, category, amc').in('code', codes),
      loadSettings(supabase as unknown as SupabaseClient),
    ]);
  const today = l.today.toISOString().slice(0, 10);
  const ownerOf = new Map(l.assetRows.map((a) => [a.id, a.owner_id]));
  const assetOf = new Map(l.assetRows.map((a) => [a.id, a]));
  const value = new Map(
    l.portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]),
  );
  const methodOf = new Map(l.portfolio.valued.map((v) => [v.assetId, v.estimate?.method] as const));
  const unitTol = settings.config.funds.unitTolerance;
  const txBy = new Map<string, FundTxn[]>();
  type Stored = CasTxn & { source: string | null; id: string; folio: string | null };
  const casBy = new Map<string, Stored[]>();
  for (const t of tx) {
    casBy.set(t.asset_id, [
      ...(casBy.get(t.asset_id) ?? []),
      {
        date: t.txn_on,
        kind: t.kind,
        description: t.description ?? '',
        amount: Number(t.amount),
        units: Number(t.units),
        nav: t.nav === null ? null : Number(t.nav),
        balance: t.balance_units === null ? null : Number(t.balance_units),
        source: t.source,
        id: t.id,
        folio: folioOfRef(t.source, t.source_ref),
      },
    ]);
  }
  // lines of one day have no time on them: the running balance puts them in the order they happened
  for (const [id, list] of casBy) {
    const ordered = orderLines(list, unitTol);
    casBy.set(id, ordered);
    txBy.set(
      id,
      ordered.map((t) => ({ date: t.date, units: t.units, amount: t.amount, kind: t.kind })),
    );
  }
  const schemeOf = new Map(
    (
      (schemes.data ?? []) as unknown as {
        code: string;
        category: string | null;
        amc: string | null;
      }[]
    ).map((x) => [x.code, x]),
  );
  const holdingMonths =
    effectiveRules(today, settings.rules)?.rules.equity.holdingMonthsLong ?? null;
  const goalsBy = new Map<string, string[]>();
  for (const a of (allocs.data ?? []) as unknown as { goal_id: string; asset_id: string }[])
    goalsBy.set(a.asset_id, [...(goalsBy.get(a.asset_id) ?? []), a.goal_id]);

  // the latest recorded value of each fund: its date and who or what recorded it
  const lastObs = new Map<string, { as_of: string; source: string }>();
  for (const o of l.obsRows)
    if (!o.superseded_by) {
      const cur = lastObs.get(o.asset_id);
      if (!cur || o.as_of > cur.as_of)
        lastObs.set(o.asset_id, { as_of: o.as_of, source: o.source });
    }
  const obsBy = new Map<string, { date: string; value: number }[]>();
  for (const o of obsAll)
    obsBy.set(o.asset_id, [
      ...(obsBy.get(o.asset_id) ?? []),
      { date: o.as_of, value: Number(o.amount) },
    ]);
  const snapBy = new Map<string, { date: string; value: number; invested: number | null }[]>();
  for (const x of snaps)
    snapBy.set(x.asset_id, [
      ...(snapBy.get(x.asset_id) ?? []),
      {
        date: x.as_of,
        value: Number(x.value),
        invested: x.invested === null ? null : Number(x.invested),
      },
    ]);
  const navBy = new Map<string, { date: string; nav: number }[]>();
  for (const n of navAll)
    navBy.set(n.amfi_code, [
      ...(navBy.get(n.amfi_code) ?? []),
      { date: n.nav_date, nav: Number(n.nav) },
    ]);
  // the benchmark proxy: the daily job fetches its prices like those of a held fund; until then there is none to show
  const benchCode = settings.config.funds.benchmarkCode;
  let benchmark: InvestmentView['benchmark'] = null;
  if (benchCode) {
    const rows = codes.includes(benchCode)
      ? (navBy.get(benchCode) ?? []).map((n) => ({ nav_date: n.date, nav: n.nav }))
      : await pageAll<{ nav_date: string; nav: number }>((from, to) =>
          supabase
            .from('mf_navs')
            .select('nav_date, nav')
            .eq('amfi_code', benchCode)
            .order('nav_date')
            .range(from, to),
        );
    if (rows.length >= 2) {
      const one = await supabase
        .from('amfi_schemes')
        .select('name')
        .eq('code', benchCode)
        .maybeSingle();
      benchmark = {
        code: benchCode,
        name: (one.data as { name?: string } | null)?.name ?? null,
        navs: rows.map((n) => ({ date: n.nav_date, value: Number(n.nav) })),
      };
    }
  }
  const codeOf = new Map(l.assetRows.map((a) => [a.id, a.amfi_code ?? null]));
  const forRet = new Map<string, FundForReturns>();
  const every: FundRow[] = [];
  for (const p of (pos.data ?? []) as unknown as {
    asset_id: string;
    fund_name: string;
    invested: number | null;
    started_on: string | null;
    sip_monthly: number | null;
    sip_stopped: boolean;
    folio_last4: string | null;
    plan_type: string | null;
    exit_load_pct: number | null;
    exit_load_days: number | null;
  }[]) {
    const ownerId = ownerOf.get(p.asset_id);
    if (!ownerId) continue;
    const v = value.get(p.asset_id) ?? 0;
    const invested = Number(p.invested ?? 0);
    const cas = casBy.get(p.asset_id) ?? [];
    const unitsHeld = l.fundInfo[p.asset_id]?.units ?? null;
    const ledger = fundLedger({
      txns: cas,
      costValue: invested || null,
      unitsHeld,
      unitTolerance: unitTol,
    });
    const hasReal = cas.some((c) => !isEstimateLine(c));
    // the cost of the units held according to the lines (not counting assumed instalments), when every purchase is on file
    const heldCost =
      ledger.reconciled && ledger.lots.every((x) => x.estimated || x.cost !== null)
        ? ledger.lots.filter((x) => !x.estimated).reduce((a, x) => a + (x.cost ?? 0), 0)
        : null;
    const verdict = ledgerCheck({
      lines: cas.map((c): LedgerLine => ({
        id: c.id,
        date: c.date,
        kind: c.kind,
        units: c.units,
        amount: c.amount,
        nav: c.nav,
        balance: c.balance,
        source: c.source,
        description: c.description,
        folio: c.folio,
      })),
      position: {
        units: unitsHeld,
        unitsAsOf: l.fundInfo[p.asset_id]?.unitsAsOf ?? null,
        invested,
        startedOn: p.started_on,
      },
      heldCost,
      tolerance: { units: unitTol, money: settings.config.funds.moneyTolerance },
      historyFrom: settings.config.funds.historyFrom,
    });
    // units held before the first line count as put in on that day at its price, so a return is never read as a gain on them
    const opening = openingFlow(cas, unitTol);
    const fr: FundForReturns = {
      assetId: p.asset_id,
      ownerId,
      name: p.fund_name,
      value: v,
      txns: [...(txBy.get(p.asset_id) ?? []), ...(opening ? [opening] : [])],
      plan: {
        invested,
        startedOn: p.started_on,
        sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
        sipStopped: p.sip_stopped,
      },
    };
    forRet.set(p.asset_id, fr);
    const r = returnsFor([fr], today);
    const move = l.fundDay[p.asset_id];
    const code = codeOf.get(p.asset_id) ?? null;
    const scheme = code ? schemeOf.get(code) : undefined;
    let lots: StatLot[] = ledger.reconciled ? ledger.lots : [];
    let lotsBasis: LotsBasis = lots.length > 0 ? 'statement' : 'none';
    if (!hasReal && code && p.started_on && invested > 0) {
      const est = estimateLots({
        plan: {
          invested,
          startedOn: p.started_on,
          sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
          sipStopped: p.sip_stopped,
        },
        navs: navBy.get(code) ?? [],
        today,
        unitsHeld,
        navGapDays: settings.config.funds.navGapDays,
      });
      if (est) {
        lots = est;
        lotsBasis = 'estimated';
      }
    }
    const history = fundSeries(
      {
        txns: txBy.get(p.asset_id) ?? [],
        navs: navBy.get(code ?? '') ?? [],
        observations: obsBy.get(p.asset_id) ?? [],
        snapshots: snapBy.get(p.asset_id) ?? [],
        plan: { invested, startedOn: p.started_on },
      },
      today,
      { value: v, invested },
    );
    const trend =
      range === 'all' || range === '3y'
        ? history
        : fundSeries(
            {
              txns: txBy.get(p.asset_id) ?? [],
              navs: navBy.get(code ?? '') ?? [],
              observations: obsBy.get(p.asset_id) ?? [],
              snapshots: snapBy.get(p.asset_id) ?? [],
              plan: { invested, startedOn: p.started_on },
            },
            today,
            { value: v, invested },
            chartDates(range, history[0]?.date ?? today, today),
          );
    const navLine = (navBy.get(code ?? '') ?? []).map((n) => ({ date: n.date, value: n.nav }));
    const fl = flowsOfFund({
      txns: cas.map((c) => ({
        date: c.date,
        units: c.units,
        amount: c.amount,
        nav: c.nav,
        balance: c.balance,
        kind: c.kind,
        source: c.source,
        description: c.description,
      })),
      plan: {
        invested,
        startedOn: p.started_on,
        sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
        sipStopped: p.sip_stopped,
      },
      today,
      unitTolerance: unitTol,
    });
    const firstDate = history[0]?.date;
    const perf = firstDate
      ? fundSeries(
          {
            txns: txBy.get(p.asset_id) ?? [],
            navs: navBy.get(code ?? '') ?? [],
            observations: obsBy.get(p.asset_id) ?? [],
            snapshots: snapBy.get(p.asset_id) ?? [],
            plan: { invested, startedOn: p.started_on },
          },
          today,
          { value: v, invested },
          perfDates(firstDate, today, settings.config.funds.weeksShown),
        )
      : [];
    every.push({
      assetId: p.asset_id,
      ownerId,
      name: p.fund_name,
      value: v,
      invested,
      startedOn: p.started_on,
      sipMonthly: p.sip_monthly === null ? null : Number(p.sip_monthly),
      sipStopped: p.sip_stopped,
      xirr: r.xirr,
      xirrEstimated: r.estimatedFunds > 0 || verdict.figuresEstimated,
      gain: r.funds > 0 && r.estimatedFunds === 0 ? r.gain : v - invested,
      dayAmount: move && v > 0 ? moveAmount(v, move.pct) : null,
      dayPct: move ? move.pct : null,
      dayFrom: move?.from ?? null,
      dayTo: move?.to ?? null,
      goalIds: goalsBy.get(p.asset_id) ?? [],
      valueBasis: basisText(
        value.get(p.asset_id) !== undefined ? methodOf.get(p.asset_id) : undefined,
      ),
      units: l.fundInfo[p.asset_id]?.units ?? null,
      nav: l.fundInfo[p.asset_id]?.nav ?? null,
      navDate: l.fundInfo[p.asset_id]?.navDate ?? null,
      amfiCode: code,
      history,
      trend,
      folioLast4: p.folio_last4 ?? null,
      category: fundCategory(p.fund_name, scheme?.category ?? null),
      amc: amcLabel(scheme?.amc ?? null),
      taxClass: fundTaxClass(p.fund_name, scheme?.category ?? null).class,
      taxInfo: (() => {
        const c = fundTaxClass(p.fund_name, scheme?.category ?? null);
        return { label: c.label, note: c.note, certain: c.certain, lockInMonths: c.lockInMonths };
      })(),
      label: assetOf.get(p.asset_id)?.label ?? null,
      status: assetOf.get(p.asset_id)?.status ?? 'active',
      exitLoadPct: p.exit_load_pct === null ? null : Number(p.exit_load_pct),
      exitLoadDays: p.exit_load_days === null ? null : Number(p.exit_load_days),
      plan: p.plan_type === 'direct' || p.plan_type === 'regular' ? p.plan_type : 'unknown',
      navReturns:
        navLine.length >= 2
          ? trailingTable(navLine, today, {
              gapDays: settings.config.funds.navGapDays,
              annualiseAfterMonths: settings.config.funds.annualiseAfterMonths,
            })
          : [],
      perf,
      periodPoints: firstDate
        ? fundSeries(
            {
              txns: txBy.get(p.asset_id) ?? [],
              navs: navBy.get(code ?? '') ?? [],
              observations: obsBy.get(p.asset_id) ?? [],
              snapshots: snapBy.get(p.asset_id) ?? [],
              plan: { invested, startedOn: p.started_on },
            },
            today,
            { value: v, invested },
            periodDates(today, settings.config.home.changeDays),
          )
        : [],
      flows: fl.flows,
      flowsEstimated: fl.estimated,
      // lines assumed from the SIP plan (source 'estimate') are not a statement
      hasStatement: hasReal,
      ledger: verdict,
      txns: cas.map((c) => ({
        id: c.id,
        date: c.date,
        kind: c.kind,
        units: c.units,
        amount: c.amount,
        nav: c.nav,
        balance: c.balance,
        description: c.description || null,
        source: c.source,
      })),
      lots,
      lotsBasis,
      realised: ledger.realised,
      updatedOn: lastObs.get(p.asset_id)?.as_of ?? null,
      updatedSource: sourceTag(
        lastObs.get(p.asset_id)?.source ?? null,
        lastObs.get(p.asset_id)?.as_of ?? null,
        false,
      ),
    });
  }
  // colours follow the fund, the kind and the house across the whole household, so narrowing to one person never repaints them
  const palette = {
    categories: [...new Set(every.map((f) => f.category.key))],
    amcs: [...new Set([...every].sort((a, b) => b.value - a.value).map((f) => f.amc ?? '__none'))],
    funds: [...every].sort((a, b) => a.name.localeCompare(b.name)).map((f) => f.assetId),
  };
  const rows = onlyOwner ? every.filter((f) => f.ownerId === onlyOwner) : every;
  const groups: OwnerGroup[] = (
    (owners.data ?? []) as unknown as {
      id: string;
      display_name: string;
      pan_last4: string | null;
    }[]
  )
    .map((o) => {
      const funds = rows.filter((r) => r.ownerId === o.id).sort((a, b) => b.value - a.value);
      return {
        ledger: ledgerSummary(
          [
            {
              ownerId: o.id,
              name: o.display_name,
              funds: funds.map((f) => ({
                assetId: f.assetId,
                name: f.label || f.name,
                startedOn: f.startedOn,
                verdict: f.ledger,
              })),
            },
          ],
          { historyFrom: settings.config.funds.historyFrom, unitTolerance: unitTol },
        )[0]!,
        ownerId: o.id,
        name: o.display_name,
        panLast4: o.pan_last4,
        funds,
        series: combineSeries(funds.map((f) => f.history)),
        trend: combineSeries(funds.map((f) => f.trend)),
        totals: totalsOf(
          funds,
          funds.map((f) => forRet.get(f.assetId)!),
          today,
        ),
      };
    })
    .filter((g) => g.funds.length > 0);
  return {
    today,
    groups,
    household: totalsOf(
      rows,
      rows.map((f) => forRet.get(f.assetId)!),
      today,
    ),
    series: combineSeries(rows.map((f) => f.history)),
    trend: combineSeries(rows.map((f) => f.trend)),
    range,
    palette,
    holdingMonths,
    config: settings.config.funds,
    tax: { rules: settings.rules, harvest: settings.config.harvest },
    benchmark,
    goals: ((goals.data ?? []) as unknown as { id: string; name: string }[]).map((g) => ({
      id: g.id,
      name: g.name,
    })),
  };
}

/** "If this pace holds": this month's SIPs and the return achieved so far (kept within 0–20% so one lucky year does not mislead). */
export function fundPace(view: InvestmentView) {
  const h = view.household;
  const cfg = view.config;
  const assumed = h.xirr === null;
  const rate = Math.max(
    0,
    Math.min(
      cfg.projectionCap,
      h.xirr ?? paceFromSeries(view.series)?.annualGrowth ?? cfg.projectionCap / 2,
    ),
  );
  const args = { today: view.today, value: h.value, monthly: h.sipMonthly, annualReturn: rate };
  return {
    rate,
    assumed,
    spread: cfg.projectionSpread,
    projections: projectCorpus({
      ...args,
      horizons: cfg.projectionYears,
      spread: cfg.projectionSpread,
    }),
    path: projectionPath({ ...args, years: Math.max(...cfg.projectionYears) }),
  };
}
