/**
 * The full transaction ledger of a fund, ready to show: every line with its type, units, price, amount and units held after it, the
 * cost of the units held and their value at that date, what each purchase is worth today, and for each sale the gain it booked
 * (oldest units sold first) and whether it was short or long term. Also the pure parts of the ledger table: filter, sort, export rows.
 * Nothing here invents a figure: a price, a value or a gain that the data cannot support is null.
 */
import { addMonthsIso } from './harvest-lots';
import { fyOf } from './tax';
import type { IndexPoint } from './return-profile';

export interface LedgerTxn {
  /** the stored line, for a link to its own page */
  id?: string | null;
  date: string;
  kind: string;
  units: number;
  amount: number;
  nav?: number | null;
  balance?: number | null;
  description?: string | null;
  /** where the line came from: a fund statement, the transaction form, an import */
  source?: string | null;
}

export type LedgerGroup = 'buy' | 'sell' | 'other';

export const LEDGER_KIND_LABEL: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  dividend_reinvest: 'Dividend reinvested',
  dividend_payout: 'IDCW paid out',
  bonus: 'Bonus units',
  redeem: 'Sale',
  switch_out: 'Switch out',
  other: 'Other',
};

/** The filter choices of the ledger, in the order they are shown. */
export const LEDGER_TYPES: { key: string; label: string; kinds: string[] }[] = [
  { key: 'all', label: 'All', kinds: [] },
  { key: 'sip', label: 'SIP', kinds: ['sip'] },
  { key: 'buy', label: 'One-off purchases', kinds: ['purchase', 'other'] },
  { key: 'sell', label: 'Sales', kinds: ['redeem'] },
  { key: 'switch', label: 'Switches', kinds: ['switch_in', 'switch_out'] },
  {
    key: 'dividend',
    label: 'Dividends and bonus',
    kinds: ['dividend_reinvest', 'dividend_payout', 'bonus'],
  },
];

export interface LedgerRow {
  /** position in date order, for a stable key */
  n: number;
  /** the stored line, for a link to its own page */
  id: string | null;
  date: string;
  kind: string;
  label: string;
  group: LedgerGroup;
  units: number;
  /** price per unit: the statement's, or the published price of that day (then `navBasis` says so) */
  nav: number | null;
  navBasis: 'statement' | 'published' | null;
  /** rupees: positive for money in, negative for money out */
  amount: number;
  /** units held after this line: the statement's own figure, or added up */
  balance: number | null;
  /** cost of the units held after this line (a sale takes out the cost of the units it sold) */
  costHeld: number;
  /** what the units held were worth on this date, at that day's price; null without a price */
  valueAfter: number | null;
  /** for a purchase: units of it still held, what they are worth now and the gain on them */
  unitsLeft: number | null;
  valueNow: number | null;
  gainNow: number | null;
  gainNowPct: number | null;
  /** for a sale: the gain booked, and whether it was short or long term (equity funds only) */
  realisedGain: number | null;
  term: 'short' | 'long' | 'mixed' | null;
  /** days from purchase to today for a purchase still held; for a sale, the average age of the units sold */
  heldDays: number | null;
  /** the day a purchase turns long-term */
  longTermOn: string | null;
  source: string | null;
  description: string | null;
  year: string;
  fy: string;
}

interface Lot {
  row: number;
  date: string;
  units: number;
  cost: number | null;
  costPerUnit: number | null;
}

const OLD = '1900-01-01';
const t = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (a: string, b: string) => Math.round((t(b) - t(a)) / 86_400_000);

const groupOf = (kind: string, units: number): LedgerGroup =>
  units < 0 || kind === 'redeem' || kind === 'switch_out' ? 'sell' : units > 0 ? 'buy' : 'other';

/**
 * Builds the ledger of one fund. `navs` are the published prices (oldest first) used when a line gives no price and for the value
 * after each line; `navNow` values the units still held. `holdingMonths` is the long-term period for equity funds (null for any
 * other fund, whose gain is taxed another way, so no term is shown).
 */
