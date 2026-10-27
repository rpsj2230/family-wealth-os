/**
 * The one place that works out what a holding earned in a stretch of time: the last day or N days, this month, this quarter, this
 * financial year, the last financial year, since the start. Home, the Deposits, Cash and Accounts overviews ("earned today"), the
 * interest by financial year in Reports and the Investments profit-and-loss all take their period figures from here or are tested to
 * agree with it. Worked out from the terms of each holding, never from saved snapshots of net worth. Money put in or taken out is not
 * profit; it is counted separately so a new deposit, a fund purchase or a payout never looks like a gain or a loss.
 *
 * Periods. A period runs from the start of its `from` day to the start of its `to` day (a period that ends today ends now, `to` =
 * today). `through` is its last day. A sum moved on any day from `from` to `through` is money put in or taken out in the period. So a
 * 30-day period spans 30 days of accrual, the last financial year ends where this one begins, and a deposit booked on 1 April is
 * money put in during the year that starts on 1 April.
 *
 * What each kind of holding is worth at a moment:
 *  - Fixed deposit: its value at the start of that day on its own terms (fdValueOn). The profit is the interest accrued in the period.
 *    A deposit booked inside the period starts at its principal on its booking date; one that left the class (paid out, closed,
 *    renewed) adds its interest up to the day it left, and the payout is money taken out, not profit. A renewal is a new deposit.
 *  - Mutual fund: its value on the last day before the period (units held then times the last price on or before it) and on its last
 *    day (today: the figure Investments shows), as `fundSeries` works them out. The profit is the change in value less net purchases
 *    in between. Sales are money taken out, so a gain already booked by selling is part of the profit of the period it was sold in. A
 *    fund with no statement is rebuilt from its plan, and marked estimated, as are units assumed from a SIP plan.
 *  - Savings and cash: the interest the recorded balance earns at the account's rate after the tax taken at source, the last recorded
 *    balance carried forward until the next record. Deposits into and withdrawals from the account are not profit. Always an
 *    estimate; the bank credits interest in lumps. Foreign-currency balances earn no gain here: an exchange rate is not interest.
 *  - Others (shares, property, money lent, held by others): no profit, only the value that was recorded.
 *
 * The per cent is of the money at work: the value at the start plus each sum put in for the days it was there (Modified Dietz), less
 * each sum taken out for the days it was gone. With no money moved that is exactly the value at the start. "Since the start" has no
 * value to start from, so a deposit or fund is measured against all the money put in. Pure; no I/O.
 */
import { daysBetween, fdValueOn, type Compounding } from './fd';
import { addDaysIso } from './harvest-lots';
import { fyBoundsOf, fyOf } from './tax';

export type GainPeriodKey = 'recent' | 'month' | 'quarter' | 'fy' | 'lastFy' | 'start';
export type GainClass = 'fd' | 'funds' | 'cash' | 'others';

export const GAIN_CLASSES: { key: GainClass; label: string }[] = [
  { key: 'fd', label: 'Fixed deposits' },
  { key: 'funds', label: 'Mutual funds' },
  { key: 'cash', label: 'Cash' },
  { key: 'others', label: 'Others' },
];

/** The word that marks a figure resting on an estimate, wherever it is shown. */
export const EST_MARK = 'est.';
export const EST_TITLE =
  'Estimate: worked out from interest rates, prices or a plan, not read from a bank or a fund statement';

const utc = (d: string) => new Date(`${d}T00:00:00Z`);
const span = (from: string, to: string) => daysBetween(utc(from), utc(to));

// ------------------------------------------------------------------------------------------------
// The calendar: the only definitions of where a month, a quarter and a financial year begin
// ------------------------------------------------------------------------------------------------
/** First day of the month a date falls in. */
export const monthStartOn = (date: string) => `${date.slice(0, 7)}-01`;

