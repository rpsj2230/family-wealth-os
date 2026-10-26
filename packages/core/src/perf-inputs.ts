/**
 * What a fund feeds into the performance figures: the dates it is valued on and its cash flows. Pure.
 */
import { monthEnds } from './fund-series';
import { approximateFlows } from './performance';
import { addDaysIso } from './harvest-lots';
import { perfAnchors, type Flow } from './return-profile';
import { weekStart } from './period-pl';

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
  }[];
  plan: {
    invested: number;
    startedOn: string | null;
    sipMonthly: number | null;
    sipStopped: boolean;
  } | null;
  today: string;
}): { flows: Flow[]; estimated: boolean } {
  if (args.txns.length === 0) {
    const flows = args.plan
      ? approximateFlows(args.plan, args.today).map((f) => ({
          date: f.date,
          amount: Math.abs(f.amount),
        }))
      : [];
    return { flows, estimated: true };
  }
  const sorted = [...args.txns].sort((a, b) => a.date.localeCompare(b.date));
  const flows: Flow[] = sorted
    .filter((t) => t.units !== 0 && t.amount !== 0)
    .map((t) => ({ date: t.date, amount: t.units > 0 ? Math.abs(t.amount) : -Math.abs(t.amount) }));
  const first = sorted[0]!;
  if (typeof first.balance === 'number' && first.nav && first.nav > 0) {
    const opening = first.balance - first.units;
    if (opening > 0.0005) flows.push({ date: first.date, amount: opening * first.nav });
  }
  return { flows, estimated: false };
}