export function buildLedger(args: {
  txns: LedgerTxn[];
  navs: IndexPoint[];
  navNow: number | null;
  today: string;
  holdingMonths: number | null;
  /** a published price older than this many days is not used */
  gapDays: number;
}): LedgerRow[] {
  const sorted = args.txns
    .map((x, i) => ({ x, i }))
    .sort((a, b) => a.x.date.localeCompare(b.x.date) || a.i - b.i)
    .map((e) => e.x);
  const priceOn = (d: string): number | null => {
    let best: IndexPoint | null = null;
    for (const p of args.navs) {
      if (p.date > d) break;
      best = p;
    }
    return best && daysBetween(best.date, d) <= args.gapDays ? best.value : null;
  };
  const first = sorted[0];
  const lots: Lot[] = [];
  let running = 0;
  const opening =
    first && typeof first.balance === 'number' ? Math.max(0, first.balance - first.units) : 0;
  if (opening > 0.0005) {
    lots.push({ row: -1, date: OLD, units: opening, cost: null, costPerUnit: null });
    running = opening;
  }
  const rows: LedgerRow[] = [];
  sorted.forEach((x, i) => {
    const group = groupOf(x.kind, x.units);
    const price = x.nav && x.nav > 0 ? x.nav : priceOn(x.date);
    let realisedGain: number | null = null;
    let term: LedgerRow['term'] = null;
    let heldDays: number | null = null;
    if (x.units > 0) {
      const paid = x.kind === 'bonus' ? 0 : Math.abs(x.amount);
      lots.push({ row: i, date: x.date, units: x.units, cost: paid, costPerUnit: paid / x.units });
    } else if (x.units < 0) {
      let left = -x.units;
      let cost = 0;
      let known = true;
      let ageUnits = 0;
      let ageDays = 0;
      let short = false;
      let long = false;
      while (left > 0.00005 && lots.length > 0) {
        const lot = lots[0]!;
        const take = Math.min(lot.units, left);
        if (lot.cost === null || lot.costPerUnit === null) known = false;
        else {
          cost += lot.costPerUnit * take;
          lot.cost -= lot.costPerUnit * take;
        }
        if (lot.date !== OLD) {
          ageUnits += take;
          ageDays += take * daysBetween(lot.date, x.date);
        }
        if (args.holdingMonths !== null) {
          const isLong = lot.date === OLD || x.date > addMonthsIso(lot.date, args.holdingMonths);
          if (isLong) long = true;
          else short = true;
        }
        lot.units -= take;
        left -= take;
        if (lot.units < 0.00005) lots.shift();
      }
      realisedGain = known ? Math.abs(x.amount) - cost : null;
      if (args.holdingMonths !== null && (short || long))
        term = short && long ? 'mixed' : short ? 'short' : 'long';
      heldDays = ageUnits > 0 ? Math.round(ageDays / ageUnits) : null;
    }
    running = typeof x.balance === 'number' ? x.balance : Math.max(0, running + x.units);
    const costHeld = lots.reduce((a, l) => a + (l.cost ?? 0), 0);
    const valuePx = priceOn(x.date) ?? (x.nav && x.nav > 0 ? x.nav : null);
    rows.push({
      n: i + 1,
      id: x.id ?? null,
      date: x.date,
      kind: x.kind,
      label: LEDGER_KIND_LABEL[x.kind] ?? 'Other',
      group,
      units: x.units,
      nav: price,
      navBasis: x.nav && x.nav > 0 ? 'statement' : price !== null ? 'published' : null,
      amount: x.units < 0 ? -Math.abs(x.amount) : Math.abs(x.amount),
      balance: running,
      costHeld,
      valueAfter: valuePx !== null ? running * valuePx : null,
      unitsLeft: null,
      valueNow: null,
      gainNow: null,
      gainNowPct: null,
      realisedGain,
      term,
      heldDays,
      longTermOn:
        x.units > 0 && args.holdingMonths !== null
          ? addMonthsIso(x.date, args.holdingMonths)
          : null,
      source: x.source ?? null,
      description: x.description ?? null,
      year: x.date.slice(0, 4),
      fy: fyOf(x.date),
    });
  });
  // what each purchase that is still held is worth now
  for (const lot of lots) {
    const r = rows[lot.row];
    if (!r || lot.units <= 0.00005) continue;
    r.unitsLeft = lot.units;
    r.heldDays = daysBetween(r.date, args.today);
    if (args.navNow !== null) {
      r.valueNow = lot.units * args.navNow;
      if (lot.cost !== null && lot.cost > 0) {
        r.gainNow = r.valueNow - lot.cost;
        r.gainNowPct = r.gainNow / lot.cost;
      }
    }
  }
  return rows;
}

export interface LedgerTotals {
  lines: number;
  boughtAmount: number;
  boughtUnits: number;
  soldAmount: number;
  soldUnits: number;
  sipAmount: number;
  sipCount: number;
  oneOffAmount: number;
  /** gain booked by the sales that could be worked out */
  realisedGain: number;
  salesUnknown: number;
  firstOn: string | null;
  lastOn: string | null;
}

