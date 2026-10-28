/**
 * What the household still has to send or answer so the past is complete: worked out from the data each time, so an item goes away
 * by itself once what it asks for arrives.
 *
 *  - an account with no bank statement on file (its money can only be followed through the transfers from Singapore into it);
 *  - the days between two statements of an account whose balances do not join up (the closing of one is not the opening of the next);
 *  - the time between the day an account was opened and its first statement, when money was already in it;
 *  - a download with no balances whose sum drifts from the balances on record by a steady amount from one month on: a line is
 *    missing, and a statement (PDF) of the months it can be in settles it;
 *  - statement lines whose kind could not be worked out (Explain movements), and the day clubbing is counted from (Settings).
 *
 * Pure: no I/O.
 */
import { addDaysIso } from './harvest-lots';

export interface NeedAccount {
  id: string;
  /** "Rupash", "Ragini" */
  owner: string;
  bank: string;
  last4: string | null;
  kind: string | null;
  openedOn: string | null;
}

export interface NeedStatement {
  assetId: string;
  from: string;
  to: string;
  opening: number | null;
  closing: number | null;
}

export interface Need {
  /** stable: the same need keeps the same key while it lasts */
  key: string;
  assetId: string | null;
  title: string;
  /** lower first */
  rank: number;
}

const inr = (n: number) => {
  const l = Math.abs(n) / 100_000;
  return l >= 1 ? `₹${l.toFixed(2)} L` : `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
};
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const endOfMonth = (iso: string) => {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7));
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};

export function neededFromYou(input: {
  accounts: NeedAccount[];
  statements: NeedStatement[];
  /** the lines of accounts whose statements give no balance (a download summed from the opening), oldest first */
  unbalanced: Map<string, { date: string; amount: number }[]>;
  /** balances on record that did not come from a statement */
  recorded: { assetId: string; date: string; amount: number }[];
  /** transfers from Singapore with no account proven for them, with the accounts they may have gone to */
  unplaced: { date: string; amount: number; candidates: string[] }[];
  toAnswer: number;
  ownershipFrom: string;
}): Need[] {
  const out: Need[] = [];
  const name = (a: NeedAccount) =>
    `${a.owner}’s ${a.bank}${a.kind ? ` ${a.kind}` : ''}${a.last4 ? ` (…${a.last4})` : ''}`;
  const byAsset = new Map<string, NeedStatement[]>();
  for (const s of [...input.statements].sort((a, b) => a.from.localeCompare(b.from)))
    byAsset.set(s.assetId, [...(byAsset.get(s.assetId) ?? []), s]);

  for (const a of input.accounts) {
    const sts = byAsset.get(a.id) ?? [];
    const waiting = input.unplaced.filter((u) => u.candidates.includes(a.id));
    if (sts.length === 0) {
      const why = waiting.length
        ? `: it would place ${waiting.length} transfer${waiting.length === 1 ? '' : 's'} from Singapore (${inr(waiting.reduce((s, u) => s + u.amount, 0))})`
        : '';
      out.push({
        key: `stmt-none:${a.id}`,
        assetId: a.id,
        title: `Send the statements of ${name(a)} from ${a.openedOn ? `its opening (${day(a.openedOn)})` : 'its opening'} to today${why}`,
        rank: waiting.length ? 1 : 3,
      });
      continue;
    }
    // before the first statement, when the account already held money
    const first = sts[0]!;
    if (a.openedOn && first.from > addDaysIso(a.openedOn, 31) && (first.opening ?? 0) > 1)
      out.push({
        key: `stmt-before:${a.id}`,
        assetId: a.id,
        title: `Send the statements of ${name(a)} from ${day(a.openedOn)} to ${day(addDaysIso(first.from, -1))}: it held ${inr(first.opening!)} when the first one on file starts`,
        rank: 2,
      });
    // the days between two statements whose balances do not join up
    let reach = first;
    for (const s of sts.slice(1)) {
      if (s.to <= reach.to) continue;
      const joined =
        s.from <= addDaysIso(reach.to, 1) ||
        s.opening === null ||
        reach.closing === null ||
        Math.abs(s.opening - reach.closing) < 1;
      if (!joined)
        out.push({
          key: `stmt-gap:${a.id}:${reach.to}`,
          assetId: a.id,
          title: `Send the statement of ${name(a)} for ${day(addDaysIso(reach.to, 1))} to ${day(addDaysIso(s.from, -1))}: the balance moves by ${inr(s.opening! - reach.closing!)} between the statements on file`,
          rank: 2,
        });
      reach = s;
    }
    // a download with no balances that drifts from the balances on record by a steady amount
    const lines = input.unbalanced.get(a.id);
    if (lines?.length && a.openedOn && lines[0]!.date <= addDaysIso(a.openedOn, 3)) {
      const gap = steadyGap(
        lines,
        input.recorded.filter((r) => r.assetId === a.id && r.date >= lines[0]!.date),
      );
      if (gap)
        out.push({
          key: `stmt-missing:${a.id}:${gap.to.slice(0, 7)}`,
          assetId: a.id,
          title: `Send the statement (PDF) of ${name(a)} for ${day(gap.from)} to ${day(gap.to)}: about ${inr(gap.amount)} of money ${gap.amount < 0 ? 'out' : 'in'} is missing from the bank’s download, so its balances are ${inr(gap.amount)} off from then on`,
          rank: 1,
        });
    }
  }
  if (input.toAnswer > 0)
    out.push({
      key: 'answer-lines',
      assetId: null,
      title: `Answer ${input.toAnswer} bank statement line${input.toAnswer === 1 ? '' : 's'} in Explain movements → Bank statements (what each one was)`,
      rank: 2,
    });
  if (!input.ownershipFrom)
    out.push({
      key: 'clubbing-date',
      assetId: null,
      title:
        'Set the day money moved between you is counted for clubbing from (Settings → Estimates), so income on money given from then on is listed',
      rank: 1,
    });
  return out.sort((x, y) => x.rank - y.rank || x.title.localeCompare(y.title));
}

/**
 * The first recorded balance from which the summed lines are off by the same amount at every later one (within 10% of it, at
 * least three times and at most of the later ones): a missing line, and the days it can be in. A missing debit can only fall on a day after which the summed
 * balance stays above the amount (the real one cannot go below zero).
 */
export function steadyGap(
  lines: { date: string; amount: number }[],
  recorded: { date: string; amount: number }[],
): { from: string; to: string; amount: number } | null {
  const run: { date: string; balance: number }[] = [];
  let b = 0;
  for (const l of lines) {
    b = Math.round((b + l.amount) * 100) / 100;
    if (run.length && run[run.length - 1]!.date === l.date) run[run.length - 1]!.balance = b;
    else run.push({ date: l.date, balance: b });
  }
  const at = (date: string) => {
    let v = 0;
    for (const r of run) {
      if (r.date > date) break;
      v = r.balance;
    }
    return v;
  };
  const checks = [...recorded]
    .sort((x, y) => x.date.localeCompare(y.date))
    .map((r) => ({ date: r.date, gap: r.amount - at(r.date) }));
  for (let i = 0; i < checks.length; i++) {
    const g = checks[i]!.gap;
    if (Math.abs(g) < 1000) continue;
    const later = checks.slice(i);
    // within 10%: a balance on record is often read a few days off the month's end, so the gap wobbles around the missing line
    const same = later.filter((c) => Math.abs(c.gap - g) <= Math.abs(g) * 0.1);
    if (same.length < 3 || same.length < later.length * 0.6) continue;
    const lastGood = [...checks.slice(0, i)].reverse().find((c) => Math.abs(c.gap) < 1000);
    let from = lastGood ? addDaysIso(lastGood.date, 1) : lines[0]!.date;
    if (g < 0) {
      // the summed balance must stay at or above the missing amount from the day it left until the check: it left after the last
      // day the summed balance was below it
      const before = run.filter((r) => r.date < checks[i]!.date);
      const low = before.map((r) => r.balance < -g - 0.5).lastIndexOf(true);
      if (low >= 0) {
        const after = before[low + 1]?.date ?? addDaysIso(before[low]!.date, 1);
        if (after > from) from = after;
      }
    }
    return { from, to: endOfMonth(checks[i]!.date), amount: g };
  }
  return null;
}
