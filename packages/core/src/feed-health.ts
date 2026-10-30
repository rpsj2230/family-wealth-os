/**
 * Is each account still telling us what happens in it, now that no statements are uploaded? The bank's alerts and the statements it
 * e-mails are the only feed, so the gaps in that feed are worked out here and listed as "needed from you" (tasks, the daily e-mail):
 *
 *  - silent: an account in use that has sent no alert, no e-mailed statement and no balance for the Settings number of days. The fix
 *    is once and for all: switch on e-mail alerts and monthly e-statements to Gmail in the bank's net banking;
 *  - missed: in the last Settings days, a balance the bank reported that does not follow from the lines before it (an alert that
 *    never came). The month's e-statement fills it by itself; if none comes, the account is silent and that is said;
 *  - locked: a statement the bank e-mailed that none of the saved passwords opens, or that names an account not on record. It is read
 *    again by itself once the password or the last four digits are saved.
 *
 * Each need goes away by itself once what it asks for arrives. Pure: no I/O.
 */
import type { Need, NeedAccount } from './needed-from-you';

/** One thing the bank said about an account: a line (with or without the balance after it), or a balance alone. */
export interface FeedPoint {
  date: string;
  /** + in, − out; 0 for a balance alone */
  amount: number;
  /** the balance after it, when the bank gave one */
  balance: number | null;
  /** from an alert or an e-mailed balance (the feed being checked), not from an uploaded statement */
  fromAlert: boolean;
  /** a balance alone (no movement): it may be the balance at the start of that day or at its end */
  balanceOnly?: boolean;
}

export interface FeedInput {
  today: string;
  /** Settings: an account silent this many days is flagged; the last this many days are checked for missed movements */
  silentDays: number;
  gapDays: number;
  accounts: NeedAccount[];
  /** the last day each account was heard from: an alert, an e-mailed statement, a balance from the bank, or any statement line */
  lastHeard: Map<string, string>;
  /** each account's points of the last gapDays, in the order the bank gave them */
  points: Map<string, FeedPoint[]>;
  /** statements the bank e-mailed that could not be saved, with why */
  locked: { sender: string; date: string; why: 'password' | 'account'; last4?: string | null }[];
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string) =>
  `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const inr = (n: number) => {
  const l = Math.abs(n) / 100_000;
  return l >= 1 ? `₹${l.toFixed(2)} L` : `₹${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;
};
const near = (a: number, b: number) => Math.abs(a - b) <= 1;

/**
 * The movements an account's own balances say are missing: walking the points in order, the running balance is carried by every
 * line (a line with no balance moves it too); where the bank's next balance is not what the lines before it reach, something moved
 * that no alert reported. Only a stretch that ends or starts at an alert is judged (an uploaded statement's own breaks are the
 * reader's). Within a day the order of lines may differ from the bank's, so a day is judged as a whole.
 */
export function missedMovements(
  points: FeedPoint[],
): { from: string; to: string; amount: number }[] {
  const out: { from: string; to: string; amount: number }[] = [];
  let run: number | null = null;
  let since: { date: string; fromAlert: boolean } | null = null;
  const byDay = new Map<string, FeedPoint[]>();
  for (const p of points) byDay.set(p.date, [...(byDay.get(p.date) ?? []), p]);
  for (const [date, ps] of [...byDay].sort((a, b) => a[0].localeCompare(b[0]))) {
    const moves = ps.filter((p) => !p.balanceOnly);
    const net = moves.reduce((s, p) => s + p.amount, 0);
    const told = ps.filter((p) => p.balance !== null);
    const alert = ps.some((p) => p.fromAlert);
    if (run === null) {
      // the first balance the bank gave sets the start: the end of that day is the last balance given
      const last = [...told].reverse().find((p) => !p.balanceOnly) ?? told[told.length - 1];
      if (last) {
        run = last.balanceOnly ? last.balance! + net : last.balance!;
        since = { date, fromAlert: alert };
      }
      continue;
    }
    const start = run;
    const end = Math.round((run + net) * 100) / 100;
    if (told.length) {
      // the day fits when a balance the bank gave there is one the lines can reach: the end of the day, after one of its lines, or
      // (for a balance alone) its start
      const reachable = new Set<number>([start, end]);
      let r = start;
      for (const p of moves) {
        r = Math.round((r + p.amount) * 100) / 100;
        reachable.add(r);
      }
      const fits = told.every((p) => [...reachable].some((v) => near(v, p.balance!)));
      if (!fits && (alert || since?.fromAlert)) {
        const said = told[told.length - 1]!;
        const actual = said.balanceOnly ? said.balance! + net : said.balance!;
        const amount = Math.round((actual - end) * 100) / 100;
        if (Math.abs(amount) > 1) out.push({ from: since!.date, to: date, amount });
        run = actual;
      } else run = fits ? end : (told[told.length - 1]!.balance ?? end);
      since = { date, fromAlert: alert };
    } else {
      run = end;
      if (alert) since = { date, fromAlert: true };
    }
  }
  return out;
}

export function feedNeeds(input: FeedInput): Need[] {
  const out: Need[] = [];
  const name = (a: NeedAccount) =>
    `${a.owner}’s ${a.bank}${a.kind ? ` ${a.kind}` : ''}${a.last4 ? ` (…${a.last4})` : ''}`;
  const from = new Date(Date.parse(`${input.today}T00:00:00Z`) - input.gapDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  for (const a of input.accounts) {
    const heard = input.lastHeard.get(a.id) ?? null;
    const quiet = heard ? daysBetween(heard, input.today) : null;
    if (heard && quiet! >= input.silentDays)
      out.push({
        key: `feed-silent:${a.id}`,
        assetId: a.id,
        title: `No news from ${name(a)} since ${day(heard)} (${quiet} days): in the bank’s net banking, switch on an e-mail alert for every transaction and the monthly e-statement, both to your Gmail. Once that is done, it is read by itself.`,
        rank: 2,
      });
    for (const g of missedMovements((input.points.get(a.id) ?? []).filter((p) => p.date >= from)))
      out.push({
        key: `feed-gap:${a.id}:${g.to}`,
        assetId: a.id,
        title: `${name(a)}: about ${inr(g.amount)} went ${g.amount < 0 ? 'out' : 'in'} between ${day(g.from)} and ${day(g.to)} with no alert for it. The month’s e-statement fills it in by itself; if the bank sends no alert for such payments, switch alerts on for every transaction.`,
        rank: 3,
      });
  }
  const seen = new Set<string>();
  for (const l of [...input.locked].sort((x, y) => y.date.localeCompare(x.date))) {
    const key =
      l.why === 'password' ? `feed-locked:${l.sender}` : `feed-noacct:${l.sender}:${l.last4 ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      assetId: null,
      title:
        l.why === 'password'
          ? `The statement ${l.sender} e-mailed on ${day(l.date)} could not be opened: save the password this bank uses for its statements (Import → Gmail statements → Statement passwords). It is read again by itself.`
          : `The statement ${l.sender} e-mailed on ${day(l.date)} is for an account ${l.last4 ? `ending ${l.last4} ` : ''}that is not on record: add its last four digits to the account (Accounts). It is read again by itself.`,
      rank: 1,
    });
  }
  return out;
}
