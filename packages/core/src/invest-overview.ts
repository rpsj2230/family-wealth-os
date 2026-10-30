/**
 * What the Investments overview shows, as numbers: the headline figures (invested, value, profit or loss in rupees and per cent,
 * what is booked by selling, the annual return, today's move, SIPs), how the value splits between your money and its growth, the
 * funds table with its groupings and totals, how old the units are, and the next monthly instalments. Pure; the page only formats.
 */
import { BEFORE_STATEMENT, type RealisedSummary, type StatFund } from './fund-stats';
import { addDaysIso, addMonthsIso } from './harvest-lots';
import { sipSummary } from './fund-timeline';
import { readSip, sipStanding } from './fund-import-diff';
import type { LedgerStatus, LedgerVerdict } from './ledger-check';

// ------------------------------------------------------------------------------------------------
// Headline
// ------------------------------------------------------------------------------------------------
export interface HeroInput {
  funds: number;
  folios: number;
  invested: number;
  value: number;
  dayAmount: number;
  dayPct: number | null;
  xirr: number | null;
  xirrEstimated: boolean;
  sipMonthly: number;
  /** funds whose figures rest on a statement, and funds estimated from the start date and SIP */
  withStatement: number;
  estimated: number;
  /** funds whose transaction history does not reconcile, so the headline figures are partly estimated */
  unreconciled?: number;
  longShare: number | null;
  realised: RealisedSummary;
}

export interface Hero {
  funds: number;
  folios: number;
  invested: number;
  value: number;
  /** value less invested: the profit or loss on the units still held */
  unrealised: number;
  unrealisedPct: number | null;
  realised: {
    /** gains booked by the sales on statements whose purchase cost is known */
    total: number;
    stcg: number;
    ltcg: number;
    other: number;
    sales: number;
    /** sales whose purchase is not on the statement, so their gain is left out */
    unknown: number;
  };
  /** the profit or loss on the units held plus what selling has booked */
  totalGain: number;
  dayAmount: number;
  dayPct: number | null;
  xirr: number | null;
  xirrEstimated: boolean;
  sipMonthly: number;
  longShare: number | null;
  withStatement: number;
  estimated: number;
  unreconciled: number;
  /** how current value splits between the amount invested and its growth: each 0 to 1, summing to 1 (growth is 0 for a loss) */
  split: { cost: number; growth: number } | null;
}

export function heroModel(i: HeroInput): Hero {
  const unrealised = i.value - i.invested;
  const r = i.realised;
  const realisedTotal = r.stcg + r.ltcg + r.other;
  const split =
    i.value > 0 && i.invested > 0
      ? {
          cost: Math.min(i.invested, i.value) / i.value,
          growth: Math.max(0, i.value - i.invested) / i.value,
        }
      : null;
  return {
    funds: i.funds,
    folios: i.folios,
    invested: i.invested,
    value: i.value,
    unrealised,
    unrealisedPct: i.invested > 0 ? i.value / i.invested - 1 : null,
    realised: {
      total: realisedTotal,
      stcg: r.stcg,
      ltcg: r.ltcg,
      other: r.other,
      sales: r.sales,
      unknown: r.unknownCost,
    },
    totalGain: unrealised + realisedTotal,
    dayAmount: i.dayAmount,
    dayPct: i.dayPct,
    xirr: i.xirr,
    xirrEstimated: i.xirrEstimated,
    sipMonthly: i.sipMonthly,
    longShare: i.longShare,
    withStatement: i.withStatement,
    estimated: i.estimated,
    unreconciled: i.unreconciled ?? 0,
    split,
  };
}

