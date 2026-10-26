/**
 * HarvestLot-level checks behind a tax harvest, per fund. Every purchase (each SIP instalment) is its own lot with its own clocks:
 *  - the long-term clock (equity: 12 months, so a sale is long-term only the day AFTER the first anniversary),
 *  - the exit-load window (units sold inside it pay the load; sold oldest first),
 *  - the ELSS lock-in (units cannot be sold at all).
 * A lot is "ready" for a gain harvest when all three have passed. Units are sold oldest first (FIFO), so the ready lots are
 * always the ones at the front. Pure; nothing here sells or buys.
 */
export interface HarvestLot {
  acquiredOn: string;
  units: number;
  /** what was paid; null when the purchase is not on the statement */
  cost: number | null;
  /** worked out from the SIP plan rather than read from a statement */
  estimated?: boolean;
}

const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const addMonthsIso = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + m);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
export const addDaysIso = (iso: string, n: number) =>
  new Date(t(iso) + n * 86_400_000).toISOString().slice(0, 10);

/**
 * The cost used for a sale of units bought on or before 31 January 2018: the higher of what was paid and the lower of the 31 Jan 2018
 * value and the sale value. Returns the actual cost when the 2018 price is not known (so the gain is never understated).
 */
export function grandfatheredCost(args: {
  acquiredOn: string;
  cost: number;
  units: number;
  fmv2018PerUnit: number | null;
  saleValue: number;
}): number {
  if (args.acquiredOn >= '2018-02-01' || args.fmv2018PerUnit === null || !(args.fmv2018PerUnit > 0))
    return args.cost;
  return Math.max(args.cost, Math.min(args.units * args.fmv2018PerUnit, args.saleValue));
}

export interface LotRules {
  /** months after which a sale is long-term: 12 for equity funds */
  holdingMonths: number;
  /** extra margin, in months, kept before a lot counts as ready */
  marginMonths?: number;
  /** exit load window in days from each purchase (0 = none) */
  exitLoadDays?: number;
  exitLoadPct?: number;
  /** ELSS lock-in in months from each purchase (0 = none) */
  lockInMonths?: number;
}

export interface LotStatus {
  lot: HarvestLot;
  value: number;
  gain: number | null;
  /** first day a sale is long-term */
  longTermOn: string;
  /** first day with no exit load */
  loadFreeOn: string;
  /** first day the units can be sold at all */
  unlockedOn: string;
  /** first day the lot is ready for a gain harvest: long-term, load-free and unlocked, plus the margin */
  readyOn: string;
}

export function lotStatus(
  lot: HarvestLot,
  unitValue: number,
  rules: LotRules,
  fmv2018PerUnit: number | null = null,
): LotStatus {
  const value = lot.units * unitValue;
  const cost =
    lot.cost === null
      ? null
      : grandfatheredCost({
          acquiredOn: lot.acquiredOn,
          cost: lot.cost,
          units: lot.units,
          fmv2018PerUnit,
          saleValue: value,
        });
  const longTermOn = addDaysIso(addMonthsIso(lot.acquiredOn, rules.holdingMonths), 1);
  const loadFreeOn = rules.exitLoadDays
    ? addDaysIso(lot.acquiredOn, rules.exitLoadDays + 1)
    : lot.acquiredOn;
  const unlockedOn = rules.lockInMonths
    ? addMonthsIso(lot.acquiredOn, rules.lockInMonths)
    : lot.acquiredOn;
  const margin = rules.marginMonths ?? 0;
  const base = [longTermOn, loadFreeOn, unlockedOn].reduce((a, b) => (a > b ? a : b));
  return {
    lot,
    value,
    gain: cost === null ? null : value - cost,
    longTermOn,
    loadFreeOn,
    unlockedOn,
    readyOn: margin > 0 ? addMonthsIso(base, margin) : base,
  };
}

