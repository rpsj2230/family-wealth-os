/**
 * The capital and earnings ledger of the family: how much of today's net worth is the family's own money, how much is profit,
 * and what the money earned as a yearly rate. One function (`capitalLedger`) for Home, the e-mail, Reports and the history pages.
 *
 * For the family as a whole, money moved between its own holdings cancels out: a deposit funded from savings, maturity proceeds paid
 * into an account, a renewal, interest reinvested, a fund bought from savings all leave net worth unchanged. So over any stretch of
 * time:
 *
 *   change in net worth = earnings + money that came in from outside or went out of the family
 *
 * where earnings are worked out by the central engine from each holding's own rule (interest on savings and deposits, fund and share
 * gains, exchange-rate moves, growth assumed in Settings) plus confirmed income, less confirmed fees and taxes. The rest of the change
 * is outside money: what you confirmed (a salary transfer, a gift, money withdrawn: money_moves of kind contribution / withdrawal),
 * and, where nothing was confirmed, an amount worked out from the balances, labelled "not yet explained" and never counted as profit.
 *
 *   net worth = opening position + confirmed outside money + not yet explained + profit
 *
 *  - Own money = opening position + confirmed outside money + not yet explained + corrections (the not-yet-explained part is
 *    shown apart: it is assumed to be your own money until you classify it; a correction says an earlier balance was wrong, so the money
 *    was there all along). Renewals, transfers and reinvested interest never change it.
 *  - Profit = net worth − own money = the sum of the earnings.
 *  - Profit % = profit ÷ own money; not shown when own money is zero or negative (no meaningful base).
 *  - Annual return (XIRR, money-weighted) on −opening at the opening date, −each sum of outside money on its date (a not-yet-explained
 *    amount in the middle of its month), +net worth. Not shown when it cannot be solved.
 *  - Time-weighted return: each month's earnings over the money at work in it (the value at its start plus half the money moved),
 *    chained.
 * Months are calendar months from the opening date (Settings > capital, else the first day with records), the last ending today.
 *
 * Pure: no I/O.
 */
import {
  accountsOf,
  coverageOn,
  dataStarts,
  depositsOf,
  fundsOf,
  recordedPeriod,
  classOfType,
  type PositionInput,
} from './position';
import { liquidityOf } from './networth';
import { addDaysIso } from './harvest-lots';
import {
  depositPeriod,
  fundPeriod,
  savingsPeriod,
  spanBetween,
  valueDays,
  type Span,
} from './period-gains';
import { DEFAULT_CONFIG } from './config';
import { xirr } from './xirr';

/** A confirmed movement as the ledger reads it: outside money in (+) or out (−), income (+), a fee or tax (−), or a correction. */
export interface LedgerMove {
  date: string;
  amount: number;
  kind: 'external' | 'income' | 'cost' | 'correction';
}

/** Turns a stored movement into what the family ledger counts; movements between the family's own holdings count for nothing. */
export function ledgerMoveOf(m: {
  movedOn: string;
  amount: number;
  kind: string;
  fromAssetId: string | null;
  toAssetId: string | null;
  status: string;
}): LedgerMove | null {
  if (m.status !== 'confirmed') return null;
  const into = m.fromAssetId === null;
  const outOf = m.toAssetId === null;
  if (!into && !outOf) return null; // a transfer between the family's own holdings
  const sign = into ? 1 : -1;
  switch (m.kind) {
    case 'contribution':
    case 'withdrawal':
    case 'transfer':
      return { date: m.movedOn, amount: sign * m.amount, kind: 'external' };
    case 'income':
      return { date: m.movedOn, amount: sign * m.amount, kind: 'income' };
    case 'fee':
    case 'tax':
      return { date: m.movedOn, amount: -m.amount, kind: 'cost' };
    case 'adjustment':
      return { date: m.movedOn, amount: sign * m.amount, kind: 'correction' };
    default:
      // proceeds, funding, interest paid out: they move money within the family, or out of it when they leave it
      return { date: m.movedOn, amount: sign * m.amount, kind: 'external' };
  }
}