// ------------------------------------------------------------------------------------------------
// The funds table
// ------------------------------------------------------------------------------------------------
export interface FundLine {
  assetId: string;
  ownerId: string;
  ownerName: string;
  name: string;
  categoryKey: string;
  categoryLabel: string;
  categoryCertain: boolean;
  amc: string | null;
  plan: 'direct' | 'regular' | 'unknown';
  /** where the fund is bought and held (an investment app, a broker's demat account), from the rules in Settings; null when none fits */
  platform: string | null;
  invested: number;
  value: number;
  gain: number;
  gainPct: number | null;
  dayAmount: number | null;
  dayPct: number | null;
  xirr: number | null;
  xirrEstimated: boolean;
  /** the fund's own price return over a year (per year), from its published prices; null without enough history */
  ret1y: number | null;
  /** the fund's price return over the whole history in view */
  retAll: number | null;
  /** share of the value of everything shown */
  share: number;
  sipMonthly: number | null;
  sipStopped: boolean;
  /** the SIP as its own instalments show it, for a fund with no SIP amount saved (see sipSeenOf) */
  sipSeen: SipSeen | null;
  units: number | null;
  nav: number | null;
  avgCost: number | null;
  hasStatement: boolean;
  amfiCode: string | null;
  goalIds: string[];
  /** the first purchase or start date, and the date of the price, for the line under the name */
  startedOn: string | null;
  navDate: string | null;
  /** in words, where current value comes from */
  valueBasis: string;
  /** whether the transaction history adds up, and the chip that says so; the figures of a fund that does not reconcile carry "est." */
  ledgerStatus: LedgerStatus;
  ledgerChip: LedgerVerdict['chip'];
  figuresEstimated: boolean;
}

export type GroupBy = 'person' | 'goal' | 'kind' | 'house' | 'plan' | 'platform' | 'none';
export const GROUP_BYS: { key: GroupBy; label: string }[] = [
  { key: 'person', label: 'Person' },
  { key: 'goal', label: 'Goal' },
  { key: 'kind', label: 'Kind of fund' },
  { key: 'house', label: 'Fund house' },
  { key: 'plan', label: 'Type' },
  { key: 'platform', label: 'Platform' },
  { key: 'none', label: 'No grouping' },
];

/** The headings of the Type grouping. */
export const PLAN_GROUP: Record<FundLine['plan'], string> = {
  direct: 'Direct plans',
  regular: 'Regular plans',
  unknown: 'Plan not known',
};

/**
 * Direct or Regular: the plan saved on the fund when it says; otherwise the plan of the official scheme it is matched to; otherwise
 * the word "Direct" or "Regular" in the scheme's or the fund's name. Unknown when none of them says.
 */
export function fundPlanOf(
  saved: string | null,
  schemePlan: string | null,
  names: (string | null | undefined)[],
): FundLine['plan'] {
  if (saved === 'direct' || saved === 'regular') return saved;
  const said = (s: string | null | undefined): FundLine['plan'] | null =>
    !s ? null : /\bdirect\b/i.test(s) ? 'direct' : /\bregular\b/i.test(s) ? 'regular' : null;
  return said(schemePlan) ?? names.map(said).find((x) => x !== null) ?? 'unknown';
}

/** The SIP of a fund read from its own instalments: the last one, the usual amount, and whether the next was due and never came. */
export interface SipSeen {
  last: string;
  amount: number | null;
  /** 'stopped': the instalments came regularly and then two due dates (with their usual lateness) passed with none */
  state: 'running' | 'stopped';
}

/**
 * For a fund with no SIP amount saved: its SIP as the purchases on file show it. Purchases that came regularly (at least `minRun` in a
 * row, one cadence apart) are a SIP; it is running while the next one is not yet overdue, stopped once it is. Null when the purchases
 * show no regular pattern (one-off investments). It counts as stopped only once two due dates have passed with nothing.
 */
export function sipSeenOf(
  lines: {
    date: string;
    kind?: string | null | undefined;
    amount: number;
    source?: string | null | undefined;
  }[],
  today: string,
  rules: { sipMinInstalments: number; moneyTolerance: number },
): SipSeen | null {
  const buys = lines
    .filter((l) => (l.kind === 'sip' || l.kind === 'purchase') && l.source !== 'estimate')
    .map((l) => ({ date: l.date, kind: 'sip', amount: Math.abs(l.amount) }));
  const read = readSip([], buys, rules);
  if (!read.cadence || !read.last || read.runLength < Math.max(2, rules.sipMinInstalments))
    return null;
  // stopped only once two due dates have gone by with nothing, so a statement that is a few weeks old does not read as a stop
  const st = sipStanding(read, addDaysIso(today, -read.cadence.days));
  return {
    last: read.last,
    amount: read.amount,
    state: st?.state === 'missed' ? 'stopped' : 'running',
  };
}