/** First day of the quarter a date falls in: 1 April, 1 July, 1 October or 1 January. */
export function quarterStartOn(date: string): string {
  const m = Number(date.slice(5, 7));
  const first = m >= 10 ? 10 : m >= 7 ? 7 : m >= 4 ? 4 : 1;
  return `${date.slice(0, 4)}-${String(first).padStart(2, '0')}-01`;
}

/** First day of the financial year a date falls in (India: 1 April). */
export const fyStartOn = (date: string): string =>
  fyBoundsOf(fyOf(date))?.from ?? `${date.slice(0, 4)}-04-01`;

export interface PeriodWindow {
  key: GainPeriodKey;
  /** "Last 30 days", "This month", ... */
  label: string;
  /** the first day of the period the figures rest on: the period starts at the start of this day. It is `asked` unless the data starts later. */
  from: string;
  /** the real first day of the period (1 April for the financial year); later `from` means the data begins after it */
  asked: string;
  /** the data starts after the real start of the period, so the figures begin where it does */
  clamped: boolean;
  /** where it ends: the start of this day, or today for a period that ends now */
  to: string;
  /** the last day inside the period, for words ("1 Apr to 31 Mar"); equals `to` for a period that ends today */
  through: string;
  /** days of accrual in the period */
  days: number;
}

/** Any stretch of days: the fields of a period that the figures are worked out from. */
export type Span = Pick<PeriodWindow, 'from' | 'to' | 'through' | 'days'>;

/** A stretch from the start of `from` to the start of `to`; `through` is its last day (the day before `to`). */
export const spanBetween = (from: string, to: string, through = addDaysIso(to, -1)): Span => ({
  from,
  to,
  through,
  days: Math.max(0, span(from, to)),
});

const make = (
  key: GainPeriodKey,
  label: string,
  from: string,
  to: string,
  through = to,
): PeriodWindow => ({
  key,
  label,
  from,
  asked: from,
  clamped: false,
  to,
  through,
  days: Math.max(0, span(from, to)),
});

/**
 * Starts a period no earlier than `clampFrom`, the first day anything can be worked out for ("data starts"). A period that ended
 * before then is left with no days. The real start stays in `asked`.
 */
function clampWindow(w: PeriodWindow, clampFrom: string | null | undefined): PeriodWindow {
  if (!clampFrom || w.key === 'start' || w.from >= clampFrom) return w;
  const from = clampFrom < w.to ? clampFrom : w.to;
  return { ...w, from, clamped: true, days: Math.max(0, span(from, w.to)) };
}

/** The last N days (N from Settings: Home, "Last N days"); one day is "earned today". */
export function recentWindow(today: string, recentDays: number): PeriodWindow {
  const days = Math.max(1, Math.round(recentDays));
  return make(
    'recent',
    `Last ${days} ${days === 1 ? 'day' : 'days'}`,
    addDaysIso(today, -days),
    today,
  );
}

/**
 * The six periods as of `today`. The length of the first comes from Settings (`recentDays`); the month, quarter and financial year
 * are calendar facts. `since` is the first day anything was held (null with nothing held): "since the start" begins on it.
 */
export function periodWindows(
  today: string,
  recentDays: number,
  since: string | null,
  clampFrom: string | null = null,
): PeriodWindow[] {
  const fyStart = fyStartOn(today);
  return [
    recentWindow(today, recentDays),
    make('month', 'This month', monthStartOn(today), today),
    make('quarter', 'This quarter', quarterStartOn(today), today),
    make('fy', 'This financial year', fyStart, today),
    make(
      'lastFy',
      'Last financial year',
      fyStartOn(addDaysIso(fyStart, -1)),
      fyStart,
      addDaysIso(fyStart, -1),
    ),
    make('start', 'Since the start', since ?? today, today),
  ].map((w) => clampWindow(w, clampFrom));
}

/** The days a fund is valued on to measure a period: the day before it starts and its last day. */
export const valueDays = (w: Span) => ({ open: addDaysIso(w.from, -1), close: w.through });

