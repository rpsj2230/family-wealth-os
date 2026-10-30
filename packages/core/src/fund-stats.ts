/**
 * Statistics on mutual funds, for a person or for the household: shares by kind, house and fund, concentration, best and worst,
 * how much is already long-term, the SIPs, and gains already booked by selling (short and long term). Pure: the caller supplies the
 * funds with their lots and transactions. A figure that needs data the fund does not have (a statement, a price) is null and the
 * result names the basis, so the page can say "estimated" or "needs a fund statement" and never show an invented number.
 */
import type { AppConfig } from './config';
import { fyOf } from './tax';
import type { FundCategory } from './fund-category';
import type { FundTaxClass } from './fund-class';
import { approximateFlows } from './performance';
import { addDaysIso, addMonthsIso, type HarvestLot } from './harvest-lots';
import { sipSummary, type StatTxn } from './fund-timeline';

export type StatLot = HarvestLot;

export interface StatRealised {
  soldOn: string;
  /** '1900-01-01' marks units from before the statement began */
  acquiredOn: string;
  units: number;
  proceeds: number;
  /** null when the purchase is not on the statement */
  cost: number | null;
}

export type LotsBasis = 'statement' | 'estimated' | 'none';

export interface StatFund {
  assetId: string;
  ownerId: string;
  name: string;
  value: number;
  invested: number;
  units: number | null;
  nav: number | null;
  startedOn: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  dayAmount: number | null;
  dayPct: number | null;
  folioLast4: string | null;
  category: FundCategory;
  amc: string | null;
  taxClass: FundTaxClass;
  /** whether the transactions of a fund statement are on file for this fund */
  hasStatement: boolean;
  txns: StatTxn[];
  lots: StatLot[];
  lotsBasis: LotsBasis;
  realised: StatRealised[];
}

export const BEFORE_STATEMENT = '1900-01-01';

// ------------------------------------------------------------------------------------------------
// Lots when there is no statement
// ------------------------------------------------------------------------------------------------
/**
 * Purchases rebuilt from the SIP plan and the published prices, for a fund with no statement. Every lot is marked estimated. Returns
 * null unless a price is known near every instalment date (a lot bought at a guessed price would be an invented number). When the
 * units held are known, the lots are scaled to add up to them.
 */
export function estimateLots(args: {
  plan: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean;
  };
  navs: { date: string; nav: number }[];
  today: string;
  unitsHeld: number | null;
  navGapDays: number;
}): StatLot[] | null {
  const flows = approximateFlows(args.plan, args.today);
  if (flows.length === 0 || args.navs.length === 0) return null;
  const built: StatLot[] = [];
  for (const f of flows) {
    let hit: { date: string; nav: number } | null = null;
    for (const n of args.navs) {
      if (n.date > f.date) break;
      hit = n;
    }
    // a price just after the date is also fine for the first instalment: the fund may have started that week
    const near =
      hit && addDaysIso(hit.date, args.navGapDays) >= f.date
        ? hit
        : (args.navs.find(
            (n) => n.date >= f.date && n.date <= addDaysIso(f.date, args.navGapDays),
          ) ?? null);
    if (!near || !(near.nav > 0)) return null;
    built.push({ acquiredOn: f.date, units: f.amount / near.nav, cost: f.amount, estimated: true });
  }
  const total = built.reduce((a, x) => a + x.units, 0);
  const k = args.unitsHeld && args.unitsHeld > 0 && total > 0 ? args.unitsHeld / total : 1;
  return built.map((x) => ({ ...x, units: x.units * k }));
}

// ------------------------------------------------------------------------------------------------
// Shares
// ------------------------------------------------------------------------------------------------
export interface ShareRow {
  key: string;
  label: string;
  value: number;
  /** of the total value, 0 to 1 */
  share: number;
  invested: number;
  /** value less invested */
  gain: number;
  gainPct: number | null;
  funds: number;
}

export type ShareBy = 'category' | 'amc' | 'fund';

const NO_AMC = 'AMC not known';

const keyOf = (f: StatFund, by: ShareBy): [string, string] =>
  by === 'category'
    ? [f.category.key, f.category.label]
    : by === 'amc'
      ? [f.amc ?? '__none', f.amc ?? NO_AMC]
      : [f.assetId, f.name];

