/**
 * The review of earlier months ("Explain movements" > Earlier months): the months whose money moved in or out is not explained, largest
 * first, so a few answers settle most of it. The capital ledger (capital.ts) works these amounts out from the balances: whatever the
 * holdings' own rules (interest, prices, exchange rates) do not account for. Until you say what an amount was it counts as your own
 * money and never as profit.
 *
 * For each month it says which holdings changed most, to help you remember (a deposit that appeared, a balance that jumped), and it sets
 * apart the pairs of months that cancel out: money that the monthly tabs show leaving in one month and arriving in the next is a
 * transfer between your own accounts recorded in two different months. Such a pair leaves own money unchanged, so there is nothing to
 * answer. An answer is a confirmed movement in the ledger (outside money in, money withdrawn, or earnings the app did not estimate),
 * dated inside the month; the month's remaining amount is worked out again from it.
 *
 * Pure: no I/O.
 */
import type { CapitalLedger, SpanFigures } from './capital';
import { valueDays } from './period-gains';
import { positionAsOf, type PositionInput } from './position';

export interface HistoryChange {
  assetId: string;
  name: string;
  ownerId: string;
  /** the holding's value at the start of the month (null: it did not exist yet) and at its end (null: it had ended) */
  before: number | null;
  after: number | null;
  change: number;
}

export interface HistoryMonth {
  /** YYYY-MM */
  key: string;
  from: string;
  through: string;
  /** money that moved in (+) or out (−) with nothing to say what it was */
  amount: number;
  /** the holdings that changed most in the month, largest first */
  changes: HistoryChange[];
  /**
   * what the records already say about the month's money, worked out by themselves: holdings first entered in the records that month
   * (an account that already held money, a deposit booked earlier), each with its value. They are money already yours, not new money
   * to explain, so they are taken off the amount (`amount` is what is left)
   */
  firstRecorded?: { assetId: string; name: string; value: number }[];
  /** the month's whole unexplained amount, before what the records explain by themselves */
  gross?: number;
}

export interface HistoryReview {
  /** months to answer, largest amount first */
  open: HistoryMonth[];
  /** months that cancel out (a transfer the monthly tabs show in two different months): nothing to answer */
  cancelling: { first: HistoryMonth; second: HistoryMonth }[];
  /** the money moved in all the open months, without its sign */
  openTotal: number;
  /** of it, what the months listed cover */
  listedTotal: number;
  /** months below the minimum, left out of the list, and their money without its sign */
  small: { count: number; total: number };
  /** months the records explain by themselves (holdings first recorded), with nothing left to answer */
  settled: HistoryMonth[];
}

/**
 * The holdings first entered in the records during a month: there before the month with no value, held with a value at its end, and not
 * new money by their nature: a bank account, a policy or any other holding first recorded, or a deposit booked before the month began.
 * A deposit booked in the month (paid for from an account) and a fund (bought) are left out: their money came from the family's own
 * accounts and nets out already.
 */
export function firstRecordedIn(
  position: PositionInput,
  month: SpanFigures,
): { assetId: string; name: string; value: number }[] {
  const days = valueDays(month);
  const held = (d: string) =>
    new Map(
      positionAsOf(position, d)
        .holdings.filter((h) => h.value !== null && h.state === 'held')
        .map((h) => [h.assetId, h] as const),
    );
  const before = held(days.open);
  const after = held(days.close);
  const byId = new Map(position.assets.map((a) => [a.assetId, a]));
  const out: { assetId: string; name: string; value: number }[] = [];
  for (const [id, h] of after) {
    if (before.has(id)) continue;
    const a = byId.get(id);
    if (!a || a.type === 'mutual_fund') continue;
    if (a.fd && a.fd.bookedOn >= month.from) continue;
    // the first record is inside the month (not a holding that was merely valueless at its start)
    const first = a.records.map((r) => r.date).sort()[0] ?? a.fd?.bookedOn ?? null;
    if (!first || first < month.from || first > days.close) {
      if (!a.fd) continue;
    }
    if (Math.abs(h.value!) < 1) continue;
    out.push({ assetId: id, name: h.name, value: h.value! });
  }
  return out.sort((x, y) => Math.abs(y.value) - Math.abs(x.value));
}

const monthKey = (m: SpanFigures) => m.from.slice(0, 7);
const toMonth = (m: SpanFigures, changes: HistoryChange[] = []): HistoryMonth => ({
  key: monthKey(m),
  from: m.from,
  through: m.through,
  amount: m.unexplained,
  changes,
});

const monthsApart = (a: string, b: string) =>
  (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
  (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));