/** Every day a fund must be valued on for the periods, except for "since the start" (nothing was held before it). */
export function periodDates(today: string, recentDays: number): string[] {
  return [
    ...new Set(
      periodWindows(today, recentDays, null)
        .filter((w) => w.key !== 'start')
        .flatMap((w) => {
          const v = valueDays(w);
          return [v.open, v.close];
        }),
    ),
  ].sort();
}

// ------------------------------------------------------------------------------------------------
// The result for one kind of holding in one period
// ------------------------------------------------------------------------------------------------
export interface ClassPeriod {
  /** rupees earned in the period */
  profit: number;
  /** profit against the money at work; null when none was */
  pct: number | null;
  /** worth at the start of the period and at its end, of what was held then */
  startValue: number;
  endValue: number;
  /** money added in the period (a new deposit, a fund purchase) and money taken out (a payout, a sale) */
  putIn: number;
  takenOut: number;
  /** the money at work: the value at the start plus money put in and less money taken out, each for the part of the period it counts */
  base: number;
  /** some of the figure rests on an estimate: a rate, an assumed instalment, a plan */
  estimated: boolean;
  /** nothing was held in the period */
  empty: boolean;
}

interface Flow {
  date: string;
  /** money in positive, money out negative */
  amount: number;
}

function finish(
  w: Span,
  startValue: number,
  endValue: number,
  profit: number,
  flows: Flow[],
  estimated: boolean,
  baseOverride?: number,
): ClassPeriod {
  const putIn = flows.filter((f) => f.amount > 0).reduce((a, f) => a + f.amount, 0);
  const takenOut = flows.filter((f) => f.amount < 0).reduce((a, f) => a - f.amount, 0);
  const weighted = flows.reduce(
    (a, f) => a + (w.days > 0 ? (f.amount * span(f.date, w.to)) / w.days : 0),
    0,
  );
  const base = baseOverride ?? startValue + weighted;
  const empty = startValue === 0 && endValue === 0 && putIn === 0 && takenOut === 0 && profit === 0;
  return {
    profit,
    pct: base > 0 ? profit / base : null,
    startValue,
    endValue,
    putIn,
    takenOut,
    base,
    estimated: estimated && !empty,
    empty,
  };
}

/** A sum moved on `date` belongs to the period when the date is one of its days. */
const inside = (date: string, w: Span) => date >= w.from && date <= w.through;

// ------------------------------------------------------------------------------------------------
// Fixed deposits
// ------------------------------------------------------------------------------------------------
export interface DepositTerms {
  assetId: string;
  principal: number;
  /** decimal */
  rate: number;
  bookedOn: string;
  maturityOn: string;
  compounding: Compounding;
  /** still held today: a running deposit, counted in net worth (including one past its date that waits to be confirmed) */
  held: boolean;
  /** the day it left (paid out or closed), when known; the maturity date is assumed otherwise */
  endedOn?: string | null;
}

/** The day a deposit that is no longer held left the class, never later than today; null for a deposit still held. */
const leftOn = (d: DepositTerms, today: string): string | null =>
  d.held ? null : [d.endedOn ?? d.maturityOn, today].sort()[0]!;

const depositValueOn = (d: DepositTerms, on: string) =>
  fdValueOn({
    principal: d.principal,
    annualRate: Math.max(0, d.rate),
    bookedOn: utc(d.bookedOn),
    asOf: utc(on),
    maturityOn: utc(d.maturityOn),
    compounding: d.compounding,
  });

export function depositPeriod(deposits: DepositTerms[], w: Span, today: string): ClassPeriod {
  let start = 0;
  let end = 0;
  const flows: Flow[] = [];
  for (const d of deposits) {
    if (!(d.principal > 0)) continue;
    const left = leftOn(d, today);
    // a deposit that "left" before it was booked is bad data: it never counted
    if (left !== null && left <= d.bookedOn) continue;
    // held at the start of the period: booked before its first day and not yet paid out on it
    if (d.bookedOn < w.from && (left === null || left >= w.from))
      start += depositValueOn(d, w.from);
    // held at its end: booked by its last day and not paid out by it
    if (d.bookedOn <= w.through && (left === null || left > w.through))
      end += depositValueOn(d, w.to);
    if (inside(d.bookedOn, w)) flows.push({ date: d.bookedOn, amount: d.principal });
    if (left !== null && inside(left, w))
      flows.push({ date: left, amount: -depositValueOn(d, left) });
  }
  const net = flows.reduce((a, f) => a + f.amount, 0);
  return finish(w, start, end, end - start - net, flows, false);
}