/** Value, invested and gain by kind, fund house or fund, largest first. Funds with no value are left out. */
export function shareRows(funds: StatFund[], by: ShareBy): ShareRow[] {
  const total = funds.reduce((a, f) => a + Math.max(0, f.value), 0);
  const map = new Map<string, ShareRow>();
  for (const f of funds) {
    if (!(f.value > 0)) continue;
    const [key, label] = keyOf(f, by);
    const r = map.get(key) ?? {
      key,
      label,
      value: 0,
      share: 0,
      invested: 0,
      gain: 0,
      gainPct: null,
      funds: 0,
    };
    r.value += f.value;
    r.invested += f.invested;
    r.gain += f.value - f.invested;
    r.funds += 1;
    map.set(key, r);
  }
  return [...map.values()]
    .map((r) => ({
      ...r,
      share: total > 0 ? r.value / total : 0,
      gainPct: r.invested > 0 ? r.gain / r.invested : null,
    }))
    .sort((a, b) => b.value - a.value);
}

/** Keeps the `max` largest rows and folds the rest into one "Other" row, so a ring stays readable. */
export function foldShares(rows: ShareRow[], max: number): ShareRow[] {
  if (rows.length <= max) return rows;
  const head = rows.slice(0, max);
  const rest = rows.slice(max);
  const value = rest.reduce((a, r) => a + r.value, 0);
  const invested = rest.reduce((a, r) => a + r.invested, 0);
  const gain = rest.reduce((a, r) => a + r.gain, 0);
  return [
    ...head,
    {
      key: '__other',
      label: `Other (${rest.length})`,
      value,
      share: rest.reduce((a, r) => a + r.share, 0),
      invested,
      gain,
      gainPct: invested > 0 ? gain / invested : null,
      funds: rest.reduce((a, r) => a + r.funds, 0),
    },
  ];
}

export interface Concentration {
  /** the largest funds, with their share of the value */
  top: { label: string; share: number }[];
  topShare: number;
  /** 1 divided by the sum of squared shares: how many equal-sized funds would be as spread out as this portfolio */
  effectiveFunds: number | null;
}

export function concentration(byFund: ShareRow[], top: number): Concentration {
  const head = byFund.slice(0, top);
  const hhi = byFund.reduce((a, r) => a + r.share * r.share, 0);
  return {
    top: head.map((r) => ({ label: r.label, share: r.share })),
    topShare: head.reduce((a, r) => a + r.share, 0),
    effectiveFunds: hhi > 0 ? 1 / hhi : null,
  };
}

// ------------------------------------------------------------------------------------------------
// Holding period
// ------------------------------------------------------------------------------------------------
export interface HoldingProfile {
  basis: LotsBasis;
  /** equity units held longer than the long-term period, and shorter */
  longValue: number;
  shortValue: number;
  longShare: number | null;
  /** gain on the lots whose cost is known */
  longGain: number;
  shortGain: number;
  /** value of lots with no cost on the statement */
  unknownCostValue: number;
  /** the first day any short-term lot becomes long-term, and what turns that day */
  nextTurn: { on: string; value: number } | null;
  /** the day the last short-term lot becomes long-term, so all of the value is; null when it already is (or nothing is held) */
  allLongOn: string | null;
  firstBought: string | null;
  /** average price paid per unit across the lots with a known cost */
  avgCost: number | null;
}

const longOn = (acquired: string, months: number) =>
  acquired === BEFORE_STATEMENT ? BEFORE_STATEMENT : addDaysIso(addMonthsIso(acquired, months), 1);

