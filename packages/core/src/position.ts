/**
 * What the household held on any day, rebuilt from what is on file: `positionAsOf(input, date)`, `netWorthAsOf`, and the values every
 * period figure is worked out from. Each kind of holding has ONE value-on-a-date rule, in the registry `VALUERS` (keyed by asset type),
 * and today is just another date for it, so a figure for today and a figure for a past day can never be worked out two ways.
 *
 * How each kind is valued on a date `D`, and what the figure is called (its basis):
 *  - Savings and cash (INR): the last balance recorded on or before D, moved forward to D at the rate the account earns, after the tax
 *    taken at source (the account's own rate, else the rate list for its bank, kind and balance slab, else the assumed rate in
 *    Settings). Basis `rate` ("estimated from the balance recorded on <date>"), or `recorded` on the day of the record. The rate the
 *    records themselves imply is worked out as a pointer only (`observedAnnualRate`): money added or taken out is in those balances.
 *  - Fixed deposit: from its terms, accrued to D at the rate that takes the principal to the bank's maturity amount when that is on file
 *    (`fdEffectiveRate`, basis `bank_amount`), else at the stated rate (basis `terms`). Held from its booking date until the day it was
 *    paid out or closed, else until its maturity date: after that it is not counted (the money went somewhere else).
 *  - Mutual fund: the units held on D (every ledger line up to D, and the units held before the first line) times the price on or
 *    just before D (basis `units_nav`); without a ledger, the units on file times the price; without units, the last statement value
 *    or recorded value moved with the price (`nav_scaled`, estimated); last of all the value copied from the monthly sheet (`sheet`,
 *    estimated). A day before the fund began, it is not held.
 *  - Foreign balances and holdings: the native amount last recorded times the rate of that currency on D (`fx`), so a move in the
 *    exchange rate counts, and says so.
 *  - Shares, property, pension accounts, money lent, held by others, other: the last value recorded on or before D, held flat
 *    (`recorded`), unless Settings gives a yearly growth for the kind, then moved on at that rate (`assumed`).
 *  - Insurance cover is never wealth. A gifted holding was never counted.
 * Where there is no record on or before D the holding has no value that day (`no_data`), which is not the same as zero.
 *
 * Pure: no I/O. The loaders (packages/data) build the input; period figures are worked out in `positionGains`.
 */
import { exDate } from './explain';
import { daysBetween, fdEffectiveRate, fdValueOn, type Compounding } from './fd';
import { sumExact } from './money';
import { liquidityOf, type AssetType, type Liquidity } from './networth';
import {
  emptyCell,
  periodGains,
  periodWindows,
  type ClassPeriod,
  type DepositTerms,
  type FundHolding,
  type GainClass,
  type PeriodGains,
  type PeriodWindow,
  type SavingsAccount,
  type Span,
} from './period-gains';
import { addDaysIso } from './harvest-lots';

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const span = (from: string, to: string) => daysBetween(utc(from), utc(to));

/** The reference a fund value copied from the monthly sheet is stored with (the history importer writes it): kept only to check against. */
export const SHEET_FUND_REF = 'histfund:';

export type ValueBasis =
  | 'recorded'
  | 'terms'
  | 'bank_amount'
  | 'rate'
  | 'units_nav'
  | 'nav_scaled'
  | 'sheet'
  | 'fx'
  | 'assumed';

/** Whether a holding had a value on a day: held, not yet bought, gone, or no record to work it out from. */
export type HoldingState = 'held' | 'not_yet' | 'ended' | 'no_data';

export const BASIS_LABEL: Record<ValueBasis, string> = {
  recorded: 'recorded',
  terms: 'calculated from the deposit terms',
  bank_amount: 'calculated from the deposit terms and the bank’s maturity amount',
  rate: 'estimated from the last balance and its rate',
  units_nav: 'units held times the price',
  nav_scaled: 'estimated: the last value moved with the price',
  sheet: 'estimated: the value in the monthly sheet',
  fx: 'native amount times the exchange rate',
  assumed: 'assumed growth from Settings',
};

export const classOfType = (t: AssetType): GainClass =>
  t === 'fixed_deposit'
    ? 'fd'
    : t === 'mutual_fund'
      ? 'funds'
      : t === 'bank_account'
        ? 'cash'
        : 'others';

// ------------------------------------------------------------------------------------------------
// Input
// ------------------------------------------------------------------------------------------------
/** A value on file for a day: native amount, the currency, and the rate to rupees recorded with it (foreign balances). */
export interface PosRecord {
  date: string;
  amount: number;
  currency: string;
  fxRate: number | null;
  /** the value copied from the monthly sheet to check a fund against: used only when nothing better is on file */
  sheet?: boolean;
}

export interface PosDeposit {
  principal: number;
  rate: number;
  bookedOn: string;
  maturityOn: string;
  compounding: Compounding;
  bankMaturityAmount: number | null;
  /** the day it left (paid out or closed), when known */
  endedOn: string | null;
}

