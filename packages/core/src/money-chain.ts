/**
 * The money chain: every rupee followed step by step, back to where it started and forward to where it is now.
 *
 * The money trail (money-trail.ts) says what an account is made of; this says how it got there. Every statement line is a step. A
 * transfer is two steps joined: the money out of one account is the money into the other. Money out of an account is made of the
 * money that came into it before, taken in the order set in Settings: the latest money first (what came in last is what goes out
 * next: a transfer in on Monday and a deposit booked on Tuesday are the same money), or a share of everything in the account. A
 * deposit is made of the line or lines that booked it and pays the same money back when it matures, with its interest on top; a
 * renewal carries one deposit into the next. A fund is made of the lines that bought it and pays them back, oldest first, when it is
 * sold. So any line can be followed back (the account it came from, the account that one came from, and so on, to Singapore, to
 * interest, to money already there before the first statement) and forward (the deposit it booked, the account the deposit paid
 * back into, the fund it bought, or where it still is today), with the amount at every step, however the money was split or joined.
 *
 * Where the statements do not say, it is matched here by amount and date, and marked as matched (never presented as the bank's):
 *  - a transfer whose other side the rules did not name: the same sum arriving in another account within the days in Settings;
 *  - a deposit on file with no line that booked it: one to three lines out of the holder's accounts around its start that add up to
 *    its amount (a deposit booked from two places);
 *  - a deposit on file with no line it paid back to: a line in of its maturity amount around its end;
 *  - a deposit booked the day another of the same person at the same bank ended, for the amount it paid: the renewal.
 *
 * Pure: no I/O.
 */
import {
  ORIGIN_LABEL,
  originOf,
  type OriginKind,
  type TrailAsset,
  type TrailLine,
} from './money-trail';
import { addDaysIso } from './harvest-lots';
import type { ReportTable } from './reports';
import { bankWord, type LineClass } from './statement-classify';

/** The order money leaves an account in: the latest money in goes out first, or a share of everything in it. */
export type ChainMethod = 'recent' | 'mix';

/**
 * How a step is known: the same account (money out is made of the money in before it, by the method), a transfer whose two lines
 * were both found, the rules (the narration or a record names the other side), or a match made here by amount and date.
 */
export type LinkBasis = 'same_account' | 'pair' | 'rules' | 'guess';

export interface ChainLink {
  node: string;
  amount: number;
  /** the deposit or fund the money passed through on this link */
  via?: string;
  basis: LinkBasis;
}

/** Money that starts at a step: it came from nowhere the statements follow. */
export interface ChainStart {
  kind: OriginKind;
  amount: number;
  /** the account, deposit or fund it came from, when known */
  assetId?: string | null;
  /** whose money: the holder of the account it arrived in */
  person: string;
  /** the transfer from Singapore on file it is */
  remittanceId?: string;
}

/** Where money that left goes when the statements follow it no further. */
export type EndKind =
  'spent' | 'fee' | 'tax' | 'untraced_account' | 'not_found' | 'untraced_fund' | 'unexplained';

export interface ChainEnd {
  kind: EndKind;
  amount: number;
  /** the account it went to, when known */
  assetId?: string | null;
}

export interface ChainNode {
  /** the statement line's id; `open:`, `before:` and `renew:` for the steps no line is */
  id: string;
  /**
   * a statement line; an account's balance before its first statement; a deposit booked with money the statements do not show; a
   * renewal; a deposit paid out into an account with no statement on file
   */
  kind: 'line' | 'opening' | 'deposit_before' | 'renewal' | 'payback';
  /** the account the line is in; the deposit, for a deposit booked before the statements and a renewal */
  assetId: string;
  date: string;
  /** + in, − out, as on the statement; + for the steps no line is */
  amount: number;
  cls: LineClass | null;
  narration: string;
  /** the deposit or fund this line put money into, or took it out of */
  holding?: string;
  holdingBasis?: LinkBasis;
  /** where its money came from */
  from: ChainLink[];
  /** the part of it that starts here */
  starts: ChainStart[];
  /** where its money went */
  to: ChainLink[];
  /** the part of it still where it went: the account it came into, the deposit or fund it bought */
  left: { assetId: string; amount: number }[];
  /** the part that left the trail: spent, charges, an account with no statements */
  ends: ChainEnd[];
}

export interface ChainDeposit {
  assetId: string;
  ownerId: string;
  bank?: string | null;
  principal: number;
  bookedOn: string;
  maturityOn: string;
  endedOn: string | null;
  maturityAmount: number | null;
}

export interface MoneyChain {
  nodes: Map<string, ChainNode>;
  /** each deposit's and fund's money in: the steps that booked or bought it */
  into: Map<string, ChainLink[]>;
  /** each deposit's and fund's money out: the steps it paid back into */
  outOf: Map<string, ChainLink[]>;
  /** each account's money today: the steps whose money is still in it */
  now: Map<string, ChainLink[]>;
  /** links matched here by amount and date */
  guessed: {
    transfers: number;
    depositBooked: number;
    depositPaidBack: number;
    renewals: number;
    /** deposits booked, and money coming back, from money that went to accounts with no statement on file */
    fromOutside: number;
    /** deposits that ended with no line paying them back: paid into the holder's accounts with no statement on file */
    paidOutside: number;
  };
  /** each person's money in accounts with no statement on file, as far as it is known: the steps it came from */
  outside: Map<string, ChainLink[]>;
  method: ChainMethod;
}

interface Lot {
  node: string;
  amount: number;
  via?: string;
  basis: LinkBasis;
}

const daysApart = (a: string, b: string) =>
  Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86400000;
const cents = (n: number) => Math.round(Math.abs(n) * 100);
const sum = (xs: { amount: number }[]) => xs.reduce((s, x) => s + x.amount, 0);
const TINY = 0.005;

/** Takes `amount` out of a pool: the latest lots first, the oldest first, or a share of each. What is missing is returned apart. */
function take(
  pool: Lot[],
  amount: number,
  order: 'recent' | 'oldest' | 'mix',
): { parts: Lot[]; short: number } {
  const parts: Lot[] = [];
  const have = sum(pool);
  const want = Math.min(amount, Math.max(have, 0));
  if (want > TINY) {
    if (order === 'mix') {
      for (const lot of pool) {
        const share = (lot.amount / have) * want;
        parts.push({ ...lot, amount: share });
        lot.amount -= share;
      }
    } else {
      let need = want;
      while (need > TINY && pool.length) {
        const lot = order === 'recent' ? pool[pool.length - 1]! : pool[0]!;
        const a = Math.min(lot.amount, need);
        parts.push({ ...lot, amount: a });
        lot.amount -= a;
        need -= a;
        if (lot.amount <= TINY) {
          if (order === 'recent') pool.pop();
          else pool.shift();
        }
      }
    }
  }
  for (let i = pool.length - 1; i >= 0; i--) if (pool[i]!.amount <= TINY) pool.splice(i, 1);
  return { parts, short: Math.max(0, amount - want) };
}

/** Lines that add up to `target`: one, two or three of them, the fewest first, then the closest in date. */
function subsetFor<T extends { amount: number; date: string }>(
  cands: T[],
  target: number,
  on: string,
): T[] | null {
  const ok = (xs: T[]) =>
    Math.abs(sum(xs.map((x) => ({ amount: Math.abs(x.amount) }))) - target) <= 1;
  const dist = (xs: T[]) => xs.reduce((s, x) => s + daysApart(x.date, on), 0);
  const c = cands.slice(0, 15);
  for (let size = 1; size <= 3; size++) {
    let best: T[] | null = null;
    const pick = (start: number, chosen: T[]) => {
      if (chosen.length === size) {
        if (ok(chosen) && (!best || dist(chosen) < dist(best))) best = [...chosen];
        return;
      }
      for (let i = start; i < c.length; i++) pick(i + 1, [...chosen, c[i]!]);
    };
    pick(0, []);
    if (best) return best;
  }
  return null;
}