// ------------------------------------------------------------------------------------------------
// Mutual funds
// ------------------------------------------------------------------------------------------------
export interface FundHolding {
  assetId: string;
  name: string;
  /** worth today, the figure Investments shows */
  value: number;
  /** worth on each day that is measured (see periodDates), oldest first, as the fund's own series works it out */
  points: { date: string; value: number }[];
  /** money put in (positive) and taken out (negative): the fund's own cash flows, from its statement or its plan */
  flows: Flow[];
  /** transactions of a fund statement are on file; without, the flows and values come from the plan */
  hasStatement: boolean;
  /** the first day the figures about this fund rest on estimates (no statement, or units assumed from a SIP plan); null when exact */
  estimatedSince: string | null;
}

/** What a fund was worth on a day: the last value on or before it, nothing before the first; today is the figure Investments shows. */
export function fundValueOnDay(f: FundHolding, day: string, today: string): number {
  if (day >= today) return f.value;
  let best: { date: string; value: number } | null = null;
  for (const p of f.points) if (p.date <= day && (!best || p.date >= best.date)) best = p;
  return best?.value ?? 0;
}

export function fundPeriod(funds: FundHolding[], w: Span, today: string): ClassPeriod {
  const { open, close } = valueDays(w);
  let start = 0;
  let end = 0;
  let estimated = false;
  const flows: Flow[] = [];
  for (const f of funds) {
    const a = fundValueOnDay(f, open, today);
    const b = fundValueOnDay(f, close, today);
    const moved = f.flows.filter((m) => inside(m.date, w) && m.amount !== 0);
    start += a;
    end += b;
    flows.push(...moved);
    if (
      f.estimatedSince !== null &&
      w.through >= f.estimatedSince &&
      (a > 0 || b > 0 || moved.length > 0)
    )
      estimated = true;
  }
  const net = flows.reduce((x, y) => x + y.amount, 0);
  return finish(w, start, end, end - start - net, flows, estimated);
}

// ------------------------------------------------------------------------------------------------
// Savings and cash
// ------------------------------------------------------------------------------------------------
export interface SavingsAccount {
  assetId: string;
  currency: string;
  /** annual rate on the balance (decimal): the account's own, else the rate list, else the assumed rate in Settings */
  rate: number;
  /** tax taken at source on the interest (decimal) */
  tdsRate: number;
  /** recorded balances; the last one on or before a day is the balance on that day */
  balances: { date: string; amount: number }[];
}

/** Balance and interest earned since the record it rests on, and the days it is carried for, in the period. */
function accountPeriod(a: SavingsAccount, w: Span) {
  const rec = new Map<string, number>();
  for (const b of a.balances) rec.set(b.date, b.amount);
  const recs = [...rec.entries()].sort(([x], [y]) => x.localeCompare(y));
  const net = Math.max(0, a.rate) * (1 - a.tdsRate);
  const at = (on: string) => {
    const hit = [...recs].reverse().find(([d]) => d <= on);
    return hit ? hit[1] + (hit[1] * net * span(hit[0], on)) / 365 : 0;
  };
  let interest = 0;
  let balanceDays = 0;
  recs.forEach(([d, amount], k) => {
    const lo = d > w.from ? d : w.from;
    const nextDate = recs[k + 1]?.[0];
    const hi = nextDate !== undefined && nextDate < w.to ? nextDate : w.to;
    const days = Math.max(0, span(lo, hi));
    interest += (Math.max(0, amount) * net * days) / 365;
    balanceDays += Math.max(0, amount) * days;
  });
  return { start: at(w.from), end: at(w.to), interest, balanceDays };
}

