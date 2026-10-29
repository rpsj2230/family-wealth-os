/**
 * A fund's SIP plan as the fund page shows it: the dated changes (past, in force, planned), the amount in force today, and the savings
 * accounts it can be paid from. Pure, so the page and its tests read the same thing.
 */

export interface SipChangeRow {
  on: string;
  monthly: number;
}

export interface SipPlanView {
  assetId: string;
  startedOn: string | null;
  /** the amount in force today; 0 when stopped or paused */
  now: number;
  /** the amount it had before it was stopped, for the words "stopped (was ₹…)" */
  lastAmount: number | null;
  rows: {
    on: string;
    monthly: number;
    when: 'past' | 'now' | 'planned';
    /** the first entry (the amount it started at) stays while later changes depend on it */
    removable: boolean;
  }[];
  /** the next planned change, for "starts again on …" */
  next: { on: string; monthly: number } | null;
  payFrom: string | null;
  accounts: { id: string; label: string }[];
}

export function sipPlanView(args: {
  assetId: string;
  startedOn: string | null;
  sipMonthly: number | null;
  sipStopped: boolean;
  changes: SipChangeRow[];
  payFrom: string | null;
  accounts: { id: string; label: string }[];
  today: string;
}): SipPlanView {
  const sorted = [...args.changes].sort((a, b) => a.on.localeCompare(b.on));
  const inForce = sorted.filter((c) => c.on <= args.today).pop() ?? null;
  const now = inForce ? inForce.monthly : args.sipStopped ? 0 : Math.max(0, args.sipMonthly ?? 0);
  const rows = sorted.map((c, k) => ({
    on: c.on,
    monthly: c.monthly,
    when: (c.on > args.today ? 'planned' : c === inForce ? 'now' : 'past') as
      'past' | 'now' | 'planned',
    removable: !(k === 0 && sorted.length > 1),
  }));
  const lastAmount =
    [...sorted]
      .filter((c) => c.on <= args.today)
      .reverse()
      .find((c) => c.monthly > 0)?.monthly ??
    (args.sipMonthly && args.sipMonthly > 0 ? args.sipMonthly : null);
  return {
    assetId: args.assetId,
    startedOn: args.startedOn,
    now,
    lastAmount,
    rows,
    next: sorted.find((c) => c.on > args.today) ?? null,
    payFrom: args.payFrom,
    accounts: args.accounts,
  };
}