export function moneyChain(args: {
  /** the statement lines as the trail reads them, with the bank's order within a day (`seq`, oldest 0) when known */
  lines: (TrailLine & { seq?: number })[];
  assets: TrailAsset[];
  deposits: ChainDeposit[];
  /** each account's balance before its first statement line */
  openings: Map<string, number>;
  method: ChainMethod;
  /** a transfer's two lines, or a deposit and the lines that booked it, may be this many days apart */
  pairDays: number;
  /** the bank each account is with, so a deposit is matched to the lines of its own bank first */
  bankOf?: Map<string, string | null>;
  /** remittances: the transfer from Singapore each credit is, by line id */
  remittanceOf?: Map<string, string>;
  /**
   * the periods each account's bank statements cover (merged; the bank's alerts left out). With them, money whose source lies
   * before the statements begin is told apart from money that went through months with no statement: the first is the family's
   * own money from before the records (like an account's opening balance), the second a gap
   */
  spans?: Record<string, { from: string; to: string }[]>;
}): MoneyChain {
  const { method, pairDays } = args;
  const abroad = new Set(args.assets.filter((a) => a.abroad).map((a) => a.id));
  const owner = new Map(args.assets.filter((a) => !a.abroad).map((a) => [a.id, a.ownerId]));
  const isFund = new Set(args.assets.filter((a) => a.kind === 'fund').map((a) => a.id));
  const deposits = new Map(args.deposits.map((d) => [d.assetId, d]));
  const lines = args.lines.filter((l) => !abroad.has(l.assetId));
  const withLines = new Set(lines.map((l) => l.assetId));
  const bankOf = (id: string) => {
    const b = args.bankOf?.get(id);
    return b ? bankWord(b) : '';
  };
  /** the first day any statement of an account covers, and whether its statements run without a break from then to a day */
  const firstCovered = (id: string) => args.spans?.[id]?.[0]?.from ?? null;
  const unbrokenTo = (id: string, day: string) => {
    const sp = args.spans?.[id];
    return (
      !!sp?.length && sp[0]!.from <= day && sp.some((x) => x.from === sp[0]!.from && x.to >= day)
    );
  };
  /**
   * A deposit booked before any statement of its holder's accounts at its bank begins: its money is the family's own from before
   * the records (it could not show on a statement), not a gap.
   */
  const beforeStatements = (d: { assetId: string; ownerId: string; bookedOn: string }) => {
    if (!args.spans) return false;
    const bank = bankOf(d.assetId);
    const accts = [...owner.keys()].filter(
      (x) => owner.get(x) === d.ownerId && (!bank || bankOf(x) === bank) && firstCovered(x),
    );
    return accts.length > 0 && accts.every((x) => firstCovered(x)! > d.bookedOn);
  };

  const nodes = new Map<string, ChainNode>();
  const node = (n: Omit<ChainNode, 'from' | 'starts' | 'to' | 'left' | 'ends'>): ChainNode => {
    const x: ChainNode = { ...n, from: [], starts: [], to: [], left: [], ends: [] };
    nodes.set(x.id, x);
    return x;
  };
  for (const l of lines)
    node({
      id: l.id,
      kind: 'line',
      assetId: l.assetId,
      date: l.date,
      amount: l.amount,
      cls: l.cls,
      narration: l.narration,
    });
  const link = (fromId: string, toId: string, amount: number, basis: LinkBasis, via?: string) => {
    if (amount <= TINY) return;
    const f = nodes.get(fromId)!;
    const t = nodes.get(toId)!;
    f.to.push({ node: toId, amount, basis, ...(via ? { via } : {}) });
    t.from.push({ node: fromId, amount, basis, ...(via ? { via } : {}) });
  };
  const guessed = {
    transfers: 0,
    depositBooked: 0,
    depositPaidBack: 0,
    renewals: 0,
    fromOutside: 0,
    paidOutside: 0,
  };

  // ---- 1. transfers: the money out of one account and the same sum into the other, the closest in date
  const pairOf = new Map<string, string>();
  const byAmount = new Map<string, TrailLine[]>();
  for (const l of lines)
    if (l.amount > 0) {
      const k = `${l.assetId}|${cents(l.amount)}`;
      byAmount.set(k, [...(byAmount.get(k) ?? []), l]);
    }
  const byDate = [...lines].sort(
    (a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id),
  );
  const nearest = (d: TrailLine, cands: TrailLine[], fits: (c: TrailLine) => boolean) => {
    let best: TrailLine | null = null;
    for (const c of cands) {
      if (pairOf.has(c.id) || !fits(c) || daysApart(c.date, d.date) > pairDays) continue;
      if (!best || daysApart(c.date, d.date) < daysApart(best.date, d.date)) best = c;
    }
    return best;
  };
  for (const d of byDate) {
    if (d.amount >= 0 || d.cls !== 'own_transfer' || !d.counterpart) continue;
    if (!withLines.has(d.counterpart) || d.counterpart === d.assetId) continue;
    const c = nearest(
      d,
      byAmount.get(`${d.counterpart}|${cents(d.amount)}`) ?? [],
      (x) => x.cls === 'own_transfer' && (x.counterpart === d.assetId || !x.counterpart),
    );
    if (!c) continue;
    pairOf.set(d.id, c.id).set(c.id, d.id);
    link(d.id, c.id, -d.amount, 'pair');
  }
  // the rules named the other account but its line came later than usual (a transfer that took longer): the same sum there, up to
  // three times the days, among the lines in that are not placed yet
  for (const d of byDate) {
    if (d.amount >= 0 || pairOf.has(d.id) || d.cls !== 'own_transfer' || !d.counterpart) continue;
    if (!withLines.has(d.counterpart) || d.counterpart === d.assetId) continue;
    let best: TrailLine | null = null;
    for (const c of byAmount.get(`${d.counterpart}|${cents(d.amount)}`) ?? []) {
      if (pairOf.has(c.id) || c.date < d.date || daysApart(c.date, d.date) > pairDays * 3) continue;
      if (!(
        c.cls === 'ask_in' ||
        (c.cls === 'own_transfer' && (!c.counterpart || c.counterpart === d.assetId))
      ))
        continue;
      if (!best || daysApart(c.date, d.date) < daysApart(best.date, d.date)) best = c;
    }
    if (!best) continue;
    pairOf.set(d.id, best.id).set(best.id, d.id);
    link(d.id, best.id, -d.amount, 'guess');
    guessed.transfers++;
  }
  // the rules named no other side, or no line of it: the same sum in another account of the household within the days
  const loose = (l: TrailLine) =>
    !pairOf.has(l.id) &&
    !args.remittanceOf?.has(l.id) &&
    (l.cls === (l.amount > 0 ? 'ask_in' : 'ask_out') ||
      (l.cls === 'own_transfer' && (!l.counterpart || withLines.has(l.counterpart))));
  const looseIn = new Map<number, TrailLine[]>();
  for (const l of byDate)
    if (l.amount > 0 && loose(l))
      looseIn.set(cents(l.amount), [...(looseIn.get(cents(l.amount)) ?? []), l]);
  for (const d of byDate) {
    if (d.amount >= 0 || !loose(d)) continue;
    const c = nearest(
      d,
      looseIn.get(cents(d.amount)) ?? [],
      (x) =>
        x.assetId !== d.assetId &&
        (!d.counterpart || d.counterpart === x.assetId) &&
        (!x.counterpart || x.counterpart === d.assetId),
    );
    if (!c) continue;
    pairOf.set(d.id, c.id).set(c.id, d.id);
    link(d.id, c.id, -d.amount, 'guess');
    guessed.transfers++;
  }

  // ---- 2. deposits: the lines that booked each one, and the line it paid back into
  const bookedBy = new Map<string, { dep: string; basis: LinkBasis }>();
  const paidBy = new Map<string, { dep: string; basis: LinkBasis }>();
  const depHasFunding = new Set<string>();
  const depHasPayback = new Set<string>();
  for (const l of lines) {
    if (l.counterpart && deposits.has(l.counterpart)) {
      if (l.amount < 0 && l.cls === 'fd_funding') {
        bookedBy.set(l.id, { dep: l.counterpart, basis: 'rules' });
        depHasFunding.add(l.counterpart);
      } else if (l.amount > 0 && (l.cls === 'fd_proceeds' || l.cls === 'own_transfer')) {
        paidBy.set(l.id, { dep: l.counterpart, basis: 'rules' });
        depHasPayback.add(l.counterpart);
      }
    }
  }
  const free = (l: TrailLine) =>
    !pairOf.has(l.id) && !bookedBy.has(l.id) && !paidBy.has(l.id) && !args.remittanceOf?.has(l.id);
  const lastLine = byDate.length ? byDate[byDate.length - 1]!.date : '';
  const depsByDate = [...deposits.values()].sort((a, b) => a.bookedOn.localeCompare(b.bookedOn));
  // a deposit booked from one to three lines (its own bank's accounts first, then the holder's), adding up to its amount
  for (const d of depsByDate) {
    if (depHasFunding.has(d.assetId)) continue;
    const there = d.bank ? bankWord(d.bank) : '';
    const cands = byDate
      .filter(
        (l) =>
          l.amount < 0 &&
          free(l) &&
          (l.cls === 'fd_funding' ||
            l.cls === 'ask_out' ||
            (l.cls === 'own_transfer' && !l.counterpart)) &&
          daysApart(l.date, d.bookedOn) <= pairDays &&
          (owner.get(l.assetId) === d.ownerId || (there !== '' && bankOf(l.assetId) === there)),
      )
      .sort(
        (a, b) =>
          Number(there !== '' && bankOf(b.assetId) === there) -
            Number(there !== '' && bankOf(a.assetId) === there) ||
          daysApart(a.date, d.bookedOn) - daysApart(b.date, d.bookedOn),
      );
    // a deposit booked in pieces: the lines of one day in one account that together make its amount
    const byDay = new Map<string, TrailLine[]>();
    for (const l of cands) {
      const k = `${l.assetId}|${l.date}`;
      byDay.set(k, [...(byDay.get(k) ?? []), l]);
    }
    const whole = [...byDay.values()]
      .filter(
        (g) => g.length > 3 && Math.abs(g.reduce((s2, l) => s2 - l.amount, 0) - d.principal) <= 1,
      )
      .sort((a, b) => daysApart(a[0]!.date, d.bookedOn) - daysApart(b[0]!.date, d.bookedOn))[0];
    const set = whole ?? subsetFor(cands, d.principal, d.bookedOn);
    if (!set) continue;
    for (const l of set) bookedBy.set(l.id, { dep: d.assetId, basis: 'guess' });
    depHasFunding.add(d.assetId);
    guessed.depositBooked++;
  }
  // a deposit paid back: a line in of its maturity amount (or, for a line the narration calls a deposit's, of a likely amount)
  for (const d of depsByDate) {
    if (depHasPayback.has(d.assetId)) continue;
    const end = d.endedOn ?? d.maturityOn;
    if (!end || end > lastLine) continue;
    const there = d.bank ? bankWord(d.bank) : '';
    const window = Math.max(pairDays, 7);
    let best: TrailLine | null = null;
    let bestScore = Infinity;
    for (const l of byDate) {
      if (l.amount <= 0 || !free(l) || daysApart(l.date, end) > window) continue;
      if (!(
        l.cls === 'fd_proceeds' ||
        l.cls === 'ask_in' ||
        (l.cls === 'own_transfer' && !l.counterpart)
      ))
        continue;
      if (!(owner.get(l.assetId) === d.ownerId || (there !== '' && bankOf(l.assetId) === there)))
        continue;
      const exact = d.maturityAmount !== null && Math.abs(d.maturityAmount - l.amount) <= 1;
      const likely =
        l.cls === 'fd_proceeds' && l.amount >= d.principal * 0.97 && l.amount <= d.principal * 1.6;
      if (!exact && !likely) continue;
      const score = (exact ? 0 : 100) + daysApart(l.date, end);
      if (score < bestScore) {
        best = l;
        bestScore = score;
      }
    }
    if (!best) continue;
    paidBy.set(best.id, { dep: d.assetId, basis: 'guess' });
    depHasPayback.add(d.assetId);
    guessed.depositPaidBack++;
  }
  // a renewal: a deposit booked with nothing found for it, on the day another of the same person at the same bank ended unpaid
  const renewalOf = new Map<string, string>();
  const renewed = new Set<string>();
  for (const d2 of depsByDate) {
    if (depHasFunding.has(d2.assetId)) continue;
    let best: ChainDeposit | null = null;
    let bestScore = Infinity;
    for (const d1 of depsByDate) {
      if (d1.assetId === d2.assetId || renewed.has(d1.assetId) || depHasPayback.has(d1.assetId))
        continue;
      if (d1.ownerId !== d2.ownerId) continue;
      if (d1.bank && d2.bank && bankWord(d1.bank) !== bankWord(d2.bank)) continue;
      const end = d1.endedOn ?? d1.maturityOn;
      if (!end || end > d2.bookedOn || daysApart(end, d2.bookedOn) > pairDays) continue;
      const most = (d1.maturityAmount ?? d1.principal * 1.6) + 1;
      if (d2.principal < d1.principal - 1 || d2.principal > most) continue;
      const score =
        Math.abs(d2.principal - (d1.maturityAmount ?? d2.principal)) +
        daysApart(end, d2.bookedOn) * 10;
      if (score < bestScore) {
        best = d1;
        bestScore = score;
      }
    }
    if (!best) continue;
    renewalOf.set(d2.assetId, best.assetId);
    renewed.add(best.assetId);
    depHasFunding.add(d2.assetId);
    depHasPayback.add(best.assetId);
    guessed.renewals++;
  }

  // ---- 3. replay in date order: within a day, the bank's own order in each account; renewals at the start of their day
  const pools = new Map<string, Lot[]>();
  const pool = (id: string) => pools.get(id) ?? pools.set(id, []).get(id)!;
  const into = new Map<string, ChainLink[]>();
  const outOf = new Map<string, ChainLink[]>();
  const push = (m: Map<string, ChainLink[]>, k: string, l: ChainLink) =>
    m.set(k, [...(m.get(k) ?? []), l]);
  const firstDate = new Map<string, string>();
  for (const l of byDate) if (!firstDate.has(l.assetId)) firstDate.set(l.assetId, l.date);
  for (const [id, amt] of args.openings) {
    if (!(amt > TINY) || !withLines.has(id)) continue;
    const n = node({
      id: `open:${id}`,
      kind: 'opening',
      assetId: id,
      date: firstDate.get(id) ?? '',
      amount: amt,
      cls: null,
      narration: 'Balance before the first statement on file',
    });
    n.starts.push({ kind: 'before_records', amount: amt, person: owner.get(id) ?? '' });
    pool(id).push({ node: n.id, amount: amt, basis: 'same_account' });
  }
  /** a deposit's own money: what booked it; when nothing on the statements did, the deposit as booked before them */
  const depositPool = (depId: string) => {
    const p = pool(depId);
    if (!depHasFunding.has(depId) && !nodes.has(`before:${depId}`)) {
      const d = deposits.get(depId)!;
      const n = node({
        id: `before:${depId}`,
        kind: 'deposit_before',
        assetId: depId,
        date: d.bookedOn,
        amount: d.principal,
        cls: null,
        narration: 'Deposit booked with money the statements on file do not show',
      });
      n.starts.push(
        beforeStatements(d)
          ? { kind: 'before_records', amount: d.principal, person: d.ownerId }
          : { kind: 'untraced_deposit', amount: d.principal, assetId: depId, person: d.ownerId },
      );
      p.unshift({ node: n.id, amount: d.principal, via: depId, basis: 'rules' });
      push(into, depId, { node: n.id, amount: d.principal, via: depId, basis: 'rules' });
    }
    return p;
  };
  /** money out of a deposit or fund into a step: the lots it holds, oldest first; returns what it could give */
  const payOut = (holding: string, p: Lot[], amount: number, to: string) => {
    const { parts } = take(p, amount, 'oldest');
    for (const part of parts) link(part.node, to, part.amount, part.basis, holding);
    return sum(parts);
  };

  /** deposits already paid back (by a line, a renewal or into an account with no statement) */
  const paidDeps = new Set<string>([...depHasPayback]);
  /** money a person sent to accounts with no statement on file, taken for a step: the latest first */
  const fromAway = (person: string, amount: number, to: string) => {
    const { parts } = take(pool(`away:${person}`), amount, 'recent');
    for (const part of parts) link(part.node, to, part.amount, 'guess', `away:${person}`);
    return sum(parts);
  };
  /**
   * A deposit pay-back the rules did not tie to a deposit: the deposits on file of the holder (or at the account's bank) that end
   * around that day, one to three of them, whose principal the amount covers with interest on top; paid from what booked them.
   */
  const payWindow = Math.max(pairDays, 7) * 4;
  // the deposit pay-back lines of one account on one day: a deposit on file is often several at the bank, paid back in pieces
  const paybackDay = new Map<string, TrailLine[]>();
  for (const l of byDate)
    if (l.amount > 0 && l.cls === 'fd_proceeds' && free(l)) {
      const k = `${l.assetId}|${l.date}`;
      paybackDay.set(k, [...(paybackDay.get(k) ?? []), l]);
    }
  const groupMatch = new Map<string, ChainDeposit[] | null>();
  /** takes back a pay-back into an account with no statement: the deposit holds its money again */
  const unpay = (d: ChainDeposit) => {
    const r = nodes.get(`payback:${d.assetId}`);
    const away = pool(`away:${d.ownerId}`);
    const lot = away.find((x) => x.node === `payback:${d.assetId}`);
    if (!r || !lot || Math.abs(lot.amount - r.amount) > TINY) return false;
    away.splice(away.indexOf(lot), 1);
    for (const f of r.from) {
      const src = nodes.get(f.node)!;
      src.to = src.to.filter((e) => e.node !== r.id);
      pool(d.assetId).push({ node: f.node, amount: f.amount, via: d.assetId, basis: f.basis });
    }
    nodes.delete(r.id);
    outOf.set(
      d.assetId,
      (outOf.get(d.assetId) ?? []).filter((x) => x.node !== r.id),
    );
    paidDeps.delete(d.assetId);
    guessed.paidOutside--;
    return true;
  };
  /** the deposits on file one to three of which a day's pay-back lines cover: principal within, interest on top */
  const matchDeps = (l: TrailLine, holder: string, amount: number): ChainDeposit[] | null => {
    const here = bankOf(l.assetId);
    const cands = depsByDate
      .filter((d) => {
        if (depHasPayback.has(d.assetId) || renewed.has(d.assetId)) return false;
        const end = d.endedOn ?? d.maturityOn;
        if (!end || daysApart(end, l.date) > payWindow) return false;
        const there = d.bank ? bankWord(d.bank) : '';
        if (there && here && there !== here) return false;
        if (d.ownerId !== holder && !(there && there === here)) return false;
        return true;
      })
      .sort(
        (a, b) =>
          daysApart(a.endedOn ?? a.maturityOn, l.date) -
          daysApart(b.endedOn ?? b.maturityOn, l.date),
      )
      .slice(0, 10);
    let best: ChainDeposit[] | null = null;
    let bestScore = Infinity;
    const score = (xs: ChainDeposit[]) => {
      const lo = xs.reduce((s2, d) => s2 + d.principal, 0);
      const exact = xs.every((d) => d.maturityAmount !== null)
        ? Math.abs(xs.reduce((s2, d) => s2 + d.maturityAmount!, 0) - amount) <= 1
        : false;
      if (amount < lo - 1 || amount > lo * 1.6 + 1) return Infinity;
      return (
        (exact ? 0 : 1000) +
        xs.length * 100 +
        xs.reduce((s2, d) => s2 + daysApart(d.endedOn ?? d.maturityOn, l.date), 0)
      );
    };
    const pick = (start: number, chosen: ChainDeposit[]) => {
      if (chosen.length) {
        const sc = score(chosen);
        if (sc < bestScore) {
          best = [...chosen];
          bestScore = sc;
        }
      }
      if (chosen.length === 3) return;
      for (let i = start; i < cands.length; i++) pick(i + 1, [...chosen, cands[i]!]);
    };
    pick(0, []);
    return best;
  };
  /**
   * A deposit pay-back the rules did not tie to a deposit: with the other pay-back lines of that account that day, the deposits on
   * file of the holder (or at the account's bank) that end around then; each line takes its share of what booked them.
   */
  const fromDeposits = (l: TrailLine, holder: string, to: string) => {
    const key = `${l.assetId}|${l.date}`;
    const group = paybackDay.get(key) ?? [l];
    const total = group.reduce((s2, x) => s2 + x.amount, 0);
    const mark = (ds: ChainDeposit[]) => {
      for (const d of ds) {
        depHasPayback.add(d.assetId);
        if (paidDeps.has(d.assetId)) unpay(d);
        paidDeps.add(d.assetId);
      }
      guessed.depositPaidBack++;
    };
    let deps = groupMatch.get(key);
    if (deps === undefined) {
      deps = group.length > 1 ? matchDeps(l, holder, total) : null;
      groupMatch.set(key, deps);
      if (deps) mark(deps);
    }
    // the day's lines together, each its share; else this line on its own
    let share = 1;
    if (deps) share = l.amount / total;
    else {
      deps = matchDeps(l, holder, l.amount);
      if (deps) mark(deps);
    }
    if (!deps) return 0;
    let got = 0;
    for (const d of deps) {
      const p = pool(d.assetId);
      if (sum(p) > TINY) got += payOut(d.assetId, p, d.principal * share, to);
      else {
        // paid out into an account with no statement, and some of it used since: what is left of that money
        const away = pool(`away:${d.ownerId}`);
        const lot = away.find((x) => x.node === `payback:${d.assetId}`);
        if (lot) {
          const a = Math.min(lot.amount, d.principal * share);
          link(lot.node, to, a, 'guess', `away:${d.ownerId}`);
          lot.amount -= a;
          if (lot.amount <= TINY) away.splice(away.indexOf(lot), 1);
          got += a;
        }
      }
      push(outOf, d.assetId, {
        node: to,
        amount: d.principal * share,
        via: d.assetId,
        basis: 'guess',
      });
    }
    return got;
  };
  type Ev = { date: string; order: number; seq: number; run: () => void };
  const events: Ev[] = [];
  for (const [d2, d1] of renewalOf) {
    const dep2 = deposits.get(d2)!;
    events.push({
      date: dep2.bookedOn,
      order: 0,
      seq: 0,
      run: () => {
        const r = node({
          id: `renew:${d2}`,
          kind: 'renewal',
          assetId: d2,
          date: dep2.bookedOn,
          amount: dep2.principal,
          cls: null,
          narration: 'Renewed from the deposit that ended that day',
          holding: d2,
          holdingBasis: 'guess',
        });
        const got = payOut(d1, depositPool(d1), dep2.principal, r.id);
        if (dep2.principal - got > TINY)
          r.starts.push({
            kind: 'deposit_interest',
            amount: dep2.principal - got,
            assetId: d1,
            person: deposits.get(d1)!.ownerId,
          });
        push(outOf, d1, { node: r.id, amount: dep2.principal, via: d1, basis: 'guess' });
        pool(d2).push({ node: r.id, amount: dep2.principal, via: d2, basis: 'guess' });
        push(into, d2, { node: r.id, amount: dep2.principal, via: d2, basis: 'guess' });
      },
    });
  }
  // a deposit on file that nothing on the statements booked: booked from its holder's money outside the statements, the latest first
  // after the days a transfer for it may post in (dated the day it was booked)
  for (const d of depsByDate) {
    if (depHasFunding.has(d.assetId)) continue;
    events.push({
      date: addDaysIso(d.bookedOn, pairDays),
      order: 2,
      seq: 1,
      run: () => {
        if (nodes.has(`before:${d.assetId}`)) return;
        const n = node({
          id: `before:${d.assetId}`,
          kind: 'deposit_before',
          assetId: d.assetId,
          date: d.bookedOn,
          amount: d.principal,
          cls: null,
          narration: 'Deposit booked with money the statements on file do not show',
        });
        // booked before any statement of its bank's accounts: the family's money from before the records
        const early = beforeStatements(d);
        const got = early ? 0 : fromAway(d.ownerId, d.principal, n.id);
        if (got > TINY) guessed.fromOutside++;
        if (d.principal - got > TINY)
          n.starts.push(
            early
              ? { kind: 'before_records', amount: d.principal - got, person: d.ownerId }
              : {
                  kind: 'untraced_deposit',
                  amount: d.principal - got,
                  assetId: d.assetId,
                  person: d.ownerId,
                },
          );
        pool(d.assetId).unshift({
          node: n.id,
          amount: d.principal,
          via: d.assetId,
          basis: 'rules',
        });
        push(into, d.assetId, { node: n.id, amount: d.principal, via: d.assetId, basis: 'rules' });
      },
    });
  }
  // a deposit on file that ended with no line paying it back: paid into its holder's accounts with no statement on file
  for (const d of depsByDate) {
    const end = d.endedOn ?? d.maturityOn;
    if (!end || end > lastLine || renewed.has(d.assetId)) continue;
    // on the day it ended; a line that turns out to be the pay-back takes it over (fromDeposits)
    events.push({
      date: end,
      order: 2,
      seq: 0,
      run: () => {
        if (paidDeps.has(d.assetId)) return;
        const p = depositPool(d.assetId);
        if (sum(p) <= TINY) return;
        paidDeps.add(d.assetId);
        const r = node({
          id: `payback:${d.assetId}`,
          kind: 'payback',
          assetId: d.assetId,
          date: end,
          amount: 0,
          cls: null,
          narration: 'Paid back into an account with no statement on file',
          holding: d.assetId,
          holdingBasis: 'guess',
        });
        const got = payOut(d.assetId, p, Infinity, r.id);
        const interest = d.maturityAmount !== null ? Math.max(0, d.maturityAmount - got) : 0;
        if (interest > TINY)
          r.starts.push({
            kind: 'deposit_interest',
            amount: interest,
            assetId: d.assetId,
            person: d.ownerId,
          });
        r.amount = got + interest;
        push(outOf, d.assetId, { node: r.id, amount: r.amount, via: d.assetId, basis: 'guess' });
        pool(`away:${d.ownerId}`).push({
          node: r.id,
          amount: r.amount,
          via: `away:${d.ownerId}`,
          basis: 'guess',
        });
        guessed.paidOutside++;
      },
    });
  }
  lines.forEach((l, i) =>
    events.push({ date: l.date, order: 1, seq: l.seq ?? i, run: () => replay(l) }),
  );
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order || a.seq - b.seq);

  function replay(l: TrailLine) {
    const n = nodes.get(l.id)!;
    const holder = owner.get(l.assetId) ?? '';
    const here = pool(l.assetId);
    if (l.amount < 0) {
      const out = -l.amount;
      const { parts, short } = take(here, out, method);
      for (const part of parts) link(part.node, n.id, part.amount, 'same_account');
      if (short > TINY) n.starts.push({ kind: 'unexplained', amount: short, person: holder });
      const booked = bookedBy.get(l.id);
      if (booked) {
        n.holding = booked.dep;
        n.holdingBasis = booked.basis;
        pool(booked.dep).push({ node: n.id, amount: out, via: booked.dep, basis: booked.basis });
        push(into, booked.dep, { node: n.id, amount: out, via: booked.dep, basis: booked.basis });
      } else if (l.cls === 'fund_buy' && l.counterpart && isFund.has(l.counterpart)) {
        n.holding = l.counterpart;
        n.holdingBasis = 'rules';
        pool(l.counterpart).push({ node: n.id, amount: out, via: l.counterpart, basis: 'rules' });
        push(into, l.counterpart, { node: n.id, amount: out, via: l.counterpart, basis: 'rules' });
      } else if (l.cls === 'fd_funding') {
        // a deposit not on file, booked from this account: its money waits for a deposit to be paid back here
        pool(`held:${l.assetId}`).push({
          node: n.id,
          amount: out,
          via: `held:${l.assetId}`,
          basis: 'rules',
        });
      } else if (pairOf.has(l.id)) {
        // the other side is a line of its own: linked already
      } else if (l.cls === 'fund_buy') n.ends.push({ kind: 'untraced_fund', amount: out });
      else if (l.cls === 'own_transfer' && l.counterpart && withLines.has(l.counterpart))
        n.ends.push({ kind: 'not_found', amount: out, assetId: l.counterpart });
      else if (l.cls === 'own_transfer' && !(l.counterpart && abroad.has(l.counterpart))) {
        // to an account with no statement on file: the money waits there, as the person's money outside the statements
        const person = l.person ?? (l.counterpart ? owner.get(l.counterpart) : undefined) ?? holder;
        pool(`away:${person}`).push({
          node: n.id,
          amount: out,
          via: `away:${person}`,
          basis: 'guess',
        });
      } else if (l.cls === 'own_transfer')
        n.ends.push({ kind: 'untraced_account', amount: out, assetId: l.counterpart });
      else if (l.cls === 'fee') n.ends.push({ kind: 'fee', amount: out });
      else if (l.cls === 'tax' || l.cls === 'interest_tax')
        n.ends.push({ kind: 'tax', amount: out });
      else if (l.cls === 'ask_out') n.ends.push({ kind: 'unexplained', amount: out });
      else n.ends.push({ kind: 'spent', amount: out });
      return;
    }
    // money in: what brought it
    const paid = paidBy.get(l.id);
    if (pairOf.has(l.id)) {
      // a transfer: its money is the line out on the other side (linked already)
    } else if (paid) {
      const d = deposits.get(paid.dep)!;
      n.holding = paid.dep;
      n.holdingBasis = paid.basis;
      const got = payOut(paid.dep, depositPool(paid.dep), Math.min(l.amount, d.principal), n.id);
      if (l.amount - got > TINY)
        n.starts.push({
          kind: 'deposit_interest',
          amount: l.amount - got,
          assetId: paid.dep,
          person: holder,
        });
      paidDeps.add(paid.dep);
      push(outOf, paid.dep, { node: n.id, amount: l.amount, via: paid.dep, basis: paid.basis });
    } else if (l.cls === 'fd_proceeds') {
      // a deposit not on file booked from this account; else from another account of the same person at the same bank
      const here = bankOf(l.assetId);
      const from = [
        l.assetId,
        ...[...withLines].filter(
          (x) =>
            x !== l.assetId &&
            owner.get(x) === holder &&
            here !== '' &&
            bankOf(x) === here &&
            sum(pool(`held:${x}`)) > TINY,
        ),
      ].find((x) => sum(pool(`held:${x}`)) > TINY);
      let got = from ? payOut(`held:${from}`, pool(`held:${from}`), l.amount, n.id) : 0;
      // else deposits on file that end around then
      if (got <= TINY) got = fromDeposits(l, holder, n.id);
      // nothing booked it on statements that run without a break from their first day to this payback: it was booked before them,
      // with the family's money from before the records
      if (got <= TINY && unbrokenTo(l.assetId, l.date))
        n.starts.push({ kind: 'before_records', amount: l.amount, person: holder });
      else if (got <= TINY)
        n.starts.push({
          kind: 'untraced_deposit',
          amount: l.amount,
          assetId: null,
          person: holder,
        });
      else if (l.amount - got > TINY)
        n.starts.push({
          kind: 'deposit_interest',
          amount: l.amount - got,
          assetId: null,
          person: holder,
        });
    } else if (l.cls === 'fund_sell') {
      const fund = l.counterpart && isFund.has(l.counterpart) ? l.counterpart : null;
      if (fund) {
        n.holding = fund;
        n.holdingBasis = 'rules';
      }
      const got = fund ? payOut(fund, pool(fund), l.amount, n.id) : 0;
      if (l.amount - got > TINY)
        n.starts.push({
          kind: got > TINY ? 'fund_gain' : 'untraced_fund',
          amount: l.amount - got,
          assetId: fund,
          person: holder,
        });
      if (fund) push(outOf, fund, { node: n.id, amount: l.amount, via: fund, basis: 'rules' });
    } else {
      const remit = args.remittanceOf?.get(l.id);
      const o = remit
        ? { kind: 'singapore' as const, amount: l.amount, person: holder }
        : originOf(l, holder, owner);
      // from an account with no statement on file: the money the person sent to such accounts, or deposits paid out there
      let got = 0;
      if (o.kind === 'untraced_account' && !(l.counterpart && abroad.has(l.counterpart))) {
        got = fromAway(o.person, l.amount, n.id);
        if (got > TINY) guessed.fromOutside++;
      }
      if (l.amount - got > TINY)
        n.starts.push({
          kind: o.kind,
          amount: l.amount - got,
          person: o.person,
          ...(o.assetId !== undefined ? { assetId: o.assetId } : {}),
          ...(remit ? { remittanceId: remit } : {}),
        });
    }
    here.push({ node: n.id, amount: l.amount, basis: 'same_account' });
  }
  for (const e of events) e.run();

  // ---- 4. what is still where it went
  const now = new Map<string, ChainLink[]>();
  for (const [holding, p] of pools)
    for (const lot of p) {
      if (lot.amount <= TINY) continue;
      nodes.get(lot.node)!.left.push({ assetId: holding, amount: lot.amount });
      if (withLines.has(holding))
        push(now, holding, { node: lot.node, amount: lot.amount, basis: lot.basis });
    }
  const outside = new Map<string, ChainLink[]>();
  for (const [holding, p] of pools)
    if (holding.startsWith('away:'))
      for (const lot of p)
        if (lot.amount > TINY)
          push(outside, holding.slice(5), { node: lot.node, amount: lot.amount, basis: lot.basis });
  return { nodes, into, outOf, now, outside, guessed, method };
}