/** The holdings whose value changed most between the start and the end of a month. */
export function monthChanges(
  position: PositionInput,
  month: SpanFigures,
  top: number,
): HistoryChange[] {
  const days = valueDays(month);
  const at = (d: string) =>
    new Map(
      positionAsOf(position, d)
        .holdings.filter((h) => h.value !== null && h.state === 'held')
        .map((h) => [h.assetId, h] as const),
    );
  const before = at(days.open);
  const after = at(days.close);
  const ids = new Set([...before.keys(), ...after.keys()]);
  const out: HistoryChange[] = [];
  for (const id of ids) {
    const b = before.get(id);
    const a = after.get(id);
    const change = (a?.value ?? 0) - (b?.value ?? 0);
    if (Math.abs(change) < 1) continue;
    const h = (a ?? b)!;
    out.push({
      assetId: id,
      name: h.name,
      ownerId: h.ownerId,
      before: b?.value ?? null,
      after: a?.value ?? null,
      change,
    });
  }
  return out.sort((x, y) => Math.abs(y.change) - Math.abs(x.change)).slice(0, top);
}

export function historyReview(args: {
  ledger: CapitalLedger;
  position: PositionInput;
  /** Settings: a month whose unexplained money is below this many rupees is not listed */
  minimum: number;
  /** Settings: two months this many months apart or less whose amounts cancel out are a transfer recorded in two months */
  pairMonths: number;
  /** months ending on or after this day are left to the recent list of Explain movements */
  before: string;
  /** the most months to list (all of them when left out) */
  limit?: number;
  /** how many holdings to name for each month */
  topChanges?: number;
}): HistoryReview {
  const { ledger, position, minimum } = args;
  const all = ledger.months.filter((m) => m.through < args.before);
  // what the records explain by themselves: holdings first recorded in the month (only for months with something to explain)
  const first = new Map(
    all
      .filter((m) => Math.abs(m.unexplained) >= minimum)
      .map((m) => [monthKey(m), firstRecordedIn(position, m)] as const),
  );
  const firstTotal = (m: SpanFigures) =>
    (first.get(monthKey(m)) ?? []).reduce((a, x) => a + x.value, 0);
  // a month keeps its own figures; only its amount to explain is what is left after the first records, when they point the same way
  const left = new Map(
    all.map((m) => {
      const f = firstTotal(m);
      const rest = Math.sign(f) === Math.sign(m.unexplained) ? m.unexplained - f : m.unexplained;
      // never more than the month's own amount, never past zero
      const clipped = Math.sign(rest) !== Math.sign(m.unexplained) ? 0 : rest;
      return [monthKey(m), f !== 0 ? clipped : m.unexplained] as const;
    }),
  );
  const months = all.map((m) => ({ ...m, unexplained: left.get(monthKey(m))! }));
  const settled = all.filter(
    (m) =>
      Math.abs(m.unexplained) >= minimum &&
      Math.abs(left.get(monthKey(m))!) < minimum &&
      firstTotal(m) !== 0,
  );
  const big = months.filter((m) => Math.abs(m.unexplained) >= minimum);
  const small = months.filter(
    (m) => Math.abs(m.unexplained) >= 1 && Math.abs(m.unexplained) < minimum,
  );
  const decorate = (m: SpanFigures, h: HistoryMonth): HistoryMonth => {
    const f = first.get(monthKey(m)) ?? [];
    const orig = all.find((x) => monthKey(x) === monthKey(m))!;
    return f.length ? { ...h, firstRecorded: f, gross: orig.unexplained } : h;
  };

  // pairs that cancel: the closest later month of the opposite sign within the window, the same sum give or take the minimum or 2%
  const paired = new Set<string>();
  const cancelling: HistoryReview['cancelling'] = [];
  const chrono = [...big].sort((a, b) => a.from.localeCompare(b.from));
  for (const a of chrono) {
    if (paired.has(monthKey(a))) continue;
    const b = chrono.find(
      (x) =>
        !paired.has(monthKey(x)) &&
        x.from > a.from &&
        monthsApart(monthKey(a), monthKey(x)) <= args.pairMonths &&
        Math.sign(x.unexplained) === -Math.sign(a.unexplained) &&
        Math.abs(a.unexplained + x.unexplained) <=
          Math.max(minimum, 0.02 * Math.abs(a.unexplained)),
    );
    if (!b) continue;
    paired.add(monthKey(a));
    paired.add(monthKey(b));
    cancelling.push({ first: toMonth(a), second: toMonth(b) });
  }

  const openMonths = big
    .filter((m) => !paired.has(monthKey(m)))
    .sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained));
  const listed = args.limit === undefined ? openMonths : openMonths.slice(0, args.limit);
  const total = (ms: SpanFigures[]) => ms.reduce((a, m) => a + Math.abs(m.unexplained), 0);
  return {
    open: listed.map((m) =>
      decorate(m, toMonth(m, monthChanges(position, m, args.topChanges ?? 3))),
    ),
    cancelling,
    settled: settled
      .sort((a, b) => Math.abs(b.unexplained) - Math.abs(a.unexplained))
      .map((m) => decorate(m, toMonth(m))),
    openTotal: total(openMonths),
    listedTotal: total(listed),
    small: { count: small.length, total: total(small) },
  };
}