/** How much of a fund's value has been held long enough for the long-term rate. `holdingMonths` is the tax rule for equity funds. */
export function holdingProfile(args: {
  lots: StatLot[];
  basis: LotsBasis;
  value: number;
  today: string;
  holdingMonths: number;
}): HoldingProfile {
  const lots = args.lots.filter((l) => l.units > 0);
  const units = lots.reduce((a, l) => a + l.units, 0);
  const unit = units > 0 && args.value > 0 ? args.value / units : 0;
  const out: HoldingProfile = {
    basis: lots.length > 0 ? args.basis : 'none',
    longValue: 0,
    shortValue: 0,
    longShare: null,
    longGain: 0,
    shortGain: 0,
    unknownCostValue: 0,
    nextTurn: null,
    allLongOn: null,
    firstBought: null,
    avgCost: null,
  };
  if (lots.length === 0 || unit === 0) return out;
  const turns = new Map<string, number>();
  let costUnits = 0;
  let cost = 0;
  for (const l of lots) {
    const v = l.units * unit;
    const when = longOn(l.acquiredOn, args.holdingMonths);
    const isLong = when <= args.today;
    if (isLong) out.longValue += v;
    else {
      out.shortValue += v;
      turns.set(when, (turns.get(when) ?? 0) + v);
    }
    if (l.cost === null) out.unknownCostValue += v;
    else {
      if (isLong) out.longGain += v - l.cost;
      else out.shortGain += v - l.cost;
      costUnits += l.units;
      cost += l.cost;
    }
    if (l.acquiredOn !== BEFORE_STATEMENT && (!out.firstBought || l.acquiredOn < out.firstBought))
      out.firstBought = l.acquiredOn;
  }
  out.longShare =
    out.longValue + out.shortValue > 0 ? out.longValue / (out.longValue + out.shortValue) : null;
  const next = [...turns.entries()].sort(([a], [b]) => a.localeCompare(b))[0];
  out.nextTurn = next ? { on: next[0], value: next[1] } : null;
  out.allLongOn = [...turns.keys()].sort().pop() ?? null;
  out.avgCost = costUnits > 0 ? cost / costUnits : null;
  return out;
}

export interface HoldingSummary {
  /** equity-oriented funds only: the long-term period and the units that have reached it */
  longValue: number;
  shortValue: number;
  longShare: number | null;
  longGain: number;
  shortGain: number;
  /** equity-oriented value whose purchases are not known (no statement and no price history) */
  unknownValue: number;
  /** value in funds the one-year rule does not apply to (debt, gold, international, hybrids to check) */
  otherValue: number;
  /** funds counted by what their lots rest on */
  fundsByBasis: Record<LotsBasis, number>;
  nextTurn: { on: string; value: number; fund: string } | null;
  byFund: {
    assetId: string;
    name: string;
    longValue: number;
    shortValue: number;
    basis: LotsBasis;
  }[];
}

export function holdingSummary(
  funds: StatFund[],
  today: string,
  holdingMonths: number | null,
): HoldingSummary {
  const s: HoldingSummary = {
    longValue: 0,
    shortValue: 0,
    longShare: null,
    longGain: 0,
    shortGain: 0,
    unknownValue: 0,
    otherValue: 0,
    fundsByBasis: { statement: 0, estimated: 0, none: 0 },
    nextTurn: null,
    byFund: [],
  };
  for (const f of funds) {
    if (!(f.value > 0)) continue;
    if (f.taxClass !== 'equity' || holdingMonths === null) {
      s.otherValue += f.value;
      continue;
    }
    const p = holdingProfile({
      lots: f.lots,
      basis: f.lotsBasis,
      value: f.value,
      today,
      holdingMonths,
    });
    s.fundsByBasis[p.basis] += 1;
    if (p.basis === 'none') {
      s.unknownValue += f.value;
      continue;
    }
    s.longValue += p.longValue;
    s.shortValue += p.shortValue;
    s.longGain += p.longGain;
    s.shortGain += p.shortGain;
    s.byFund.push({
      assetId: f.assetId,
      name: f.name,
      longValue: p.longValue,
      shortValue: p.shortValue,
      basis: p.basis,
    });
    if (p.nextTurn && (!s.nextTurn || p.nextTurn.on < s.nextTurn.on))
      s.nextTurn = { ...p.nextTurn, fund: f.name };
  }
  s.longShare = s.longValue + s.shortValue > 0 ? s.longValue / (s.longValue + s.shortValue) : null;
  s.byFund.sort((a, b) => b.longValue + b.shortValue - (a.longValue + a.shortValue));
  return s;
}

// ------------------------------------------------------------------------------------------------
// Gains already booked
// ------------------------------------------------------------------------------------------------
export interface RealisedYear {
  fy: string;
  proceeds: number;
  /** equity-oriented funds, units held up to the long-term period / longer */
  stcg: number;
  ltcg: number;
  /** funds taxed another way (debt, gold, international): the gain is shown, the tax is not worked out */
  other: number;
}