// ------------------------------------------------------------------------------------------------------------------------------
// following the chain

export interface TraceStep {
  node: ChainNode;
  /** for a transfer, the line on the other side, shown with it as one step, and how the two were found */
  pair?: ChainNode;
  pairBasis?: LinkBasis;
  /** how much of the money followed is this step's */
  amount: number;
  /** the deposit or fund the money passed through between this step and the one it leads to */
  via?: string;
  /** how this step is known to lead to that one */
  basis?: LinkBasis;
  /** money that starts here (back), with the share of the money followed */
  starts: ChainStart[];
  /** money that left the trail here (forward) */
  ends: ChainEnd[];
  /** money still where it went (forward) */
  left: { assetId: string; amount: number }[];
  steps: TraceStep[];
  /** parts below the smallest amount shown, folded together */
  small: number;
  /** the trail goes on past the steps shown (too many steps); the step's own page shows the rest */
  cut: boolean;
}

export interface TraceOptions {
  /** parts smaller than this many rupees are folded into "smaller parts" */
  smallest: number;
  /** at most this many steps back or forward */
  depth: number;
  /** at most this many steps in one trail */
  budget: number;
}

const scaled = <T extends { amount: number }>(xs: T[], f: number) =>
  xs.map((x) => ({ ...x, amount: x.amount * f })).filter((x) => x.amount > TINY);

