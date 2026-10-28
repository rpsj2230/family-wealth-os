/**
 * The interest a bank statement shows, against the interest the app estimated for the same account and the same financial year
 * (Explain movements > Bank statements). The balances already hold what the bank really paid, so the estimate is the only thing that
 * can be off: the difference is earnings the app did not estimate (or estimated too much). It is recorded as one confirmed movement of
 * kind income per account and year, dated the year's last day the statements cover, which moves it from "not yet explained" into
 * lifetime profit and changes no balance.
 *
 * Only a year the statements cover from its first month to its last is settled this way: interest is credited every quarter or so, and
 * part of a year cannot be compared with an estimate made day by day.
 *
 * Pure: no I/O.
 */
import { addDaysIso } from './harvest-lots';
import { fyRange } from './interest-check';
import { savingsPeriod, spanBetween } from './period-gains';
import { accountsOf, type PositionInput } from './position';
import type { Classified, StatementMove, StmtLine } from './statement-classify';

export interface StatementInterestRow {
  assetId: string;
  fy: string;
  /** interest credited less the tax taken on it, from the statement lines */
  actual: number;
  /** what the app worked out for the same account and year, after tax at source */
  estimated: number;
  difference: number;
}

const fyOf = (date: string) => {
  const y = Number(date.slice(0, 4));
  const start = date.slice(5) >= '04-01' ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

/**
 * For each account and financial year the statements cover in full (the first line no later than `slackDays` after 1 April, the last
 * no earlier than `slackDays` before 31 March, or the coverage you entered), the interest the lines show and the app's estimate.
 */
export function statementInterest(args: {
  lines: StmtLine[];
  classified: Classified[];
  /** the days each account's statements cover, as uploaded */
  coverage: { assetId: string; from: string; to: string }[];
  position: PositionInput;
  slackDays?: number;
}): StatementInterestRow[] {
  const slack = args.slackDays ?? 31;
  const cls = new Map(args.classified.map((c) => [c.id, c.cls]));
  const accounts = new Map(accountsOf(args.position).map((a) => [a.assetId, a]));
  const covered = new Map<string, { from: string; to: string }[]>();
  for (const c of args.coverage) covered.set(c.assetId, [...(covered.get(c.assetId) ?? []), c]);
  // whether the spans of one account reach from `from` to `to` with no hole longer than the slack
  const spans = (assetId: string, from: string, to: string) => {
    const list = [...(covered.get(assetId) ?? [])].sort((a, b) => a.from.localeCompare(b.from));
    let reach = addDaysIso(from, slack);
    for (const s of list) {
      if (s.from > reach) break;
      if (addDaysIso(s.to, slack) > reach) reach = addDaysIso(s.to, slack);
    }
    return reach >= to;
  };
  const actual = new Map<string, number>();
  for (const l of args.lines) {
    const c = cls.get(l.id);
    if (c !== 'interest' && c !== 'interest_tax') continue;
    const k = `${l.assetId}|${fyOf(l.date)}`;
    actual.set(k, (actual.get(k) ?? 0) + l.amount);
  }
  const fys = new Set<string>();
  for (const c of args.coverage) {
    for (let fy = fyOf(c.from); fy <= fyOf(c.to);) {
      fys.add(`${c.assetId}|${fy}`);
      const y = Number(fy.slice(0, 4)) + 1;
      fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
    }
  }
  const rows: StatementInterestRow[] = [];
  for (const k of fys) {
    const [assetId = '', fy = ''] = k.split('|');
    const a = accounts.get(assetId);
    if (!a || a.currency !== 'INR') continue;
    const { from, to } = fyRange(fy);
    if (to > args.position.config.today || !spans(assetId, from, addDaysIso(to, -1))) continue;
    const got = Math.round((actual.get(k) ?? 0) * 100) / 100;
    const est = Math.round(savingsPeriod([a], spanBetween(from, to)).profit * 100) / 100;
    rows.push({
      assetId,
      fy,
      actual: got,
      estimated: est,
      difference: Math.round((got - est) * 100) / 100,
    });
  }
  return rows.sort((x, y) => x.fy.localeCompare(y.fy) || x.assetId.localeCompare(y.assetId));
}

/** The movements that settle the rows: earnings in when the bank paid more than estimated, out when it paid less. */
export function statementInterestMoves(rows: StatementInterestRow[]): StatementMove[] {
  return rows
    .filter((r) => Math.abs(r.difference) >= 1)
    .map((r) => ({
      idemKey: `stmt:${r.assetId}:int:${r.fy}`,
      movedOn: addDaysIso(fyRange(r.fy).to, -1),
      amount: Math.abs(r.difference),
      kind: 'income' as const,
      fromAssetId: r.difference > 0 ? null : r.assetId,
      toAssetId: r.difference > 0 ? r.assetId : null,
      note: `Interest in the statements for ${r.fy} against the app's estimate`,
    }));
}