export interface LotBucket {
  units: number;
  value: number;
  cost: number;
  gain: number;
  lots: number;
}
const empty = (): LotBucket => ({ units: 0, value: 0, cost: 0, gain: 0, lots: 0 });
const add = (b: LotBucket, s: LotStatus) => {
  b.units += s.lot.units;
  b.value += s.value;
  b.cost += s.value - (s.gain ?? 0);
  b.gain += s.gain ?? 0;
  b.lots += 1;
};

export interface LotTranche extends LotBucket {
  /** the day these lots become ready for a harvest */
  on: string;
  daysAway: number;
}

export interface LotLadder {
  /** ready now: long-term, past any exit load and lock-in */
  ready: LotBucket;
  /** held but not ready yet, split by what it is waiting for */
  waiting: LotBucket;
  /** lots whose purchase is not on the statement: they cannot be counted */
  unknownCost: LotBucket;
  /** sale value of the ready lots that are not in profit (a harvest would book a loss) */
  readyAtLoss: LotBucket;
  /** when the waiting lots become ready, soonest first, one row per day */
  upcoming: LotTranche[];
  /** the earliest unit's purchase, and the last */
  firstPurchase: string | null;
  lastPurchase: string | null;
  /** exit load that selling the waiting lots today would cost */
  loadIfSoldToday: number;
  /** the statuses, oldest first */
  lots: LotStatus[];
}

/** Sorts a fund's lots oldest first and says what is ready now and when the rest will be. */
export function lotLadder(args: {
  lots: HarvestLot[];
  /** the latest price per unit */
  unitValue: number;
  today: string;
  rules: LotRules;
  fmv2018PerUnit?: number | null;
}): LotLadder {
  const sorted = [...args.lots].sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn));
  const statuses = sorted.map((l) =>
    lotStatus(l, args.unitValue, args.rules, args.fmv2018PerUnit ?? null),
  );
  const out: LotLadder = {
    ready: empty(),
    waiting: empty(),
    unknownCost: empty(),
    readyAtLoss: empty(),
    upcoming: [],
    firstPurchase: sorted[0]?.acquiredOn ?? null,
    lastPurchase: sorted[sorted.length - 1]?.acquiredOn ?? null,
    loadIfSoldToday: 0,
    lots: statuses,
  };
  const byDay = new Map<string, LotTranche>();
  for (const s of statuses) {
    if (s.gain === null) {
      add(out.unknownCost, s);
      continue;
    }
    if (s.readyOn <= args.today) {
      if (s.gain > 0) add(out.ready, s);
      else add(out.readyAtLoss, s);
    } else {
      add(out.waiting, s);
      const row =
        byDay.get(s.readyOn) ??
        ({
          ...empty(),
          on: s.readyOn,
          daysAway: Math.round((t(s.readyOn) - t(args.today)) / 86_400_000),
        } as LotTranche);
      row.units += s.lot.units;
      row.value += s.value;
      row.cost += s.value - (s.gain ?? 0);
      row.gain += s.gain ?? 0;
      row.lots += 1;
      byDay.set(s.readyOn, row);
      if (args.rules.exitLoadPct && s.loadFreeOn > args.today)
        out.loadIfSoldToday += s.value * args.rules.exitLoadPct;
    }
  }
  out.upcoming = [...byDay.values()].sort((a, b) => a.on.localeCompare(b.on));
  return out;
}

export interface TermSplit {
  /** net gain (negative = loss) on the units a sale of this many oldest lots would use, by term */
  short: number;
  long: number;
  proceeds: number;
}

/**
 * What selling the oldest `count` lots would book, split into short- and long-term. Units go oldest first and cannot be picked
 * one by one, so a loss on the newest lots can only be booked by selling the older ones too (unless they sit in another folio).
 */
export function sellPrefix(statuses: LotStatus[], count: number, today: string): TermSplit {
  const r: TermSplit = { short: 0, long: 0, proceeds: 0 };
  for (const s of statuses.slice(0, count)) {
    if (s.gain === null) continue;
    r.proceeds += s.value;
    if (s.longTermOn <= today) r.long += s.gain;
    else r.short += s.gain;
  }
  return r;
}