/** Where the money of a step came from, step by step, back to where it started. */
export function traceBack(
  chain: MoneyChain,
  id: string,
  opts: TraceOptions,
  amount?: number,
): TraceStep | null {
  const start = chain.nodes.get(id);
  if (!start) return null;
  const ctx = { used: 0 };
  const back = (n: ChainNode, want: number, depth: number): TraceStep => {
    // a transfer in, made only of the line out on the other side: one step
    const only = n.from.length === 1 && n.starts.length === 0 ? n.from[0]! : null;
    const pair =
      only && only.basis !== 'same_account' && !only.via ? chain.nodes.get(only.node) : undefined;
    const src = pair ?? n;
    const total = sum(src.from) + sum(src.starts);
    const f = total > TINY ? want / total : 0;
    const step: TraceStep = {
      node: n,
      ...(pair ? { pair, pairBasis: only!.basis } : {}),
      amount: want,
      starts: scaled(src.starts, f),
      ends: [],
      left: [],
      steps: [],
      small: 0,
      cut: false,
    };
    for (const l of [...src.from].sort((a, b) => b.amount - a.amount)) {
      const a = l.amount * f;
      if (a < opts.smallest) {
        step.small += a;
        continue;
      }
      if (depth >= opts.depth || ctx.used >= opts.budget) {
        step.cut = true;
        continue;
      }
      ctx.used++;
      const child = back(chain.nodes.get(l.node)!, a, depth + 1);
      if (l.via) child.via = l.via;
      child.basis = l.basis;
      step.steps.push(child);
    }
    return step;
  };
  return back(start, amount ?? Math.abs(start.amount), 0);
}