export interface RealisedSummary {
  proceeds: number;
  stcg: number;
  ltcg: number;
  other: number;
  /** sales whose purchase is not on the statement: left out of the gains above */
  unknownCost: number;
  sales: number;
  byYear: RealisedYear[];
}

export function realisedSummary(funds: StatFund[], holdingMonths: number | null): RealisedSummary {
  const out: RealisedSummary = {
    proceeds: 0,
    stcg: 0,
    ltcg: 0,
    other: 0,
    unknownCost: 0,
    sales: 0,
    byYear: [],
  };
  const years = new Map<string, RealisedYear>();
  for (const f of funds)
    for (const r of f.realised) {
      out.sales += 1;
      out.proceeds += r.proceeds;
      const fy = fyOf(r.soldOn);
      const y = years.get(fy) ?? { fy, proceeds: 0, stcg: 0, ltcg: 0, other: 0 };
      y.proceeds += r.proceeds;
      years.set(fy, y);
      if (r.cost === null) {
        out.unknownCost += 1;
        continue;
      }
      const gain = r.proceeds - r.cost;
      const equity = f.taxClass === 'equity' && holdingMonths !== null;
      if (!equity) {
        out.other += gain;
        y.other += gain;
      } else if (
        r.acquiredOn === BEFORE_STATEMENT ||
        r.soldOn > addMonthsIso(r.acquiredOn, holdingMonths)
      ) {
        out.ltcg += gain;
        y.ltcg += gain;
      } else {
        out.stcg += gain;
        y.stcg += gain;
      }
    }
  out.byYear = [...years.values()]
    .map((y) => ({
      ...y,
      proceeds: Math.round(y.proceeds),
      stcg: Math.round(y.stcg),
      ltcg: Math.round(y.ltcg),
      other: Math.round(y.other),
    }))
    .sort((a, b) => b.fy.localeCompare(a.fy));
  out.proceeds = Math.round(out.proceeds);
  out.stcg = Math.round(out.stcg);
  out.ltcg = Math.round(out.ltcg);
  out.other = Math.round(out.other);
  return out;
}

// ------------------------------------------------------------------------------------------------
// SIP across funds
// ------------------------------------------------------------------------------------------------
export interface SipBlock {
  /** rupees a month across running SIPs */
  monthly: number;
  running: number;
  stopped: number;
  /** instalments on fund statements: rupees paid, and how many funds that covers */
  totalPaid: number | null;
  paidFunds: number;
  /** longest-running SIP in months */
  longestMonths: number | null;
  next: { on: string; amount: number; fund: string; estimated: boolean } | null;
}

export function sipBlock(funds: StatFund[], today: string): SipBlock {
  const b: SipBlock = {
    monthly: 0,
    running: 0,
    stopped: 0,
    totalPaid: null,
    paidFunds: 0,
    longestMonths: null,
    next: null,
  };
  for (const f of funds) {
    const s = sipSummary({
      txns: f.txns,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
      startedOn: f.startedOn,
      today,
    });
    if (s.active) {
      b.running += 1;
      b.monthly += s.monthly ?? 0;
    } else if (s.stopped) b.stopped += 1;
    if (s.totalPaid !== null) {
      b.totalPaid = (b.totalPaid ?? 0) + s.totalPaid;
      b.paidFunds += 1;
    }
    if (s.monthsRunning !== null && (b.longestMonths === null || s.monthsRunning > b.longestMonths))
      b.longestMonths = s.monthsRunning;
    if (s.nextOn && (!b.next || s.nextOn < b.next.on))
      b.next = {
        on: s.nextOn,
        amount: s.monthly ?? 0,
        fund: f.name,
        estimated: s.basis !== 'statement',
      };
  }
  return b;
}

// ------------------------------------------------------------------------------------------------
// One block of statistics
// ------------------------------------------------------------------------------------------------
export interface Mover {
  assetId: string;
  name: string;
  pct: number;
}

export interface GainBar {
  assetId: string;
  label: string;
  gain: number;
  gainPct: number | null;
}

export interface StatBlock {
  funds: number;
  folios: number;
  invested: number;
  value: number;
  /** value less invested: what is gained on the units still held */
  unrealised: number;
  unrealisedPct: number | null;
  /** funds whose figures rest on a fund statement, and funds that are estimated from the start date and SIP */
  withStatement: number;
  estimated: number;
  best: Mover | null;
  worst: Mover | null;
  bestDay: Mover | null;
  worstDay: Mover | null;
  byCategory: ShareRow[];
  byAmc: ShareRow[];
  byFund: ShareRow[];
  concentration: Concentration;
  /** unrealised gain by fund, largest first */
  gainBars: GainBar[];
  holding: HoldingSummary;
  sip: SipBlock;
  realised: RealisedSummary;
}