export interface SpanFigures extends Span {
  /** the family's holdings at the start of the stretch and at its end (what the engine counts) */
  start: number;
  end: number;
  earnings: {
    deposits: number;
    funds: number;
    savings: number;
    fx: number;
    others: number;
    /** confirmed income less confirmed fees and taxes */
    income: number;
    total: number;
  };
  /** all money that moved in or out of the family in the stretch: end − start − earnings */
  moved: number;
  /** of it, what you confirmed as outside money, as a correction, and what is not yet explained */
  confirmedExternal: number;
  corrections: number;
  unexplained: number;
  /** some of the figures rest on estimates */
  estimated: boolean;
}

/** Money from a fund sale on its way back into the same fund (a tax harvest: sell, then buy again a few days later). */
export interface Reinvestment {
  ownerId: string;
  assetId: string;
  soldOn: string;
  boughtOn: string;
  amount: number;
}

/**
 * Each sale of a fund followed, within `days`, by a purchase of the same fund: the smaller of the two amounts is the money reinvested.
 * Only real lines count (never an estimated instalment).
 */
export function reinvestmentsOf(position: PositionInput, days: number): Reinvestment[] {
  const out: Reinvestment[] = [];
  for (const a of position.assets) {
    const lines = (a.fund?.txns ?? []).filter((t) => !t.estimated && t.amount !== 0);
    const buys = lines
      .filter((t) => t.units > 0)
      .map((t) => ({ date: t.date, left: Math.abs(t.amount) }));
    for (const sale of lines.filter((t) => t.units < 0)) {
      let proceeds = Math.abs(sale.amount);
      const last = addDaysIso(sale.date, days);
      for (const b of buys) {
        if (proceeds <= 0) break;
        if (b.date < sale.date || b.date > last || b.left <= 0) continue;
        const amount = Math.min(proceeds, b.left);
        b.left -= amount;
        proceeds -= amount;
        out.push({
          ownerId: a.ownerId,
          assetId: a.assetId,
          soldOn: sale.date,
          boughtOn: b.date,
          amount,
        });
      }
    }
  }
  return out;
}

/**
 * The reinvested money still on its way on day `d` (sold on or before it, bought back after it), so a sale before a month end and its
 * buy-back after it is neither money withdrawn nor money brought in. Not counted when one of the person's rupee savings balances was
 * recorded after the sale and up to `d`: that balance may already hold the proceeds.
 */
export function reinvestedOn(position: PositionInput, pairs: Reinvestment[], d: string): number {
  let total = 0;
  for (const p of pairs) {
    if (!(p.soldOn <= d && d < p.boughtOn)) continue;
    const seen = position.assets.some(
      (a) =>
        a.ownerId === p.ownerId &&
        a.type === 'bank_account' &&
        a.currency === 'INR' &&
        a.records.some((r) => r.date > p.soldOn && r.date <= d),
    );
    if (!seen) total += p.amount;
  }
  return total;
}