export function savingsPeriod(accounts: SavingsAccount[], w: Span): ClassPeriod {
  let start = 0;
  let end = 0;
  let profit = 0;
  let balanceDays = 0;
  for (const a of accounts) {
    // an exchange rate is not interest: a foreign balance earns nothing here
    if (a.currency !== 'INR') continue;
    const p = accountPeriod(a, w);
    start += p.start;
    end += p.end;
    profit += p.interest;
    balanceDays += p.balanceDays;
  }
  // deposits and withdrawals are not tracked, so the money at work is the average balance carried over the period
  const base = w.days > 0 ? balanceDays / w.days : start;
  return finish(w, start, end, profit, [], true, base);
}

// ------------------------------------------------------------------------------------------------
// Everything together
// ------------------------------------------------------------------------------------------------
export interface PeriodGainsInput {
  today: string;
  /** Settings: Home, "Last N days" */
  recentDays: number;
  deposits: DepositTerms[];
  funds: FundHolding[];
  accounts: SavingsAccount[];
  /** worth of the rest (shares, property, money lent, held by others...), at the value recorded */
  othersValue: number;
  /**
   * The first day anything can be worked out for ("data starts"). A period that begins earlier begins here instead, and says so
   * (`clamped`, `asked`). Left out, every period begins on its real first day.
   */
  clampFrom?: string | null;
  /** the rest, worked out per period from the records and any growth assumed (position.ts); without it they are held flat at `othersValue` */
  others?: (w: Span) => ClassPeriod;
  /** the move of foreign-currency balances with the exchange rate (position.ts); added to the cash figures */
  foreignCash?: (w: Span) => ClassPeriod;
}

export interface PeriodGainsRow {
  key: GainClass | 'total';
  label: string;
  cells: Record<GainPeriodKey, ClassPeriod>;
  /** the first day this kind of holding was held, where its "since the start" begins (null for Others) */
  since: string | null;
}

export interface PeriodGains {
  windows: PeriodWindow[];
  rows: PeriodGainsRow[];
  total: PeriodGainsRow;
  /** what the "est." marks rest on, in counts the page can put in words */
  basis: {
    /** funds with no statement: rebuilt from the plan */
    fundsFromPlan: number;
    /** funds with a statement whose ledger has instalments assumed from the SIP plan */
    fundsWithAssumed: number;
    /** foreign-currency accounts, left out of the cash figures */
    foreignAccounts: number;
    /** savings accounts with no recorded balance, so no interest could be worked out */
    accountsWithoutBalance: number;
    /** deposits no longer held, whose interest up to the day they left is still counted */
    depositsEnded: number;
    /** a deposit that left on a date that was not recorded, so its maturity date was used */
    depositsEndedGuessed: number;
  };
  /** the first day anything was held */
  since: string | null;
}

/** Two figures of one kind of holding side by side: their rupees add, and the per cent is of both bases together. */
export function addPeriods(a: ClassPeriod, b: ClassPeriod): ClassPeriod {
  if (b.empty) return a;
  if (a.empty) return b;
  const profit = a.profit + b.profit;
  const base = a.base + b.base;
  return {
    profit,
    pct: base > 0 ? profit / base : null,
    startValue: a.startValue + b.startValue,
    endValue: a.endValue + b.endValue,
    putIn: a.putIn + b.putIn,
    takenOut: a.takenOut + b.takenOut,
    base,
    estimated: a.estimated || b.estimated,
    empty: false,
  };
}

export const emptyCell = (): ClassPeriod => ({
  profit: 0,
  pct: null,
  startValue: 0,
  endValue: 0,
  putIn: 0,
  takenOut: 0,
  base: 0,
  estimated: false,
  empty: true,
});