/** Where the money of a step went, step by step, to where it is today. */
export function traceForward(
  chain: MoneyChain,
  id: string,
  opts: TraceOptions,
  amount?: number,
): TraceStep | null {
  const start = chain.nodes.get(id);
  if (!start) return null;
  const ctx = { used: 0 };
  const fwd = (n: ChainNode, want: number, depth: number): TraceStep => {
    // a transfer out, all of it into the line in on the other side: one step
    const only = n.to.length === 1 && n.left.length === 0 && n.ends.length === 0 ? n.to[0]! : null;
    const pair =
      only && only.basis !== 'same_account' && !only.via ? chain.nodes.get(only.node) : undefined;
    const src = pair ?? n;
    const total = sum(src.to) + sum(src.left) + sum(src.ends);
    const f = total > TINY ? want / total : 0;
    const step: TraceStep = {
      node: n,
      ...(pair ? { pair, pairBasis: only!.basis } : {}),
      amount: want,
      starts: [],
      ends: scaled(src.ends, f),
      left: scaled(src.left, f),
      steps: [],
      small: 0,
      cut: false,
    };
    for (const l of [...src.to].sort((a, b) => b.amount - a.amount)) {
      const a = l.amount * f;
      if (a < opts.smallest) {
        step.small += a;
        continue;
      }
      if (depth >= opts.depth || ctx.used >= opts.budget) {
        step.cut = true;
        continue;
      }
      ctx.used++;
      const child = fwd(chain.nodes.get(l.node)!, a, depth + 1);
      if (l.via) child.via = l.via;
      child.basis = l.basis;
      step.steps.push(child);
    }
    return step;
  };
  return fwd(start, amount ?? Math.abs(start.amount), 0);
}