/** The family's figures for one stretch of time: values at both ends, earnings by kind, and the money that moved. */
export function spanFigures(
  position: PositionInput,
  w: Span,
  moves: LedgerMove[],
  funds = fundsOf(position, [valueDays(w).open, valueDays(w).close]),
  /** money on its way from a fund sale back into the same fund, by day (a harvest's sale and buy-back) */
  inTransit: (d: string) => number = () => 0,
): SpanFigures {
  const c = position.config;
  const today = c.today;
  const dep = depositPeriod(depositsOf(position), w, today);
  const fun = fundPeriod(funds, w, today);
  const sav = savingsPeriod(accountsOf(position), w);
  const foreign = recordedPeriod(
    position.assets.filter(
      (a) => a.currency !== 'INR' && a.type === 'bank_account' && a.status !== 'gifted',
    ),
    c,
    w,
    position.current,
  );
  const rest = recordedPeriod(
    position.assets.filter(
      (a) =>
        classOfType(a.type) === 'others' && liquidityOf(a.type) !== null && a.status !== 'gifted',
    ),
    c,
    w,
    position.current,
  );
  const inside = (d: string) => d >= w.from && d <= w.through;
  const sum = (k: LedgerMove['kind']) =>
    moves.filter((m) => m.kind === k && inside(m.date)).reduce((a, m) => a + m.amount, 0);
  const income = sum('income') + sum('cost');
  const v = valueDays(w);
  const start =
    dep.startValue +
    fun.startValue +
    sav.startValue +
    foreign.startValue +
    rest.startValue +
    inTransit(v.open);
  const end =
    dep.endValue +
    fun.endValue +
    sav.endValue +
    foreign.endValue +
    rest.endValue +
    inTransit(v.close);
  const engine = dep.profit + fun.profit + sav.profit + foreign.profit + rest.profit;
  const total = engine + income;
  const moved = end - start - total;
  const confirmedExternal = sum('external');
  const corrections = sum('correction');
  return {
    ...w,
    start,
    end,
    earnings: {
      deposits: dep.profit,
      funds: fun.profit,
      savings: sav.profit,
      fx: foreign.profit,
      others: rest.profit,
      income,
      total,
    },
    moved,
    confirmedExternal,
    corrections,
    unexplained: moved - confirmedExternal - corrections,
    estimated:
      dep.estimated || fun.estimated || sav.estimated || foreign.estimated || rest.estimated,
  };
}

export interface CapitalLedger {
  opening: { date: string; value: number; coverage: { withValue: number; of: number } } | null;
  /** calendar months from the opening date, the last one ending today */
  months: SpanFigures[];
  totals: {
    netWorth: number;
    opening: number;
    confirmedExternal: number;
    unexplained: number;
    corrections: number;
    /** opening + confirmed outside money + not yet explained + corrections */
    ownMoney: number;
    profit: number;
    earnings: SpanFigures['earnings'];
    /** profit ÷ own money; null when own money is not above zero */
    profitPct: number | null;
    xirr: { rate: number | null; status: string; message: string };
    /** chained monthly returns; `annualised` only when the ledger covers a year or more */
    twr: { total: number | null; annualised: number | null };
  };
  /** what limits the figures, in words */
  limitations: string[];
}

/** First days of the calendar months after `from` up to today, as stretch boundaries. */
function monthBounds(from: string, today: string): string[] {
  const out = [from];
  let y = Number(from.slice(0, 4));
  let m = Number(from.slice(5, 7));
  for (let guard = 0; guard < 1200; guard++) {
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
    const d = `${y}-${String(m).padStart(2, '0')}-01`;
    if (d >= today) break;
    out.push(d);
  }
  return out;
}

const mid = (from: string, to: string) => {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return new Date(a + Math.floor((b - a) / 2 / 86_400_000) * 86_400_000);
};

/**
 * The day the family's figures are measured from when Settings names none: the first day on which every kind of holding on file has a
 * value (the later of the first savings balance, the first fund record and the first deposit booking), so the opening position is
 * the family's money then and not one early deposit. Holdings first recorded later count as money moved in from that day (shown apart).
 */
export function openingDateOf(position: PositionInput): string | null {
  const firsts: string[] = [];
  const first = (dates: (string | undefined | null)[]) =>
    dates.filter((d): d is string => !!d).sort()[0] ?? null;
  const live = position.assets.filter((a) => a.status !== 'gifted');
  const cash = first(
    live
      .filter((a) => a.type === 'bank_account' && a.currency === 'INR')
      .flatMap((a) => a.records.filter((r) => !r.sheet).map((r) => r.date)),
  );
  const funds = first(
    live
      .filter((a) => a.type === 'mutual_fund' && a.fund)
      .flatMap((a) => [
        a.fund!.txns[0]?.date,
        a.fund!.flows[0]?.date,
        ...a.records.map((r) => r.date),
        ...a.fund!.snapshots.map((x) => x.date),
      ]),
  );
  const fds = first(live.filter((a) => a.fd).map((a) => a.fd!.bookedOn));
  for (const d of [cash, funds, fds]) if (d) firsts.push(d);
  return firsts.sort().pop() ?? dataStarts(position);
}