export interface PosFund {
  /** units bought (positive) or sold (negative) in the order they happened, with the units held before the first line as the first one */
  txns: { date: string; units: number; amount: number; estimated: boolean }[];
  /** prices, oldest first */
  navs: { date: string; nav: number }[];
  /** the unit count on file and the day it was counted */
  units: { units: number; asOf: string } | null;
  /** values taken from statements, oldest first */
  snapshots: { date: string; value: number }[];
  /** money put in (positive) and taken out (negative): the statement's, or (estimated) rebuilt from the plan */
  flows: { date: string; amount: number }[];
  hasStatement: boolean;
  /** the first day the fund's figures rest on estimates (no statement, or units assumed from a SIP plan); null when exact */
  estimatedSince: string | null;
}

export interface PositionAsset {
  assetId: string;
  ownerId: string;
  type: AssetType;
  status: string;
  name: string;
  currency: string;
  /** a savings account's yearly rate: its own, the rate list's, and the tax at source if its own is set (all decimals, null = not set) */
  rate: { own: number | null; listed: number | null; tds: number | null };
  /** values on file, oldest first (the later entry wins on one day) */
  records: PosRecord[];
  fd: PosDeposit | null;
  fund: PosFund | null;
}

export interface PositionConfig {
  today: string;
  savingsRate: number;
  tdsRate: number;
  navGapDays: number;
  /** points a year: the rate the records imply is flagged beyond this; the bank-amount rate is used within this of the stated one */
  rateGap: number;
  growth: { property: number; retirement: number; other: number };
  /** INR per unit of each foreign currency, by day, oldest first */
  fx: Record<string, { date: string; rate: number }[]>;
}

/** What the household's own books say a holding is worth today (net worth), for the holdings whose today needs more than a date. */
export interface CurrentValue {
  value: number;
  /** counted in net worth today */
  counted: boolean;
}

export interface PositionInput {
  assets: PositionAsset[];
  config: PositionConfig;
  /** today's figure per holding as net worth has it (SIP instalments since a fund's last record, today's exchange rate); used for `today` only */
  current?: Record<string, CurrentValue>;
}

// ------------------------------------------------------------------------------------------------
// Output
// ------------------------------------------------------------------------------------------------
export interface RateInfo {
  used: number;
  source: 'account' | 'rates_list' | 'assumed' | 'bank_amount' | 'stated';
  /** the yearly rate the recorded balances grow at, a pointer only */
  observed: number | null;
  /** the observed rate differs from the one used by more than the gap in Settings */
  differs: boolean;
}

export interface ValuedHolding {
  assetId: string;
  ownerId: string;
  type: AssetType;
  cls: GainClass;
  name: string;
  state: HoldingState;
  /** rupees; null with no data */
  value: number | null;
  basis: ValueBasis | null;
  /** worked out from a rate, a price move, a plan or an assumption and not read from a record of that day */
  estimated: boolean;
  /** the date of the record the value is built from */
  asOf: string | null;
  note: string;
  rate: RateInfo | null;
}

const none = (
  a: PositionAsset,
  state: HoldingState,
  note: string,
  value: number | null = state === 'no_data' ? null : 0,
): ValuedHolding => ({
  assetId: a.assetId,
  ownerId: a.ownerId,
  type: a.type,
  cls: classOfType(a.type),
  name: a.name,
  state,
  value,
  basis: null,
  estimated: false,
  asOf: null,
  note,
  rate: null,
});

const got = (
  a: PositionAsset,
  value: number,
  basis: ValueBasis,
  asOf: string | null,
  estimated: boolean,
  note: string,
  rate: RateInfo | null = null,
): ValuedHolding => ({
  assetId: a.assetId,
  ownerId: a.ownerId,
  type: a.type,
  cls: classOfType(a.type),
  name: a.name,
  state: 'held',
  value,
  basis,
  estimated,
  asOf,
  note,
  rate,
});

// ------------------------------------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------------------------------------
/** The last element with `date <= d` of a list sorted by date; binary search. */
export function lastOnOrBefore<T extends { date: string }>(list: T[], d: string): T | null {
  let lo = 0;
  let hi = list.length - 1;
  let best: T | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.date <= d) {
      best = list[mid]!;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return best;
}