export const parseGroupBy = (v: string | null | undefined): GroupBy =>
  GROUP_BYS.some((g) => g.key === v) ? (v as GroupBy) : 'person';

export interface GroupTotals {
  funds: number;
  invested: number;
  value: number;
  gain: number;
  gainPct: number | null;
  dayAmount: number | null;
  dayPct: number | null;
  xirr: number | null;
  xirrEstimated: boolean;
  share: number;
  sipMonthly: number;
  /** funds in the group whose history does not reconcile, so the figures above are partly estimated */
  unreconciled: number;
}

export interface FundGroup {
  key: string;
  label: string;
  lines: FundLine[];
  totals: GroupTotals;
}

/** Adds up a set of lines. `xirrOf` gives the annual return of a set of funds (it needs their cash flows, which the lines do not hold). */
export function totalsOfLines(
  lines: FundLine[],
  everything: number,
  xirrOf: (ids: string[]) => { xirr: number | null; estimated: boolean },
): GroupTotals {
  const value = lines.reduce((a, l) => a + l.value, 0);
  const invested = lines.reduce((a, l) => a + l.invested, 0);
  const withDay = lines.filter((l) => l.dayAmount !== null);
  const day = withDay.reduce((a, l) => a + (l.dayAmount ?? 0), 0);
  const prior = withDay.reduce((a, l) => a + l.value - (l.dayAmount ?? 0), 0);
  const x = xirrOf(lines.map((l) => l.assetId));
  return {
    funds: lines.length,
    invested,
    value,
    gain: value - invested,
    gainPct: invested > 0 ? value / invested - 1 : null,
    dayAmount: withDay.length > 0 ? day : null,
    dayPct: withDay.length > 0 && prior > 0 ? day / prior : null,
    xirr: x.xirr,
    xirrEstimated: x.estimated,
    share: everything > 0 ? value / everything : 0,
    sipMonthly: lines.filter((l) => !l.sipStopped).reduce((a, l) => a + (l.sipMonthly ?? 0), 0),
    unreconciled: lines.filter((l) => l.figuresEstimated).length,
  };
}

/** The key and heading of a fund that counts towards no goal, and of one split between several. */
export const NO_GOAL = { key: '__nogoal', label: 'No goal' };
export const MANY_GOALS = { key: '__manygoals', label: 'Split between goals' };

/**
 * Groups the lines by person, goal, kind of fund, fund house, plan or platform (or not at all), largest group first, each with its totals. A fund
 * counts under its goal when it has exactly one; funds with none go under "No goal" and funds split between goals under their own
 * heading (their split is on the Goals page), which is placed last.
 */
export function groupLines(
  lines: FundLine[],
  by: GroupBy,
  xirrOf: (ids: string[]) => { xirr: number | null; estimated: boolean },
  goals: { id: string; name: string }[] = [],
): FundGroup[] {
  const everything = lines.reduce((a, l) => a + l.value, 0);
  const keyOf = (l: FundLine): [string, string] =>
    by === 'person'
      ? [l.ownerId, l.ownerName]
      : by === 'kind'
        ? [l.categoryKey, l.categoryLabel]
        : by === 'house'
          ? [l.amc ?? '__none', l.amc ?? 'Fund house not known']
          : by === 'plan'
            ? [l.plan, PLAN_GROUP[l.plan]]
            : by === 'platform'
              ? [l.platform ?? '__none', l.platform ?? 'Platform not set']
              : by === 'goal'
                ? l.goalIds.length === 0
                  ? [NO_GOAL.key, NO_GOAL.label]
                  : l.goalIds.length > 1
                    ? [MANY_GOALS.key, MANY_GOALS.label]
                    : [l.goalIds[0]!, goals.find((g) => g.id === l.goalIds[0])?.name ?? 'A goal']
                : ['all', 'All funds'];
  const map = new Map<string, FundGroup>();
  for (const l of lines) {
    const [key, label] = keyOf(l);
    const g = map.get(key) ?? { key, label, lines: [], totals: null as unknown as GroupTotals };
    g.lines.push(l);
    map.set(key, g);
  }
  return [...map.values()]
    .map((g) => ({
      ...g,
      lines: [...g.lines].sort((a, b) => b.value - a.value),
      totals: totalsOfLines(g.lines, everything, xirrOf),
    }))
    .sort((a, b) => {
      // the goalless and the split groups come last, so the goals read first; so do the funds whose house, plan or platform is not known
      const rank = (g: FundGroup) =>
        by === 'goal'
          ? g.key === NO_GOAL.key
            ? 2
            : g.key === MANY_GOALS.key
              ? 1
              : 0
          : g.key === '__none' || (by === 'plan' && g.key === 'unknown')
            ? 1
            : 0;
      return rank(a) - rank(b) || b.totals.value - a.totals.value;
    });
}