export function periodGains(i: PeriodGainsInput): PeriodGains {
  const first = (dates: string[]) => dates.sort()[0] ?? null;
  const sinceOf = {
    fd: first(i.deposits.map((d) => d.bookedOn)),
    funds: first(i.funds.flatMap((f) => f.flows.map((m) => m.date))),
    cash: first(
      i.accounts.filter((a) => a.currency === 'INR').flatMap((a) => a.balances.map((b) => b.date)),
    ),
  };
  const since = first(Object.values(sinceOf).filter((d): d is string => d !== null));
  const clamp = i.clampFrom ?? null;
  const windows = periodWindows(i.today, i.recentDays, since, clamp);

  /**
   * One cell for every period. "Since the start" begins on the day that kind of holding was first held, not on the family's first
   * record, so a deposit made last year is not measured over the years a fund has run. With `againstPutIn` its per cent is of all
   * the money put in (there was no value at the start to measure against).
   */
  const byClass = (
    sinceDay: string | null,
    build: (w: PeriodWindow) => ClassPeriod,
    againstPutIn = false,
  ): Record<GainPeriodKey, ClassPeriod> =>
    Object.fromEntries(
      windows.map((w) => {
        if (w.key !== 'start') return [w.key, build(w)];
        const own = periodWindows(i.today, i.recentDays, sinceDay, clamp).find(
          (x) => x.key === 'start',
        )!;
        const cell = build(own);
        return [
          w.key,
          againstPutIn
            ? { ...cell, base: cell.putIn, pct: cell.putIn > 0 ? cell.profit / cell.putIn : null }
            : cell,
        ];
      }),
    ) as Record<GainPeriodKey, ClassPeriod>;
  const others = (w: PeriodWindow): ClassPeriod =>
    i.others
      ? i.others(w)
      : {
          ...emptyCell(),
          startValue: i.othersValue,
          endValue: i.othersValue,
          empty: !(i.othersValue > 0) || w.days === 0,
        };
  const rows: PeriodGainsRow[] = [
    {
      key: 'fd',
      label: 'Fixed deposits',
      since: sinceOf.fd,
      cells: byClass(sinceOf.fd, (w) => depositPeriod(i.deposits, w, i.today), true),
    },
    {
      key: 'funds',
      label: 'Mutual funds',
      since: sinceOf.funds,
      cells: byClass(sinceOf.funds, (w) => fundPeriod(i.funds, w, i.today), true),
    },
    {
      key: 'cash',
      label: 'Cash',
      since: sinceOf.cash,
      cells: byClass(sinceOf.cash, (w) => {
        const own = savingsPeriod(i.accounts, w);
        return i.foreignCash ? addPeriods(own, i.foreignCash(w)) : own;
      }),
    },
    { key: 'others', label: 'Others', since: null, cells: byClass(since, others) },
  ];

  const total: PeriodGainsRow = {
    key: 'total',
    label: 'Total',
    since,
    cells: byClass(since, (w) => {
      const parts = rows.map((r) => r.cells[w.key]);
      const sum = (f: (c: ClassPeriod) => number) => parts.reduce((a, c) => a + f(c), 0);
      const profit = sum((c) => c.profit);
      const base = sum((c) => c.base);
      return {
        profit,
        pct: base > 0 ? profit / base : null,
        startValue: sum((c) => c.startValue),
        endValue: sum((c) => c.endValue),
        putIn: sum((c) => c.putIn),
        takenOut: sum((c) => c.takenOut),
        base,
        estimated: parts.some((c) => c.estimated),
        empty: parts.every((c) => c.empty),
      };
    }),
  };

  return {
    windows,
    rows,
    total,
    since,
    basis: {
      fundsFromPlan: i.funds.filter((f) => !f.hasStatement).length,
      fundsWithAssumed: i.funds.filter((f) => f.hasStatement && f.estimatedSince !== null).length,
      foreignAccounts: i.accounts.filter((a) => a.currency !== 'INR').length,
      accountsWithoutBalance: i.accounts.filter(
        (a) => a.currency === 'INR' && a.balances.length === 0,
      ).length,
      depositsEnded: i.deposits.filter((d) => !d.held).length,
      depositsEndedGuessed: i.deposits.filter((d) => !d.held && !d.endedOn).length,
    },
  };
}
