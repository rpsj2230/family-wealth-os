/**
 * The three views of the family's mutual funds (brief §6.3), from the central engine's holdings for one day:
 *  - Confirmed portfolio value: units a fund statement (CAS) or a unit count confirms, times the official NAV of the date shown;
 *  - Estimated portfolio value: the confirmed value plus the units the active SIPs are projected to have bought since the last statement,
 *    each at the NAV of its own date (and funds rebuilt from their plan or moved on from a value on file, which are estimates whole);
 *  - Projected SIP activity: the instalments due since the last statement that no statement shows yet (with the units the NAV of their
 *    day buys), and the instalments due next with the amount in force on each date (no NAV is invented for a future day).
 * A NAV older than Settings allows is flagged as stale (acceptance tests 5, 8 and 16).
 *
 * Pure: no I/O.
 */
import { plannedInstalments } from './estimate';
import { addDaysIso } from './harvest-lots';
import { fundValueFrom, isHeld, positionAsOf, type PositionInput } from './position';

export interface FundViewRow {
  assetId: string;
  name: string;
  ownerId: string;
  value: number;
  confirmedValue: number | null;
  projectedValue: number;
  projectedInvested: number;
  projectedCount: number;
  nav: { date: string; nav: number } | null;
  /** days between the NAV's date and the valuation day */
  navAgeDays: number | null;
  stale: boolean;
  /** how the value is worked out: from a statement ledger, rebuilt from the plan, or the last value on file moved with the price */
  basis: 'ledger' | 'plan' | 'records';
}

export interface FundViews {
  confirmed: number;
  estimated: number;
  /** of the estimated value, what rests on no confirmed units at all (plan-rebuilt or moved-on funds) */
  unconfirmedFunds: number;
  projected: { value: number; invested: number; count: number };
  upcoming: { assetId: string; name: string; date: string; amount: number }[];
  rows: FundViewRow[];
  staleCount: number;
  oldestNav: string | null;
}

const ageDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

export function fundViews(
  position: PositionInput,
  opts: { on?: string; navStaleDays: number; upcomingDays: number },
): FundViews {
  const on = opts.on ?? position.config.today;
  const day = positionAsOf(position, on);
  const byId = new Map(position.assets.map((a) => [a.assetId, a]));
  const rows: FundViewRow[] = [];
  const upcoming: FundViews['upcoming'] = [];
  for (const h of day.holdings) {
    if (h.type !== 'mutual_fund' || !isHeld(h)) continue;
    const a = byId.get(h.assetId)!;
    const s = h.fundSplit;
    const nav = s?.nav ?? null;
    const navAge = nav ? ageDays(nav.date, on) : null;
    const basis: FundViewRow['basis'] = fundValueFrom(a, position.config);
    rows.push({
      assetId: h.assetId,
      name: h.name,
      ownerId: h.ownerId,
      value: h.value!,
      confirmedValue: s?.confirmedValue ?? null,
      projectedValue: s?.projectedValue ?? 0,
      projectedInvested: s?.projectedInvested ?? 0,
      projectedCount: s?.projectedCount ?? 0,
      nav,
      navAgeDays: navAge,
      stale: navAge === null || navAge > opts.navStaleDays,
      basis,
    });
    // the next instalments of a running SIP, with the amount in force on each date; their units are not known until their NAV is
    const sip = a.fund?.sip;
    if (sip)
      for (const i of plannedInstalments(
        sip,
        new Date(`${on}T00:00:00Z`),
        new Date(`${addDaysIso(on, opts.upcomingDays)}T00:00:00Z`),
      ))
        upcoming.push({ assetId: h.assetId, name: h.name, date: i.date, amount: i.amount });
  }
  const sum = (f: (r: FundViewRow) => number) => rows.reduce((x, r) => x + f(r), 0);
  return {
    confirmed: sum((r) => r.confirmedValue ?? 0),
    estimated: sum((r) => r.value),
    unconfirmedFunds: sum((r) => (r.confirmedValue === null ? r.value - r.projectedValue : 0)),
    projected: {
      value: sum((r) => r.projectedValue),
      invested: sum((r) => r.projectedInvested),
      count: sum((r) => r.projectedCount),
    },
    upcoming: upcoming.sort((x, y) => x.date.localeCompare(y.date)),
    rows,
    staleCount: rows.filter((r) => r.stale).length,
    oldestNav:
      rows
        .map((r) => r.nav?.date)
        .filter((d): d is string => !!d)
        .sort()[0] ?? null,
  };
}
