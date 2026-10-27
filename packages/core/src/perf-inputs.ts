/**
 * What a fund feeds into the performance figures: the dates it is valued on and its cash flows. Pure.
 */
import { monthEnds } from './fund-series';
import { isEstimatedTxn } from './estimate';
import { orderLines } from './ledger-check';
import { approximateFlows, isCashFlow } from './performance';
import { addDaysIso } from './harvest-lots';
import { perfAnchors, type Flow } from './return-profile';
import { weekStart } from './period-pl';

/** the smallest count of units left over that is read as a real holding when no tolerance is given */
const OPENING_UNITS_EPSILON = 0.0005;

/**
 * The dates a fund is valued on for performance: every month end from its start, the start of each period, every Sunday of the
 * latest `weeks` weeks (so weeks can be told apart), and today.
 */
export function perfDates(from: string, today: string, weeks = 0): string[] {
  const sundays: string[] = [];
  const lastSunday = addDaysIso(weekStart(today), -1);
  for (let k = 0; k < weeks; k++) sundays.push(addDaysIso(lastSunday, -7 * k));
  return [
    ...new Set([
      ...monthEnds(from, today),
      ...perfAnchors(today).filter((a) => a >= from && a < today),
      ...sundays.filter((a) => a >= from && a < today),
    ]),
  ].sort();
}

/**
 * A fund's cash flows: money put in positive, money taken out negative. From the statement's transactions when there are any (units
 * held before the statement began count as money put in on its first day, at that day's price, so the first period is not read as a
 * gain); otherwise worked out from the start date and SIP plan and marked estimated.
 */
export function flowsOfFund(args: {
  txns: {
    date: string;
    units: number;
    amount: number;
    nav?: number | null;
    balance?: number | null;
    kind?: string | null;
    source?: string | null;
    description?: string | null;
  }[];
  plan: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean;
  } | null;
  today: string;
  /** units a balance may be out by before they count as held before the first line (Settings: funds.unitTolerance) */
  unitTolerance?: number;
}): { flows: Flow[]; estimated: boolean } {
  const tol = args.unitTolerance ?? OPENING_UNITS_EPSILON;
  if (args.txns.length === 0) {
    const flows = args.plan
      ? approximateFlows(args.plan, args.today).map((f) => ({
          date: f.date,
          amount: Math.abs(f.amount),
        }))
      : [];
    return { flows, estimated: true };
  }
  // lines assumed from the SIP plan are not a statement: a fund with nothing else is estimated
  const real = args.txns.filter((t) => t.source !== 'estimate' && !isEstimatedTxn(t));
  const sorted = orderLines(args.txns, tol);
  const flows: Flow[] = sorted
    .filter(isCashFlow)
    .map((t) => ({ date: t.date, amount: t.units > 0 ? Math.abs(t.amount) : -Math.abs(t.amount) }));
  const first = sorted[0]!;
  if (typeof first.balance === 'number' && first.nav && first.nav > 0) {
    const opening = first.balance - first.units;
    if (opening > tol) flows.push({ date: first.date, amount: opening * first.nav });
  }
  return { flows, estimated: real.length === 0 };
}