export function ledgerTotals(rows: LedgerRow[]): LedgerTotals {
  const tot: LedgerTotals = {
    lines: rows.length,
    boughtAmount: 0,
    boughtUnits: 0,
    soldAmount: 0,
    soldUnits: 0,
    sipAmount: 0,
    sipCount: 0,
    oneOffAmount: 0,
    realisedGain: 0,
    salesUnknown: 0,
    firstOn: rows[0]?.date ?? null,
    lastOn: rows[rows.length - 1]?.date ?? null,
  };
  for (const r of rows) {
    if (r.group === 'buy') {
      tot.boughtAmount += r.amount;
      tot.boughtUnits += r.units;
      if (r.kind === 'sip') {
        tot.sipAmount += r.amount;
        tot.sipCount += 1;
      } else if (r.kind === 'purchase' || r.kind === 'other') tot.oneOffAmount += r.amount;
    } else if (r.group === 'sell') {
      tot.soldAmount += -r.amount;
      tot.soldUnits += -r.units;
      if (r.realisedGain === null) tot.salesUnknown += 1;
      else tot.realisedGain += r.realisedGain;
    }
  }
  return tot;
}

// ------------------------------------------------------------------------------------------------
// The table: filter, sort, export
// ------------------------------------------------------------------------------------------------
export interface LedgerFilter {
  /** a key of LEDGER_TYPES */
  type: string;
  /** a calendar year, a financial year ("2025-26") or 'all' */
  year: string;
  q: string;
}

export const NO_LEDGER_FILTER: LedgerFilter = { type: 'all', year: 'all', q: '' };

export type LedgerSortKey = 'date' | 'amount' | 'units' | 'nav' | 'balance' | 'label';

/** The years the rows touch, newest first: calendar years and financial years kept apart by their form ("2025" or "2025-26"). */
export function ledgerYears(rows: { year: string; fy: string }[], kind: 'calendar' | 'financial') {
  return [...new Set(rows.map((r) => (kind === 'calendar' ? r.year : r.fy)))].sort().reverse();
}

export function filterLedger<R extends LedgerRow & { fund?: string; owner?: string }>(
  rows: R[],
  f: LedgerFilter,
): R[] {
  const kinds = LEDGER_TYPES.find((x) => x.key === f.type)?.kinds ?? [];
  const q = f.q.trim().toLowerCase();
  return rows.filter((r) => {
    if (kinds.length > 0 && !kinds.includes(r.kind)) return false;
    if (f.year !== 'all' && r.year !== f.year && r.fy !== f.year) return false;
    if (q) {
      const hay =
        `${r.date} ${r.label} ${r.description ?? ''} ${r.source ?? ''} ${r.fund ?? ''} ${r.owner ?? ''} ${Math.abs(r.amount).toFixed(2)} ${r.units}`.toLowerCase();
      if (!q.split(/\s+/).every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function sortLedger<R extends LedgerRow>(rows: R[], key: LedgerSortKey, dir: 1 | -1): R[] {
  const val = (r: R): string | number => {
    switch (key) {
      case 'amount':
        return Math.abs(r.amount);
      case 'units':
        return Math.abs(r.units);
      case 'nav':
        return r.nav ?? -1;
      case 'balance':
        return r.balance ?? -1;
      case 'label':
        return r.label;
      default:
        return r.date;
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c =
      typeof x === 'string' && typeof y === 'string'
        ? x.localeCompare(y)
        : (x as number) - (y as number);
    return (c || a.n - b.n) * dir;
  });
}

/** The rows of the CSV file: a header, then one line per ledger row, with plain numbers (no symbols or grouping). */
export function ledgerExportRows(
  rows: (LedgerRow & { fund?: string; owner?: string })[],
  withFund: boolean,
): string[][] {
  const head = [
    'Date',
    ...(withFund ? ['Person', 'Fund'] : []),
    'Type',
    'Units',
    'Price per unit',
    'Amount (INR)',
    'Units held after',
    'Cost of units held (INR)',
    'Value of units held (INR)',
    'Gain booked (INR)',
    'Source',
    'Description',
  ];
  const n = (v: number | null, d = 2) => (v === null ? '' : v.toFixed(d));
  return [
    head,
    ...rows.map((r) => [
      r.date,
      ...(withFund ? [r.owner ?? '', r.fund ?? ''] : []),
      r.label,
      n(r.units, 3),
      n(r.nav, 4),
      n(r.amount),
      n(r.balance, 3),
      n(r.costHeld),
      n(r.valueAfter),
      n(r.realisedGain),
      r.source ?? '',
      r.description ?? '',
    ]),
  ];
}