export type FundSortKey =
  | 'name'
  | 'invested'
  | 'value'
  | 'gain'
  | 'gainPct'
  | 'dayAmount'
  | 'dayPct'
  | 'xirr'
  | 'ret1y'
  | 'share'
  | 'sipMonthly';

export const FUND_COLUMNS: { key: FundSortKey; label: string }[] = [
  { key: 'name', label: 'Fund' },
  { key: 'invested', label: 'Invested' },
  { key: 'value', label: 'Current value' },
  { key: 'gain', label: 'Profit or loss' },
  { key: 'gainPct', label: 'Profit or loss %' },
  { key: 'dayAmount', label: 'Today' },
  { key: 'dayPct', label: 'Today %' },
  { key: 'xirr', label: 'Annual return (XIRR)' },
  { key: 'ret1y', label: '1 year price return' },
  { key: 'share', label: 'Share of total' },
  { key: 'sipMonthly', label: 'SIP a month' },
];

/** Sorts lines by a column; lines with no figure go last whichever way it runs. */
export function sortLines(lines: FundLine[], key: FundSortKey, dir: 1 | -1): FundLine[] {
  const val = (l: FundLine): number | string | null =>
    key === 'name' ? l.name : (l[key] as number | null);
  return [...lines].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (typeof x === 'string' ? x.localeCompare(y as string) : x - (y as number)) * dir;
  });
}