/** The steps a holding's money came from: what booked or bought a deposit or fund, what an account holds today. */
export function holdingSources(chain: MoneyChain, assetId: string): ChainLink[] {
  return chain.into.get(assetId) ?? chain.now.get(assetId) ?? [];
}

/** One place the money followed started at, with the share of it that started there. */
export interface StartPoint extends ChainStart {
  /** the step it starts at (a transfer from Singapore, a balance before the statements, a deposit booked before them) */
  node: string;
  date: string;
}

/** One place the money followed is now, or left the trail at. */
export interface EndPoint {
  kind: 'still' | EndKind;
  amount: number;
  /** the holding it is still in, or the account it went to */
  assetId?: string | null;
  node: string;
  date: string;
}

// the start points of a step's money, by share of it, kept per step so a trail is worked out once however often it is asked
type Mix = Map<string, { point: StartPoint; share: number }>;
/**
 * Interest and gains are summed by the holding that paid them, spending and charges by kind, money still in a holding by the
 * holding; every other start or end is kept by the step it is at, so each can be opened.
 */
const BY_HOLDING = new Set(['interest', 'deposit_interest', 'fund_gain', 'still']);
const BY_KIND = new Set(['spent', 'fee', 'tax', 'untraced_fund']);
const pointKey = (p: { kind: string; assetId?: string | null; node: string }) =>
  BY_HOLDING.has(p.kind)
    ? `${p.kind}|${p.assetId ?? ''}`
    : BY_KIND.has(p.kind)
      ? p.kind
      : `${p.kind}|${p.assetId ?? ''}|${p.node}`;