const mover = (f: StatFund, pct: number): Mover => ({ assetId: f.assetId, name: f.name, pct });

export function statBlock(
  funds: StatFund[],
  ctx: { today: string; holdingMonths: number | null; config: AppConfig['funds'] },
): StatBlock {
  const valued = funds.filter((f) => f.value > 0 || f.invested > 0);
  const value = funds.reduce((a, f) => a + f.value, 0);
  const invested = funds.reduce((a, f) => a + f.invested, 0);
  const byFund = shareRows(funds, 'fund');
  const withPct = funds
    .filter((f) => f.invested > 0 && f.value > 0)
    .map((f) => ({ f, pct: f.value / f.invested - 1 }))
    .sort((a, b) => b.pct - a.pct);
  const withDay = funds.filter((f) => f.dayPct !== null).sort((a, b) => b.dayPct! - a.dayPct!);
  return {
    funds: funds.length,
    folios: new Set(funds.map((f) => f.folioLast4).filter((x): x is string => !!x)).size,
    invested,
    value,
    unrealised: value - invested,
    unrealisedPct: invested > 0 ? value / invested - 1 : null,
    withStatement: funds.filter((f) => f.hasStatement).length,
    estimated: funds.filter((f) => !f.hasStatement).length,
    best: withPct.length >= 2 ? mover(withPct[0]!.f, withPct[0]!.pct) : null,
    worst:
      withPct.length >= 2
        ? mover(withPct[withPct.length - 1]!.f, withPct[withPct.length - 1]!.pct)
        : null,
    bestDay: withDay.length >= 2 ? mover(withDay[0]!, withDay[0]!.dayPct!) : null,
    worstDay:
      withDay.length >= 2
        ? mover(withDay[withDay.length - 1]!, withDay[withDay.length - 1]!.dayPct!)
        : null,
    byCategory: shareRows(funds, 'category'),
    byAmc: shareRows(funds, 'amc'),
    byFund,
    concentration: concentration(byFund, ctx.config.concentrationTop),
    gainBars: valued
      .map((f) => ({
        assetId: f.assetId,
        label: f.name,
        gain: f.value - f.invested,
        gainPct: f.invested > 0 ? f.value / f.invested - 1 : null,
      }))
      .sort((a, b) => b.gain - a.gain),
    holding: holdingSummary(funds, ctx.today, ctx.holdingMonths),
    sip: sipBlock(funds, ctx.today),
    realised: realisedSummary(funds, ctx.holdingMonths),
  };
}

// ------------------------------------------------------------------------------------------------
// Per fund
// ------------------------------------------------------------------------------------------------
/** Average price paid per unit still held: the amount invested over the units. Null unless both are known. */
export const avgCostPerUnit = (invested: number, units: number | null) =>
  units !== null && units > 0 && invested > 0 ? invested / units : null;

/**
 * Compound annual growth of a single investment. It is only meaningful when all the money went in on one date, so the caller
 * passes that date; with a SIP the annual return is the XIRR. Null until `minMonths` have passed.
 */
export function cagr(args: {
  invested: number;
  value: number;
  from: string;
  today: string;
  minMonths: number;
}): number | null {
  if (!(args.invested > 0) || !(args.value > 0)) return null;
  if (addMonthsIso(args.from, args.minMonths) > args.today) return null;
  const years =
    (Date.parse(`${args.today}T00:00:00Z`) - Date.parse(`${args.from}T00:00:00Z`)) /
    (365 * 86_400_000);
  return years > 0 ? Math.pow(args.value / args.invested, 1 / years) - 1 : null;
}

/** The one date all the money went in on, or null when it came in on several dates (a SIP, top-ups). */
export function singleInvestmentDate(txns: StatTxn[]): string | null {
  const buys = txns.filter((x) => x.units > 0 && x.amount !== 0);
  const dates = new Set(buys.map((x) => x.date));
  return dates.size === 1 && txns.every((x) => x.units > 0) ? [...dates][0]! : null;
}