/** Keeps the lines whose name, kind, house, person or plan contain every word typed. */
export function searchLines(lines: FundLine[], q: string): FundLine[] {
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return lines;
  return lines.filter((l) => {
    const hay =
      `${l.name} ${l.categoryLabel} ${l.amc ?? ''} ${l.ownerName} ${l.plan} ${l.platform ?? ''}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

export interface PlanSplit {
  key: 'direct' | 'regular' | 'unknown';
  label: string;
  value: number;
  share: number;
  funds: number;
}

/**
 * How much of the value is in Direct plans, Regular plans and plans not known. A Regular plan pays the distributor a commission out
 * of the fund's expenses every year, so it earns less than the same fund's Direct plan; the saving is not worked out here because
 * the expense ratios are not part of the free data the page uses.
 */
export function splitByPlan(lines: FundLine[]): PlanSplit[] {
  const total = lines.reduce((a, l) => a + Math.max(0, l.value), 0);
  const names: Record<PlanSplit['key'], string> = {
    direct: 'Direct plans',
    regular: 'Regular plans',
    unknown: 'Plan not set',
  };
  return (['direct', 'regular', 'unknown'] as const)
    .map((key) => {
      const of = lines.filter((l) => l.plan === key && l.value > 0);
      const value = of.reduce((a, l) => a + l.value, 0);
      return {
        key,
        label: names[key],
        value,
        share: total > 0 ? value / total : 0,
        funds: of.length,
      };
    })
    .filter((p) => p.funds > 0);
}

// ------------------------------------------------------------------------------------------------
// How old the units are
// ------------------------------------------------------------------------------------------------
export interface AgeBucket {
  key: string;
  label: string;
  /** whole months, from (included) and to (excluded); null to for the last bucket */
  fromMonths: number | null;
  toMonths: number | null;
  value: number;
  share: number;
  /** gain on the units whose cost is known */
  gain: number;
  lots: number;
  /** value in this bucket that rests on a plan estimate, not a statement */
  estimatedValue: number;
}

const monthsText = (m: number) =>
  m % 12 === 0 && m >= 12 ? `${m / 12} year${m === 12 ? '' : 's'}` : `${m} months`;

/**
 * Splits the value of the units held by how long ago they were bought, using each fund's lots (a purchase each). `edges` are the
 * ages in months where a bucket ends, for example [3, 12, 36]. Units from before the first statement have no known date and
 * form their own bucket. Funds without lots are counted in `unknownValue`.
 */
export function lotAgeing(
  funds: StatFund[],
  today: string,
  edges: number[],
): { buckets: AgeBucket[]; unknownValue: number; total: number } {
  const e = [...new Set(edges)].filter((x) => x > 0).sort((a, b) => a - b);
  const mk = (from: number | null, to: number | null): AgeBucket => ({
    key: `${from ?? 'x'}-${to ?? 'x'}`,
    label:
      from === null && to !== null
        ? `Under ${monthsText(to)}`
        : to === null
          ? `Over ${monthsText(from!)}`
          : `${monthsText(from!)} to ${monthsText(to)}`,
    fromMonths: from,
    toMonths: to,
    value: 0,
    share: 0,
    gain: 0,
    lots: 0,
    estimatedValue: 0,
  });
  const buckets: AgeBucket[] = e.length
    ? [mk(null, e[0]!), ...e.slice(1).map((x, i) => mk(e[i]!, x)), mk(e[e.length - 1]!, null)]
    : [mk(null, null)];
  const old: AgeBucket = {
    ...mk(null, null),
    key: 'before',
    label: 'Bought before the statement began',
  };
  let unknownValue = 0;
  for (const f of funds) {
    const lots = f.lots.filter((l) => l.units > 0);
    const units = lots.reduce((a, l) => a + l.units, 0);
    if (!(f.value > 0)) continue;
    if (lots.length === 0 || units <= 0) {
      unknownValue += f.value;
      continue;
    }
    const unit = f.value / units;
    for (const l of lots) {
      const v = l.units * unit;
      const target =
        l.acquiredOn === BEFORE_STATEMENT
          ? old
          : (buckets.find((b) => {
              const hi = b.toMonths === null ? null : addMonthsIso(l.acquiredOn, b.toMonths);
              const lo = b.fromMonths === null ? null : addMonthsIso(l.acquiredOn, b.fromMonths);
              // age in months is under `toMonths` when the date `toMonths` after the purchase is still ahead of today
              return (hi === null || hi > today) && (lo === null || lo <= today);
            }) ?? buckets[buckets.length - 1]!);
      target.value += v;
      target.lots += 1;
      if (l.estimated) target.estimatedValue += v;
      if (l.cost !== null) target.gain += v - l.cost;
    }
  }
  const all = old.value > 0 ? [...buckets, old] : buckets;
  const total = all.reduce((a, b) => a + b.value, 0);
  for (const b of all) b.share = total > 0 ? b.value / total : 0;
  return { buckets: all, unknownValue, total };
}

// ------------------------------------------------------------------------------------------------
// The next instalments
// ------------------------------------------------------------------------------------------------
export interface UpcomingSip {
  assetId: string;
  fund: string;
  ownerId: string;
  on: string;
  amount: number;
  /** read from the pattern of past instalments on a statement; otherwise expected from the plan */
  estimated: boolean;
}

/** The next instalment of every running SIP, soonest first, at most `limit`. */
export function upcomingSips(funds: StatFund[], today: string, limit: number): UpcomingSip[] {
  const out: UpcomingSip[] = [];
  for (const f of funds) {
    const s = sipSummary({
      txns: f.txns,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
      startedOn: f.startedOn,
      today,
    });
    if (s.active && s.nextOn)
      out.push({
        assetId: f.assetId,
        fund: f.name,
        ownerId: f.ownerId,
        on: s.nextOn,
        amount: s.monthly ?? 0,
        estimated: s.basis !== 'statement',
      });
  }
  return out.sort((a, b) => a.on.localeCompare(b.on) || b.amount - a.amount).slice(0, limit);
}

/** Days from today to a date, never below zero. */
export const daysAhead = (today: string, on: string) =>
  Math.max(
    0,
    Math.round((Date.parse(`${on}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000),
  );