/**
 * Where the money of a step started, in full (no step is left out for being small or far back): each start with its amount. Interest
 * and gains are summed by the holding that paid them; every other start is listed by the step it starts at.
 */
export function startPoints(chain: MoneyChain, id: string, amount?: number): StartPoint[] {
  const n = chain.nodes.get(id);
  if (!n) return [];
  const want = amount ?? Math.abs(n.amount);
  const mix = mixOf(chain, id, 'back');
  return [...mix.values()]
    .map(({ point, share }) => ({ ...point, amount: share * want }) as StartPoint)
    .filter((p) => p.amount > 0.5)
    .sort((a, b) => b.amount - a.amount);
}

/** Where the money of a step is now, in full: still in an account, a deposit or a fund, or spent, or gone to an account not on file. */
export function endPoints(chain: MoneyChain, id: string, amount?: number): EndPoint[] {
  const n = chain.nodes.get(id);
  if (!n) return [];
  const want = amount ?? Math.abs(n.amount);
  const mix = mixOf(chain, id, 'forward');
  return [...mix.values()]
    .map(({ point, share }) => ({ ...(point as unknown as EndPoint), amount: share * want }))
    .filter((p) => p.amount > 0.5)
    .sort((a, b) => b.amount - a.amount);
}

/** Start or end points of many steps together (a holding's sources), each with the amount it is followed for. */
export function pointsOf<T extends StartPoint | EndPoint>(
  each: (id: string, amount: number) => T[],
  links: ChainLink[],
): T[] {
  const all = new Map<string, T>();
  for (const l of links)
    for (const p of each(l.node, l.amount)) {
      const k = pointKey(p);
      const cur = all.get(k);
      if (cur) cur.amount += p.amount;
      else all.set(k, { ...p });
    }
  return [...all.values()].sort((a, b) => b.amount - a.amount);
}

const memo = new WeakMap<MoneyChain, { back: Map<string, Mix>; forward: Map<string, Mix> }>();

/** The share of a step's money from each start (back) or at each end (forward), worked out without recursion (chains can be long). */
function mixOf(chain: MoneyChain, id: string, dir: 'back' | 'forward'): Mix {
  const cache =
    memo.get(chain) ?? memo.set(chain, { back: new Map(), forward: new Map() }).get(chain)!;
  const done = cache[dir];
  if (done.has(id)) return done.get(id)!;
  const edges = (n: ChainNode) => (dir === 'back' ? n.from : n.to);
  const stack: { id: string; open: boolean }[] = [{ id, open: false }];
  const onStack = new Set<string>();
  while (stack.length) {
    const top = stack[stack.length - 1]!;
    if (done.has(top.id)) {
      stack.pop();
      continue;
    }
    const n = chain.nodes.get(top.id)!;
    if (!top.open) {
      top.open = true;
      onStack.add(top.id);
      for (const e of edges(n))
        if (!done.has(e.node) && !onStack.has(e.node)) stack.push({ id: e.node, open: false });
      continue;
    }
    stack.pop();
    onStack.delete(top.id);
    const mix: Mix = new Map();
    const add = (point: StartPoint | EndPoint, share: number) => {
      if (share <= 1e-9) return;
      const k = pointKey(point as { kind: string; assetId?: string | null; node: string });
      const cur = mix.get(k);
      if (cur) cur.share += share;
      else mix.set(k, { point: point as StartPoint, share });
    };
    const own =
      dir === 'back'
        ? n.starts.map((s) => ({ ...s, node: n.id, date: n.date }) as StartPoint)
        : [
            ...n.left.map(
              (x) =>
                ({
                  kind: 'still',
                  amount: x.amount,
                  assetId: x.assetId,
                  node: n.id,
                  date: n.date,
                }) as EndPoint,
            ),
            ...n.ends.map((x) => ({ ...x, node: n.id, date: n.date }) as EndPoint),
          ];
    const total = sum(edges(n)) + sum(own);
    if (total > TINY) {
      for (const p of own) add(p, p.amount / total);
      for (const e of edges(n)) {
        const sub = done.get(e.node);
        if (!sub) continue; // a step already being worked out further up: none in a chain that runs forward in time
        for (const { point, share } of sub.values()) add(point, (share * e.amount) / total);
      }
    }
    done.set(top.id, mix);
  }
  return done.get(id) ?? new Map();
}