/** One record per day (the later entry wins), oldest first, the sheet's own fund values left out unless asked for. */
function dayRecords(records: PosRecord[], sheet = false): PosRecord[] {
  const byDay = new Map<string, PosRecord>();
  for (const r of records) if (!!r.sheet === sheet) byDay.set(r.date, r);
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const niceIso = exDate;

/**
 * The yearly rate the recorded balances of a savings account grow at: for every two balances a month or more apart where the balance
 * did not fall, the growth over the days between, as a yearly figure; the middle one of them. Money added or taken out is part of those
 * balances, so this is a pointer to compare with the rate used, never a figure to value anything with. Null when no two balances
 * qualify.
 */
export function observedAnnualRate(
  balances: { date: string; amount: number }[],
  minDays = 28,
): number | null {
  const recs = [...balances].sort((a, b) => a.date.localeCompare(b.date));
  const rates: number[] = [];
  for (let k = 1; k < recs.length; k++) {
    const a = recs[k - 1]!;
    const b = recs[k]!;
    const days = span(a.date, b.date);
    if (days < minDays || !(a.amount > 0) || b.amount < a.amount) continue;
    rates.push(((b.amount - a.amount) / a.amount) * (365 / days));
  }
  if (rates.length === 0) return null;
  rates.sort((x, y) => x - y);
  const mid = rates.length >> 1;
  return rates.length % 2 ? rates[mid]! : (rates[mid - 1]! + rates[mid]!) / 2;
}

/** The rate a savings account is valued at, and where it comes from. */
export function savingsRateOf(a: PositionAsset, c: PositionConfig): RateInfo & { tds: number } {
  const own = a.rate.own;
  const listed = a.rate.listed;
  const used = Math.max(0, own ?? listed ?? c.savingsRate);
  const source: RateInfo['source'] =
    own !== null ? 'account' : listed !== null ? 'rates_list' : 'assumed';
  const observed = observedAnnualRate(
    dayRecords(a.records).map((r) => ({ date: r.date, amount: r.amount })),
  );
  const sane = observed !== null && observed >= 0 && observed <= 0.5;
  return {
    used,
    source,
    observed: sane ? observed : null,
    differs: sane && Math.abs(observed! - used) > c.rateGap,
    tds: a.rate.tds ?? c.tdsRate,
  };
}

/** The exchange rate of a currency on a day: the last on file on or before it; before the first, the rate recorded with the balance. */
function fxOn(
  c: PositionConfig,
  currency: string,
  on: string,
  anchor: number | null,
): number | null {
  const hit = lastOnOrBefore(c.fx[currency] ?? [], on);
  return hit ? hit.rate : anchor;
}

// ------------------------------------------------------------------------------------------------
// The valuers
// ------------------------------------------------------------------------------------------------
type Valuer = (
  a: PositionAsset,
  on: string,
  c: PositionConfig,
  cur?: CurrentValue,
) => ValuedHolding;

/** Whether the status keeps a holding counted: the same two the net worth counts. */
const isCountedStatus = (s: string) => s === 'active' || s === 'stopped';

/** A holding that is no longer held: its last record is the last day it counts (we do not know the day it was closed). */
function endedAfterLastRecord(a: PositionAsset, on: string): ValuedHolding | null {
  if (isCountedStatus(a.status)) return null;
  const last = a.records
    .filter((r) => !r.sheet)
    .map((r) => r.date)
    .sort()
    .pop();
  if (last === undefined) return none(a, 'ended', `${a.status}, with no record`);
  return on > last
    ? none(a, 'ended', `no longer held (${a.status}); last recorded ${niceIso(last)}`)
    : null;
}

const valueSavings: Valuer = (a, on, c, cur) => {
  if (on >= c.today && cur) {
    // today is whatever net worth has (a deposit-style account never needs more than the formula below, but one source keeps them equal)
    return cur.counted
      ? got(a, cur.value, 'rate', null, true, 'net worth today')
      : none(a, 'ended', 'not counted today');
  }
  const ended = endedAfterLastRecord(a, on);
  if (ended) return ended;
  const recs = dayRecords(a.records);
  const rec = lastOnOrBefore(recs, on);
  if (!rec) return none(a, 'no_data', 'no balance recorded on or before this day');
  const info = savingsRateOf(a, c);
  const days = Math.max(0, span(rec.date, on));
  const value = rec.amount + (rec.amount * info.used * (1 - info.tds) * days) / 365;
  const rate: RateInfo = {
    used: info.used,
    source: info.source,
    observed: info.observed,
    differs: info.differs,
  };
  return days === 0
    ? got(a, rec.amount, 'recorded', rec.date, false, `recorded on ${niceIso(rec.date)}`, rate)
    : got(
        a,
        value,
        'rate',
        rec.date,
        true,
        `estimated from the balance recorded on ${niceIso(rec.date)}, at ${(info.used * 100).toFixed(2)}% a year`,
        rate,
      );
};

/** When a deposit left: the day it was paid out or closed, else its maturity date. */
export const depositEnd = (d: PosDeposit): string => d.endedOn ?? d.maturityOn;

/** The rate a deposit is accrued at, and where it comes from. */
export function depositRateOf(d: PosDeposit, c: Pick<PositionConfig, 'rateGap'>) {
  return fdEffectiveRate({
    principal: d.principal,
    annualRate: d.rate,
    bookedOn: utc(d.bookedOn),
    maturityOn: utc(d.maturityOn),
    compounding: d.compounding,
    bankMaturityAmount: d.bankMaturityAmount,
    maxGap: c.rateGap,
  });
}

const valueDeposit: Valuer = (a, on, c) => {
  const d = a.fd;
  if (!d || !(d.principal > 0)) return none(a, 'no_data', 'no deposit terms on file');
  if (a.status === 'gifted') return none(a, 'ended', 'gifted');
  if (on < d.bookedOn) return none(a, 'not_yet', `booked on ${niceIso(d.bookedOn)}`);
  const end = depositEnd(d);
  // a deposit that "left" before it was booked is bad data: it never counted
  if (end <= d.bookedOn) return none(a, 'ended', 'ended on or before its booking date');
  if (on >= end)
    return none(a, 'ended', `${d.endedOn ? 'paid out or closed' : 'matured'} on ${niceIso(end)}`);
  const eff = depositRateOf(d, c);
  const value = fdValueOn({
    principal: d.principal,
    annualRate: eff.rate,
    bookedOn: utc(d.bookedOn),
    asOf: utc(on),
    maturityOn: utc(d.maturityOn),
    compounding: d.compounding,
  });
  return got(
    a,
    value,
    eff.from === 'bank_amount' ? 'bank_amount' : 'terms',
    d.bookedOn,
    false,
    eff.from === 'bank_amount'
      ? `at ${(eff.rate * 100).toFixed(2)}% (from the bank’s maturity amount)`
      : `at ${(eff.rate * 100).toFixed(2)}% (the rate on the deposit)`,
    { used: eff.rate, source: eff.from, observed: null, differs: false },
  );
};

/** Units held on a day from the ledger lines (oldest first), and whether any assumed line is among them. */
function unitsOn(f: PosFund, on: string): { units: number; estimated: boolean; lines: number } {
  let units = 0;
  let estimated = false;
  let lines = 0;
  for (const t of f.txns) {
    if (t.date > on) break;
    units += t.units;
    lines++;
    if (t.estimated) estimated = true;
  }
  return { units, estimated, lines };
}

/** The price on or just before a day, if there is one inside the gap Settings allows. */
function navOn(f: PosFund, on: string, gapDays: number) {
  const n = lastOnOrBefore(f.navs, on);
  return n && span(n.date, on) <= gapDays ? n : null;
}

const valueFund: Valuer = (a, on, c, cur) => {
  if (on >= c.today && cur)
    return cur.counted
      ? got(a, cur.value, 'units_nav', null, false, 'net worth today')
      : none(a, 'ended', 'not counted today');
  const f = a.fund;
  const rate = null;
  if (a.status === 'gifted') return none(a, 'ended', 'gifted');
  if (f && f.txns.length > 0 && f.txns[0]!.date <= on) {
    const u = unitsOn(f, on);
    if (u.units <= 1e-6) {
      const last = f.txns[f.txns.length - 1]!;
      return on >= last.date
        ? none(a, 'ended', 'every unit sold')
        : none(a, 'not_yet', 'no units held yet');
    }
    const nav = navOn(f, on, c.navGapDays);
    if (nav)
      return got(
        a,
        u.units * nav.nav,
        'units_nav',
        nav.date,
        u.estimated || (f.estimatedSince !== null && on >= f.estimatedSince),
        `${u.units.toFixed(3)} units at ${nav.nav.toFixed(4)} on ${niceIso(nav.date)}`,
        rate,
      );
  }
  // no ledger for the day: the units on file, then a statement value, then a recorded value, then the sheet's
  if (f && f.txns.length === 0 && f.units && f.units.asOf <= on) {
    const nav = navOn(f, on, c.navGapDays);
    if (nav)
      return got(
        a,
        f.units.units * nav.nav,
        'units_nav',
        nav.date,
        true,
        `${f.units.units.toFixed(3)} units on file at ${nav.nav.toFixed(4)} on ${niceIso(nav.date)}`,
      );
  }
  const scaled = (r: { date: string; amount: number }, basis: 'nav_scaled' | 'sheet') => {
    const at = f ? navOn(f, r.date, c.navGapDays) : null;
    const now = f ? navOn(f, on, c.navGapDays) : null;
    if (at && now && at.nav > 0 && r.date < on)
      return got(
        a,
        (r.amount * now.nav) / at.nav,
        basis,
        r.date,
        true,
        `the value on ${niceIso(r.date)} moved with the price to ${niceIso(now.date)}`,
      );
    return got(
      a,
      r.amount,
      basis === 'sheet' ? 'sheet' : 'nav_scaled',
      r.date,
      r.date !== on || basis === 'sheet',
      `the value recorded on ${niceIso(r.date)}`,
    );
  };
  const snap = f ? lastOnOrBefore(f.snapshots, on) : null;
  const recs = dayRecords(a.records);
  const rec = lastOnOrBefore(recs, on);
  const best = [
    snap ? { date: snap.date, amount: snap.value } : null,
    rec ? { date: rec.date, amount: rec.amount } : null,
  ]
    .filter((x): x is { date: string; amount: number } => x !== null)
    .sort((x, y) => y.date.localeCompare(x.date))[0];
  if (best) return scaled(best, 'nav_scaled');
  const sheet = lastOnOrBefore(dayRecords(a.records, true), on);
  if (sheet) return scaled(sheet, 'sheet');
  const first = [
    f?.txns[0]?.date,
    ...a.records.map((r) => r.date),
    ...(f ? f.snapshots.map((s) => s.date) : []),
  ]
    .filter((x): x is string => !!x)
    .sort()[0];
  return first && first > on
    ? none(a, 'not_yet', `first record is from ${niceIso(first)}`)
    : none(a, 'no_data', 'no units or value on file');
};

/** Foreign holdings: the native amount last recorded times the rate of that day. */
function valueForeign(
  a: PositionAsset,
  on: string,
  c: PositionConfig,
  cur?: CurrentValue,
): ValuedHolding {
  if (on >= c.today && cur)
    return cur.counted
      ? got(a, cur.value, 'fx', null, true, 'net worth today')
      : none(a, 'ended', 'not counted today');
  if (a.status === 'gifted') return none(a, 'ended', 'gifted');
  const ended = endedAfterLastRecord(a, on);
  if (ended) return ended;
  const rec = lastOnOrBefore(dayRecords(a.records), on);
  if (!rec) return none(a, 'no_data', 'no balance recorded on or before this day');
  const rate = fxOn(c, a.currency, on, rec.fxRate);
  if (rate === null || !(rate > 0)) return none(a, 'no_data', `no ${a.currency} exchange rate`);
  return got(
    a,
    rec.amount * rate,
    'fx',
    rec.date,
    true,
    `${a.currency} ${rec.amount.toLocaleString('en-IN')} at ₹${rate.toFixed(3)} (balance recorded ${niceIso(rec.date)})`,
  );
}

const growthOf = (a: PositionAsset, c: PositionConfig): number =>
  a.type === 'property'
    ? c.growth.property
    : a.type === 'nps' || a.type === 'ulip'
      ? c.growth.retirement
      : c.growth.other;

/** Shares, property, pension accounts, money lent, held by others, other: the value recorded, flat, or moved on at the growth Settings assumes. */
function valueFlat(
  a: PositionAsset,
  on: string,
  c: PositionConfig,
  cur?: CurrentValue,
): ValuedHolding {
  if (on >= c.today && cur)
    return cur.counted
      ? got(
          a,
          cur.value,
          growthOf(a, c) !== 0 ? 'assumed' : 'recorded',
          null,
          growthOf(a, c) !== 0,
          'net worth today',
        )
      : none(a, 'ended', 'not counted today');
  if (a.status === 'gifted') return none(a, 'ended', 'gifted');
  const ended = endedAfterLastRecord(a, on);
  if (ended) return ended;
  const rec = lastOnOrBefore(dayRecords(a.records), on);
  if (!rec) return none(a, 'no_data', 'nothing recorded on or before this day');
  const g = growthOf(a, c);
  const days = Math.max(0, span(rec.date, on));
  if (g === 0 || days === 0)
    return got(
      a,
      rec.amount,
      'recorded',
      rec.date,
      false,
      `recorded on ${niceIso(rec.date)}, held flat`,
    );
  return got(
    a,
    rec.amount * Math.pow(1 + g, days / 365),
    'assumed',
    rec.date,
    true,
    `recorded on ${niceIso(rec.date)}, moved on at the ${(g * 100).toFixed(1)}% a year assumed in Settings`,
  );
}

const valueNothing: Valuer = (a) => none(a, 'ended', 'insurance cover is never wealth');

/** The one value-on-a-date rule for each kind of holding. */
export const VALUERS: Record<AssetType, Valuer> = {
  bank_account: valueSavings,
  fixed_deposit: valueDeposit,
  mutual_fund: valueFund,
  stock: valueFlat,
  receivable: valueFlat,
  policy: valueNothing,
  property: valueFlat,
  ulip: valueFlat,
  nps: valueFlat,
  third_party_held: valueFlat,
  other: valueFlat,
};

/** What one holding was worth on a day. */
export function valueOn(
  a: PositionAsset,
  on: string,
  c: PositionConfig,
  cur?: Record<string, CurrentValue>,
): ValuedHolding {
  const today = cur && on >= c.today ? cur[a.assetId] : undefined;
  if (a.currency !== 'INR' && a.type !== 'fixed_deposit' && a.type !== 'policy')
    return valueForeign(a, on, c, today);
  return VALUERS[a.type](a, on, c, today);
}

// ------------------------------------------------------------------------------------------------
// A day's position
// ------------------------------------------------------------------------------------------------
export interface DayPosition {
  date: string;
  holdings: ValuedHolding[];
  /** net worth on that day: the holdings held, at their value */
  total: number;
  investable: number;
  byOwner: Record<string, number>;
  byType: Partial<Record<AssetType, number>>;
  byLiquidity: Record<Liquidity, number>;
  byClass: Record<GainClass, number>;
  /** holdings counted that day */
  counted: number;
  /** holdings that could not be valued (no record on or before the day) */
  noData: number;
  /** holdings counted whose value rests on a rate, a price move or an assumption */
  estimatedCount: number;
  /** of the total, the part that rests on one */
  estimatedValue: number;
  /** the date of the newest record any value is built from */
  latestRecordedAsOf: string | null;
}

/** True when a holding's value counts toward net worth on its day. */
export const isHeld = (h: ValuedHolding) =>
  h.state === 'held' && h.value !== null && liquidityOf(h.type) !== null;

export function positionAsOf(input: PositionInput, on: string): DayPosition {
  const holdings = input.assets.map((a) => valueOn(a, on, input.config, input.current));
  const counted = holdings.filter(isHeld);
  const sum = (list: ValuedHolding[]) => sumExact(list.map((h) => h.value!));
  const group = <K extends string>(key: (h: ValuedHolding) => K) => {
    const m = new Map<K, ValuedHolding[]>();
    for (const h of counted) m.set(key(h), [...(m.get(key(h)) ?? []), h]);
    return Object.fromEntries([...m].map(([k, v]) => [k, sum(v)])) as Record<K, number>;
  };
  const byLiquidity: Record<Liquidity, number> = Object.assign(
    { liquid: 0, investable: 0, retirement: 0, illiquid: 0 },
    group((h) => liquidityOf(h.type)!),
  );
  const byClass: Record<GainClass, number> = Object.assign(
    { fd: 0, funds: 0, cash: 0, others: 0 },
    group((h) => h.cls),
  );
  const est = counted.filter((h) => h.estimated);
  return {
    date: on,
    holdings,
    total: sum(counted),
    investable: sumExact([byLiquidity.liquid, byLiquidity.investable]),
    byOwner: group((h) => h.ownerId),
    byType: group((h) => h.type) as Partial<Record<AssetType, number>>,
    byLiquidity,
    byClass,
    counted: counted.length,
    noData: holdings.filter((h) => h.state === 'no_data').length,
    estimatedCount: est.length,
    estimatedValue: est.length ? sum(est) : 0,
    latestRecordedAsOf:
      counted
        .map((h) => h.asOf)
        .filter((x): x is string => !!x)
        .sort()
        .pop() ?? null,
  };
}

/** Net worth on a day, rebuilt from what is on file. */
export const netWorthAsOf = (input: PositionInput, on: string): number =>
  positionAsOf(input, on).total;

/** The first day any holding has something on file (a deposit's booking, a balance, a fund's first line): where the history starts. */
export function dataStarts(input: PositionInput): string | null {
  const firsts: string[] = [];
  for (const a of input.assets) {
    if (a.status === 'gifted' || liquidityOf(a.type) === null) continue;
    const own = [
      a.fd?.bookedOn,
      ...a.records.filter((r) => !r.sheet).map((r) => r.date),
      a.fund?.txns[0]?.date,
      ...(a.fund?.snapshots ?? []).map((s) => s.date),
      ...a.records.filter((r) => r.sheet).map((r) => r.date),
    ].filter((x): x is string => !!x);
    if (own.length) firsts.push(own.sort()[0]!);
  }
  return firsts.sort()[0] ?? null;
}

/**
 * How much of the household a day is built from: of the holdings counted that day or today, how many had a value on it. A deposit
 * booked later and an account that was never open are not missing, they are simply not there yet; an account with no record before
 * the day is.
 */
export function coverageOn(input: PositionInput, on: string): { withValue: number; of: number } {
  const then = positionAsOf(input, on);
  const now = positionAsOf(input, input.config.today);
  const had = new Set(then.holdings.filter(isHeld).map((h) => h.assetId));
  const all = new Set([...had, ...now.holdings.filter(isHeld).map((h) => h.assetId)]);
  return { withValue: had.size, of: all.size };
}

// ------------------------------------------------------------------------------------------------
// Period figures
// ------------------------------------------------------------------------------------------------
/**
 * Foreign balances and every other kept-by-hand holding for a period: the value on its first and last day, and the gain it made. A gain
 * is only what the holding itself did: the move of the exchange rate on the native amount held, or the growth Settings assumes on the
 * value recorded. A new record is not a gain (money was added, taken out, or the value was corrected), so the gain of each stretch
 * between two records is worked out on the earlier one.
 */
export function recordedPeriod(
  assets: PositionAsset[],
  c: PositionConfig,
  w: Span,
  cur?: Record<string, CurrentValue>,
): ClassPeriod {
  let startValue = 0;
  let endValue = 0;
  let profit = 0;
  let any = false;
  let estimated = false;
  for (const a of assets) {
    const s = valueOn(a, w.from, c, cur);
    const e = valueOn(a, w.to, c, cur);
    if (isHeld(s)) {
      startValue += s.value!;
      any = true;
    }
    if (isHeld(e)) {
      endValue += e.value!;
      any = true;
    }
    if (w.days <= 0) continue;
    const recs = dayRecords(a.records);
    const foreign = a.currency !== 'INR';
    const g = foreign ? 0 : growthOf(a, c);
    if (!foreign && g === 0) continue;
    if (a.status === 'gifted') continue;
    recs.forEach((r, k) => {
      const lo = r.date > w.from ? r.date : w.from;
      const next = recs[k + 1]?.date;
      const hi = next !== undefined && next < w.to ? next : w.to;
      if (!(span(lo, hi) > 0)) return;
      if (foreign) {
        const a0 = fxOn(c, a.currency, lo, r.fxRate);
        const a1 = fxOn(c, a.currency, hi, r.fxRate);
        if (a0 && a1) {
          profit += r.amount * (a1 - a0);
          estimated = true;
        }
      } else {
        profit += r.amount * (Math.pow(1 + g, span(lo, hi) / 365) - 1);
        estimated = true;
      }
    });
  }
  return {
    ...emptyCell(),
    profit,
    pct: startValue > 0 ? profit / startValue : null,
    startValue,
    endValue,
    base: startValue,
    estimated: estimated && any,
    empty: !any && profit === 0,
  };
}

export interface PositionGainsInput {
  position: PositionInput;
  /** Settings: Home, "Last N days" */
  recentDays: number;
  /** the fund's value today per fund and the rest of what net worth says (see PositionInput.current) */
  fundValue?: Record<string, number>;
}

export interface HeadlineTile {
  /** 'today' (one day) or one of the six periods */
  key: 'today' | PeriodWindow['key'];
  label: string;
  /** the real first day of the period, and the first day the figures rest on */
  asked: string;
  from: string;
  to: string;
  /** the data starts after the real start of the period */
  clamped: boolean;
  /** the first day anything can be worked out for */
  dataStarts: string | null;
  /** rupees earned in the period: interest, price moves, exchange-rate moves, growth assumed; money put in or taken out is not in it */
  amount: number;
  /** of the money at work (the value at the start plus money added, less money taken out, each for the days it was there); null with none */
  pct: number | null;
  base: number;
  putIn: number;
  takenOut: number;
  estimated: boolean;
  empty: boolean;
  /** of the holdings counted then or now, how many had a value on the first day */
  coverage: { withValue: number; of: number };
  /** net worth on the first day and on the last, for the note "net worth moved by ... (money added or taken out is part of it)" */
  netWorth: { start: number; end: number; change: number };
}

export interface PositionGains {
  /** the periods per kind of holding and in total: the Profit by period table */
  periods: PeriodGains;
  /** the headline tiles: today, then the six periods, from the same figures */
  tiles: HeadlineTile[];
  dataStarts: string | null;
}

/** The deposit terms the period figures read: the rate it grows at, and whether it is still held today. */
export function depositsOf(input: PositionInput): DepositTerms[] {
  const c = input.config;
  return input.assets.flatMap((a) => {
    const d = a.fd;
    if (!d || a.status === 'gifted') return [];
    const eff = depositRateOf(d, c);
    const end = depositEnd(d);
    return [
      {
        assetId: a.assetId,
        principal: d.principal,
        rate: eff.rate,
        bookedOn: d.bookedOn,
        maturityOn: d.maturityOn,
        compounding: d.compounding,
        // held today when today is before the day it left
        held: c.today < end,
        endedOn: d.endedOn,
      },
    ];
  });
}

/** The savings accounts (INR) with the rate they earn and their balances. */
export function accountsOf(input: PositionInput): SavingsAccount[] {
  const c = input.config;
  return input.assets
    .filter((a) => a.type === 'bank_account' && a.status !== 'gifted')
    .map((a) => {
      const info = savingsRateOf(a, c);
      return {
        assetId: a.assetId,
        currency: a.currency,
        rate: info.used,
        tdsRate: info.tds,
        balances:
          a.currency === 'INR'
            ? dayRecords(a.records).map((r) => ({ date: r.date, amount: r.amount }))
            : [],
      };
    });
}

/**
 * Every day the period figures look at: the day before each period starts, its first day and its last day, for the periods and for
 * "today". A loader that cannot afford the whole price history reads prices around these days only.
 */
export function gainDays(today: string, recentDays: number, start: string | null): string[] {
  const ws = [
    ...periodWindows(today, recentDays, start, start),
    periodWindows(today, 1, start, start).find((w) => w.key === 'recent')!,
  ];
  return [...new Set([...fundDays(ws), ...ws.map((w) => w.from), ...ws.map((w) => w.to)])].sort();
}

/** Every day a fund must be valued on for these windows: the day before each starts and its last day. */
function fundDays(ws: Span[]): string[] {
  return [...new Set(ws.flatMap((w) => [addDaysIso(w.from, -1), w.through]))].sort();
}

/** The funds with their value on the days measured (units times price, or the best record) and their money in and out. */
export function fundsOf(input: PositionInput, days: string[]): FundHolding[] {
  const c = input.config;
  return input.assets
    .filter((a) => a.type === 'mutual_fund' && a.fund && a.status !== 'gifted')
    .map((a) => {
      const f = a.fund!;
      const now = valueOn(a, c.today, c, input.current);
      return {
        assetId: a.assetId,
        name: a.name,
        value: isHeld(now) ? now.value! : 0,
        points: days
          .filter((d) => d < c.today)
          .map((d) => ({ date: d, value: valueOn(a, d, c, input.current).value ?? 0 })),
        flows: f.flows,
        hasStatement: f.hasStatement,
        estimatedSince: f.estimatedSince,
      };
    });
}

/**
 * The one place the period figures of the household are worked out, for Home, the daily summary, the WhatsApp text and the tables:
 * each kind of holding is valued by its own rule (the registry above) at the start and end of the period and the gain is what the
 * holding earned, never a change of balance.
 *
 *  - fixed deposits: interest accrued in the period; a new deposit and a payout are money put in and taken out;
 *  - mutual funds: value at the end less value at the start less purchases plus sales;
 *  - savings and cash: the interest the balance earns at its rate (a deposit into or a withdrawal from the account is not a gain);
 *  - foreign balances: the move of the exchange rate on the amount held;
 *  - others: nothing, unless Settings assumes a growth for them.
 * A period that begins before the data does begins where the data does, and says so.
 */
export function positionGains(i: PositionGainsInput): PositionGains {
  const { position, recentDays } = i;
  const c = position.config;
  const today = c.today;
  const start = dataStarts(position);
  const deposits = depositsOf(position);
  const accounts = accountsOf(position);

  // the periods asked for, and the single day of "today"
  const windows = periodWindows(today, recentDays, start, start);
  const oneDay = periodWindows(today, 1, start, start).find((w) => w.key === 'recent')!;
  const days = fundDays([...windows, oneDay]);
  const funds = fundsOf(position, days);

  const foreign = position.assets.filter(
    (a) => a.currency !== 'INR' && a.type === 'bank_account' && a.status !== 'gifted',
  );
  const rest = position.assets.filter(
    (a) =>
      classOfType(a.type) === 'others' && liquidityOf(a.type) !== null && a.status !== 'gifted',
  );
  const input = {
    today,
    recentDays,
    deposits,
    funds,
    accounts,
    othersValue: positionAsOf(position, today).byClass.others,
    clampFrom: start,
    foreignCash: (w: Span) => recordedPeriod(foreign, c, w, position.current),
    others: (w: Span) => recordedPeriod(rest, c, w, position.current),
  };
  const periods = periodGains(input);
  const dayGains = periodGains({ ...input, recentDays: 1 });
  const todayCell = dayGains.total.cells.recent;
  const nw = new Map<string, number>();
  const nwOn = (d: string) => {
    if (!nw.has(d)) nw.set(d, positionAsOf(position, d).total);
    return nw.get(d)!;
  };
  const tile = (key: HeadlineTile['key'], w: PeriodWindow, cell: ClassPeriod): HeadlineTile => ({
    key,
    label: key === 'today' ? 'Today' : w.label,
    asked: w.asked,
    from: w.from,
    to: w.to,
    clamped: w.clamped,
    dataStarts: start,
    amount: cell.profit,
    pct: cell.pct,
    base: cell.base,
    putIn: cell.putIn,
    takenOut: cell.takenOut,
    estimated: cell.estimated,
    empty: cell.empty,
    coverage: coverageOn(position, w.from),
    netWorth: { start: nwOn(w.from), end: nwOn(w.to), change: nwOn(w.to) - nwOn(w.from) },
  });
  return {
    periods,
    dataStarts: start,
    tiles: [
      tile(
        'today',
        dayGains.windows.find((w) => w.key === 'recent')!,
        todayCell,
      ),
      ...periods.windows.map((w) => tile(w.key, w, periods.total.cells[w.key])),
    ],
  };
}

/**
 * The words that say where a tile's period begins: "since 1 Apr 2026", or, when the data begins later than the period does,
 * "data starts 3 Mar 2025". Dates as "26 Oct 2026".
 */
export function sinceWords(t: Pick<HeadlineTile, 'asked' | 'from' | 'clamped' | 'key'>): string {
  if (t.key === 'today') return 'since yesterday';
  return t.clamped ? `data starts ${niceIso(t.from)}` : `since ${niceIso(t.asked)}`;
}

/** "71 of 100 holdings had a value then" – the coverage note under a tile. */
export function coverageWords(t: Pick<HeadlineTile, 'coverage'>): string {
  const { withValue, of } = t.coverage;
  if (of === 0) return 'no holding to measure';
  return withValue === of
    ? `all ${of} holdings had a value then`
    : `${withValue} of ${of} holdings had a value then`;
}