export function capitalLedger(args: {
  position: PositionInput;
  moves: LedgerMove[];
  /** Settings > capital: the day to measure from; empty or absent = the first day with records */
  openingDate?: string | null;
  /** Settings > harvest: a purchase of the same fund this many days after a sale reinvests its proceeds */
  reinvestDays?: number;
}): CapitalLedger {
  const { position } = args;
  const today = position.config.today;
  const start = args.openingDate || openingDateOf(position);
  const empty = {
    netWorth: 0,
    opening: 0,
    confirmedExternal: 0,
    unexplained: 0,
    corrections: 0,
    ownMoney: 0,
    profit: 0,
    earnings: { deposits: 0, funds: 0, savings: 0, fx: 0, others: 0, income: 0, total: 0 },
    profitPct: null,
    xirr: { rate: null, status: 'insufficient_flows', message: 'Nothing on file yet.' },
    twr: { total: null, annualised: null },
  };
  // the opening position is what was held at the end of the opening day (a balance is that of the end of its day, a deposit booked
  // that day is held): the first stretch starts the day after it
  const first0 = start ? addDaysIso(start, 1) : null;
  if (!start || !first0 || first0 >= today)
    return {
      opening: null,
      months: [],
      totals: empty,
      limitations: ['Nothing is on file to measure from yet.'],
    };

  const bounds = monthBounds(first0, today);
  const spans = bounds.map((b, k) =>
    k + 1 < bounds.length ? spanBetween(b, bounds[k + 1]!) : spanBetween(b, today, today),
  );
  const days = [...new Set(spans.flatMap((w) => [valueDays(w).open, valueDays(w).close]))].sort();
  const funds = fundsOf(position, days);
  const pairs = reinvestmentsOf(position, args.reinvestDays ?? DEFAULT_CONFIG.harvest.reinvestDays);
  const inTransit = (d: string) => (pairs.length ? reinvestedOn(position, pairs, d) : 0);
  const months = spans.map((w) => spanFigures(position, w, args.moves, funds, inTransit));

  const first = months[0]!;
  const last = months[months.length - 1]!;
  const add = (f: (m: SpanFigures) => number) => months.reduce((a, m) => a + f(m), 0);
  const earnings: SpanFigures['earnings'] = {
    deposits: add((m) => m.earnings.deposits),
    funds: add((m) => m.earnings.funds),
    savings: add((m) => m.earnings.savings),
    fx: add((m) => m.earnings.fx),
    others: add((m) => m.earnings.others),
    income: add((m) => m.earnings.income),
    total: add((m) => m.earnings.total),
  };
  const confirmedExternal = add((m) => m.confirmedExternal);
  const unexplained = add((m) => m.unexplained);
  const corrections = add((m) => m.corrections);
  const opening = first.start;
  // a correction (an earlier balance was wrong) is money that was there all along: own money, never profit
  const ownMoney = opening + confirmedExternal + unexplained + corrections;
  const profit = earnings.total;

  // money-weighted: the opening position and each sum of outside money on its date, against net worth
  const flows = [
    { date: new Date(`${first0}T00:00:00Z`), amount: -opening },
    ...args.moves
      .filter(
        (m) =>
          (m.kind === 'external' || m.kind === 'correction') && m.date >= first0 && m.date <= today,
      )
      .map((m) => ({ date: new Date(`${m.date}T00:00:00Z`), amount: -m.amount })),
    ...months
      .filter((m) => Math.abs(m.unexplained) >= 1)
      .map((m) => ({ date: mid(m.from, m.to), amount: -m.unexplained })),
    { date: new Date(`${today}T00:00:00Z`), amount: last.end },
  ].filter((f) => f.amount !== 0);
  const x = xirr(flows);

  // time-weighted: each month's earnings over the money at work in it, chained
  // a month that starts with nothing at work has no return of its own (what it earned rests on money that came in during it, at times
  // not known): the chain starts with the first month that opens with a value
  // a month whose money moved in or out exceeds what was held at its start is left out too (the timing of the flow inside the month
  // decides the return and is not known); how many were left out is said
  let chain = 1;
  let any = false;
  let skipped = 0;
  for (const m of months) {
    const base = m.start + 0.5 * m.moved;
    if (!(m.start > 0) || !(base > 0) || Math.abs(m.moved) > m.start) {
      if (Math.abs(m.earnings.total) >= 1) skipped++;
      continue;
    }
    chain *= 1 + m.earnings.total / base;
    any = true;
  }
  const chained = any;
  const years =
    (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000 / 365;
  const twrTotal = chained ? chain - 1 : null;

  const limitations: string[] = [];
  const coverage = coverageOn(position, start);
  if (coverage.withValue < coverage.of)
    limitations.push(
      `${coverage.withValue} of ${coverage.of} holdings had a value on the opening date (${start}); the others count as money moved in from the day they were first recorded.`,
    );
  if (ownMoney > 0 && Math.abs(unexplained) > 0.2 * ownMoney)
    limitations.push(
      'Most of the money moved in or out is worked out from balances, not confirmed: confirm outside money (salary, gifts, money withdrawn) to make own money and the return exact.',
    );
  if (months.some((m) => m.estimated))
    limitations.push(
      'Some figures rest on estimates (interest at the rate on file, prices, a fund plan).',
    );
  if (x.status !== 'ok')
    limitations.push(`The annual return could not be worked out: ${x.message}`);
  if (skipped > 0)
    limitations.push(
      `The time-weighted return leaves out ${skipped} month${skipped === 1 ? '' : 's'} in which more money moved in or out than was held at its start.`,
    );

  return {
    opening: { date: start, value: opening, coverage },
    months,
    totals: {
      netWorth: last.end,
      opening,
      confirmedExternal,
      unexplained,
      corrections,
      ownMoney,
      profit,
      earnings,
      profitPct: ownMoney > 0 ? profit / ownMoney : null,
      xirr: {
        rate: x.status === 'ok' || x.status === 'ok_multiple_roots' ? x.rate : null,
        status: x.status,
        message: x.message,
      },
      twr: {
        total: twrTotal,
        annualised: twrTotal !== null && years >= 1 ? Math.pow(1 + twrTotal, 1 / years) - 1 : null,
      },
    },
    limitations,
  };
}

/** A stretch of the ledger as one span (any period: a month, a quarter, a year, a custom range), from its months. */
export function ledgerBetween(l: CapitalLedger, from: string, to: string): SpanFigures | null {
  const inside = l.months.filter((m) => m.from >= from && m.to <= to);
  if (inside.length === 0) return null;
  const add = (f: (m: SpanFigures) => number) => inside.reduce((a, m) => a + f(m), 0);
  const a = inside[0]!;
  const b = inside[inside.length - 1]!;
  return {
    from: a.from,
    to: b.to,
    through: b.through,
    days: add((m) => m.days),
    start: a.start,
    end: b.end,
    earnings: {
      deposits: add((m) => m.earnings.deposits),
      funds: add((m) => m.earnings.funds),
      savings: add((m) => m.earnings.savings),
      fx: add((m) => m.earnings.fx),
      others: add((m) => m.earnings.others),
      income: add((m) => m.earnings.income),
      total: add((m) => m.earnings.total),
    },
    moved: add((m) => m.moved),
    confirmedExternal: add((m) => m.confirmedExternal),
    corrections: add((m) => m.corrections),
    unexplained: add((m) => m.unexplained),
    estimated: inside.some((m) => m.estimated),
  };
}

// ------------------------------------------------------------------------------------------------
// Wealth movement over a chosen period (Home): how net worth moved, outside money apart from performance
// ------------------------------------------------------------------------------------------------
export type MovementKey = 'month' | '3m' | '6m' | 'fy' | '12m' | 'all' | 'custom';

export const MOVEMENT_PERIODS: { key: Exclude<MovementKey, 'custom'>; label: string }[] = [
  { key: 'month', label: 'This month' },
  { key: '3m', label: '3 months' },
  { key: '6m', label: '6 months' },
  { key: 'fy', label: 'This FY' },
  { key: '12m', label: '12 months' },
  { key: 'all', label: 'Since start' },
];

export const parseMovementKey = (v: string | undefined): MovementKey =>
  (MOVEMENT_PERIODS.find((p) => p.key === v)?.key ??
    (v === 'custom' ? 'custom' : 'fy')) as MovementKey;

export interface WealthMovement {
  key: MovementKey;
  label: string;
  /** the first day of the period and the day it ends (today, or the end of the last month asked for) */
  from: string;
  to: string;
  figures: SpanFigures | null;
  /** the period's time-weighted return (months chained); null when there was no money at work */
  twr: number | null;
  /** the period begins before the ledger does: it starts where the ledger starts */
  clamped: boolean;
}

const firstOfMonthsBack = (today: string, back: number) => {
  let y = Number(today.slice(0, 4));
  let m = Number(today.slice(5, 7)) - back;
  while (m < 1) {
    m += 12;
    y--;
  }
  return `${y}-${String(m).padStart(2, '0')}-01`;
};

/**
 * The movement of net worth over a period made of whole calendar months (the last one to today): this month, the last 3, 6 or 12 months,
 * this financial year (from 1 April), since the start, or custom months (`from` and `to` as YYYY-MM).
 */
export function wealthMovement(
  l: CapitalLedger,
  key: MovementKey,
  today: string,
  custom?: { from?: string; to?: string },
): WealthMovement {
  const fyStart = `${Number(today.slice(5, 7)) >= 4 ? today.slice(0, 4) : Number(today.slice(0, 4)) - 1}-04-01`;
  let from: string;
  let to = today;
  let label = MOVEMENT_PERIODS.find((p) => p.key === key)?.label ?? 'Custom';
  switch (key) {
    case 'month':
      from = firstOfMonthsBack(today, 0);
      break;
    case '3m':
      from = firstOfMonthsBack(today, 2);
      break;
    case '6m':
      from = firstOfMonthsBack(today, 5);
      break;
    case '12m':
      from = firstOfMonthsBack(today, 11);
      break;
    case 'fy':
      from = fyStart;
      break;
    case 'all':
      from = l.months[0]?.from ?? today;
      break;
    default: {
      const ok = (v?: string) => (v && /^\d{4}-\d{2}$/.test(v) ? v : null);
      const a = ok(custom?.from) ?? today.slice(0, 7);
      const b = ok(custom?.to) ?? today.slice(0, 7);
      const [lo, hi] = a <= b ? [a, b] : [b, a];
      from = `${lo}-01`;
      const next = firstOfMonthsBack(`${hi}-01`, -1);
      to = next > today ? today : next;
      label = `${lo} to ${hi}`;
    }
  }
  const first = l.months[0]?.from ?? null;
  const clamped = first !== null && from < first;
  const start = clamped ? first! : from;
  const figures = ledgerBetween(l, start, to);
  let chain = 1;
  let any = false;
  for (const m of l.months.filter((x) => x.from >= start && x.to <= to)) {
    const base = m.start + 0.5 * m.moved;
    if (m.start > 0 && base > 0 && Math.abs(m.moved) <= m.start) {
      chain *= 1 + m.earnings.total / base;
      any = true;
    }
  }
  return { key, label, from: start, to, figures, twr: any ? chain - 1 : null, clamped };
}

/**
 * What the funds earned this financial year, exactly as Home's "Earned this FY" splits it: the family ledger's fund earnings for the
 * financial year (each month's change in value with money added or withdrawn left out). Investments shows this figure so the two pages
 * agree to the rupee. Money moved in or out of the family does not change fund earnings, so no moves are needed. Null before records.
 */
export function fundsEarnedThisFy(
  position: PositionInput,
  openingDate: string | null,
  reinvestDays?: number,
): number | null {
  const ledger = capitalLedger({
    position,
    moves: [],
    openingDate,
    ...(reinvestDays !== undefined ? { reinvestDays } : {}),
  });
  return wealthMovement(ledger, 'fy', position.config.today).figures?.earnings.funds ?? null;
}

// ------------------------------------------------------------------------------------------------
// Earned and saved, year by year (Indian financial years, 1 April to 31 March)
// ------------------------------------------------------------------------------------------------

/** The financial year a day falls in, by its starting calendar year: 2026-10-31 → 2026 (FY 2026–27), 2027-02-01 → 2026. */
export const fyStartYear = (iso: string): number =>
  Number(iso.slice(5, 7)) >= 4 ? Number(iso.slice(0, 4)) : Number(iso.slice(0, 4)) - 1;

/** "FY 2026–27". */
export const fyLabel = (startYear: number): string =>
  `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`;

/**
 * The return on a stretch as one figure: what was earned ÷ the money at work, where money saved during the stretch counts for half
 * of it (it arrived, on average, half-way through). Null when nothing was at work.
 */
export function earnedPct(start: number, earned: number, saved: number): number | null {
  const base = start + 0.5 * saved;
  return base > 0 ? earned / base : null;
}

export interface YearFigures {
  /** the financial year's starting calendar year, and its name ("FY 2026–27") */
  fy: number;
  label: string;
  /** the ledger's months inside it: the first may start after 1 April (records begin), the last may end today */
  from: string;
  to: string;
  /** not a whole year: records begin inside it, or it is the year still running */
  partial: boolean;
  /** net worth at the start and the end of the stretch */
  start: number;
  end: number;
  /** what the holdings earned (interest, fund gains, exchange-rate moves, earnings less costs) */
  earned: number;
  /** all money that came in less all that went out: end − start − earned */
  saved: number;
  /** of the money saved, what was confirmed (outside money and corrections) and what balances alone show */
  confirmed: number;
  unexplained: number;
  /** earned ÷ money at work (earnedPct); null when nothing was at work */
  pct: number | null;
  estimated: boolean;
  /** the months themselves, for the year's own tables */
  months: SpanFigures[];
}

/**
 * Earned and saved for every financial year the ledger covers, newest first. Each year is the sum of its months, so the years add up
 * to the ledger's totals and the year still running matches Home's "Earned this FY" and "Saved this FY" to the rupee.
 */
export function yearByYear(l: CapitalLedger, today: string): YearFigures[] {
  const by = new Map<number, SpanFigures[]>();
  for (const m of l.months) {
    const fy = fyStartYear(m.from);
    by.set(fy, [...(by.get(fy) ?? []), m]);
  }
  const current = fyStartYear(today);
  return [...by.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([fy, months]) => {
      const f = ledgerBetween(l, months[0]!.from, months[months.length - 1]!.to)!;
      return {
        fy,
        label: fyLabel(fy),
        from: f.from,
        to: f.to,
        partial: fy === current || f.from > `${fy}-04-01`,
        start: f.start,
        end: f.end,
        earned: f.earnings.total,
        saved: f.moved,
        confirmed: f.confirmedExternal + f.corrections,
        unexplained: f.unexplained,
        pct: earnedPct(f.start, f.earnings.total, f.moved),
        estimated: f.estimated,
        months,
      };
    });
}