/** The steps along the largest share at each turn: C → B → A → Z, the way most of the money went. */
export function mainPath(step: TraceStep): TraceStep[] {
  const out: TraceStep[] = [step];
  let at = step;
  while (at.steps.length) {
    at = at.steps.reduce((a, b) => (b.amount > a.amount ? b : a));
    out.push(at);
  }
  return out;
}

export const END_LABEL: Record<EndPoint['kind'], string> = {
  still: 'Still there',
  spent: 'Spent or paid out',
  fee: 'Bank charges',
  tax: 'Tax taken at source',
  untraced_account: 'Sent to an account with no statement on file',
  not_found: 'Sent to an account whose statement does not show it arriving',
  untraced_fund: 'Into a fund the records do not name',
  unexplained: 'Not answered yet (Explain movements)',
};

export const LINK_LABEL: Record<LinkBasis, string> = {
  same_account: 'in the same account',
  pair: 'both lines on the statements',
  rules: 'named by the statement or the records',
  guess: 'matched by amount and date',
};

// ------------------------------------------------------------------------------------------------------------------------------
// the whole trail at once

/** Where all of today's money is (accounts, deposits, funds, money outside the statements), each with where it started. */
export interface ChainCoverage {
  /** all the money the trail holds today */
  total: number;
  /** by where it started, in full */
  starts: StartPoint[];
  /** the share traced to a real start: Singapore, interest, earnings, money from outside, money there before the statements */
  traced: number;
  /** by where it is now: accounts with statements, deposits, funds, money outside the statements */
  where: { kind: 'account' | 'deposit' | 'fund' | 'outside' | 'held'; amount: number }[];
}

/** Starts that are where money really came from (the rest are where the statements stop). */
export const REAL_STARTS: ReadonlySet<OriginKind> = new Set<OriginKind>([
  'singapore',
  'interest',
  'deposit_interest',
  'fund_gain',
  'rent',
  'outside',
  'before_records',
]);

export function chainCoverage(
  chain: MoneyChain,
  kindOf: (holding: string) => 'account' | 'deposit' | 'fund' | null,
): ChainCoverage {
  const links: ChainLink[] = [];
  const where = new Map<ChainCoverage['where'][number]['kind'], number>();
  for (const n of chain.nodes.values())
    for (const l of n.left) {
      if (l.amount <= 0.5) continue;
      links.push({ node: n.id, amount: l.amount, basis: 'same_account' });
      const k = l.assetId.startsWith('away:')
        ? 'outside'
        : l.assetId.startsWith('held:')
          ? 'held'
          : (kindOf(l.assetId) ?? 'account');
      where.set(k, (where.get(k) ?? 0) + l.amount);
    }
  const starts = pointsOf((id, a) => startPoints(chain, id, a), links);
  const total = links.reduce((s, l) => s + l.amount, 0);
  const real = starts.filter((p) => REAL_STARTS.has(p.kind)).reduce((s, p) => s + p.amount, 0);
  return {
    total,
    starts,
    traced: total > 0 ? real / total : 0,
    where: [...where]
      .map(([kind, amount]) => ({ kind, amount }))
      .sort((a, b) => b.amount - a.amount),
  };
}

/**
 * Every step of the trail as rows, for a download: each link from one step to the next with the date, the holdings, the amount,
 * the deposit or fund it passed through and how it is known; and where each part of today's money started.
 */
export function chainTables(
  chain: MoneyChain,
  name: (holding: string | null | undefined) => string,
): ReportTable[] {
  const rows: Record<string, string | number | null>[] = [];
  const nodeName = (n: ChainNode) => name(n.kind === 'line' ? n.assetId : n.assetId);
  for (const n of [...chain.nodes.values()].sort((a, b) => a.date.localeCompare(b.date)))
    for (const e of n.to) {
      const t = chain.nodes.get(e.node);
      if (!t) continue;
      rows.push({
        fromDate: n.date,
        from: nodeName(n),
        fromWords: n.narration.slice(0, 80),
        toDate: t.date,
        to: nodeName(t),
        toWords: t.narration.slice(0, 80),
        through: e.via ? name(e.via) : '',
        amount: Math.round(e.amount),
        how: LINK_LABEL[e.basis],
      });
    }
  const starts = [...chain.nodes.values()].flatMap((n) =>
    n.starts.map((s) => ({
      date: n.date,
      at: nodeName(n),
      kind: ORIGIN_LABEL[s.kind],
      from: s.assetId ? name(s.assetId) : '',
      amount: Math.round(s.amount),
      words: n.narration.slice(0, 80),
    })),
  );
  const ends = [...chain.nodes.values()].flatMap((n) => [
    ...n.left.map((l) => ({
      date: n.date,
      at: nodeName(n),
      kind: 'Still there',
      to: name(l.assetId),
      amount: Math.round(l.amount),
      words: n.narration.slice(0, 80),
    })),
    ...n.ends.map((e) => ({
      date: n.date,
      at: nodeName(n),
      kind: END_LABEL[e.kind],
      to: e.assetId ? name(e.assetId) : '',
      amount: Math.round(e.amount),
      words: n.narration.slice(0, 80),
    })),
  ]);
  return [
    {
      id: 'trail-steps',
      title: 'Every step',
      note: 'Each row is money moving from one step to the next; “How it is known” says whether the statements, the records or a match by amount and date linked them.',
      columns: [
        { key: 'fromDate', label: 'From date', kind: 'date' },
        { key: 'from', label: 'From', kind: 'text' },
        { key: 'fromWords', label: 'Bank’s words (from)', kind: 'text' },
        { key: 'toDate', label: 'To date', kind: 'date' },
        { key: 'to', label: 'To', kind: 'text' },
        { key: 'toWords', label: 'Bank’s words (to)', kind: 'text' },
        { key: 'through', label: 'Through', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'how', label: 'How it is known', kind: 'text' },
      ],
      rows,
    },
    {
      id: 'trail-starts',
      title: 'Where money started',
      note: 'Every amount that comes from nowhere the statements follow: Singapore, interest, earnings, and where the statements stop.',
      columns: [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'at', label: 'At', kind: 'text' },
        { key: 'kind', label: 'Started as', kind: 'text' },
        { key: 'from', label: 'From', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'words', label: 'Bank’s words', kind: 'text' },
      ],
      rows: starts.sort((a, b) => a.date.localeCompare(b.date)),
    },
    {
      id: 'trail-ends',
      title: 'Where money is now or left',
      note: 'Every amount still in an account, a deposit, a fund or outside the statements, and every amount spent or sent where the statements stop.',
      columns: [
        { key: 'date', label: 'Date', kind: 'date' },
        { key: 'at', label: 'From step', kind: 'text' },
        { key: 'kind', label: 'Now', kind: 'text' },
        { key: 'to', label: 'Where', kind: 'text' },
        { key: 'amount', label: 'Amount', kind: 'money' },
        { key: 'words', label: 'Bank’s words', kind: 'text' },
      ],
      rows: ends.sort((a, b) => a.date.localeCompare(b.date)),
    },
  ];
}
