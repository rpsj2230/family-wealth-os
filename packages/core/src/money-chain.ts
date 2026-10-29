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
import { originOf, type OriginKind, type TrailAsset, type TrailLine } from './money-trail';
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
  /** a statement line; an account's balance before its first statement; a deposit booked before the statements; a renewal */
  kind: 'line' | 'opening' | 'deposit_before' | 'renewal';
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
  guessed: { transfers: number; depositBooked: number; depositPaidBack: number; renewals: number };
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
  const guessed = { transfers: 0, depositBooked: 0, depositPaidBack: 0, renewals: 0 };

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
    const set = subsetFor(cands, d.principal, d.bookedOn);
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
      n.starts.push({
        kind: 'untraced_deposit',
        amount: d.principal,
        assetId: depId,
        person: d.ownerId,
      });
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
      else if (l.cls === 'own_transfer')
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
      const got = from ? payOut(`held:${from}`, pool(`held:${from}`), l.amount, n.id) : 0;
      if (got <= TINY)
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
      n.starts.push({
        kind: o.kind,
        amount: l.amount,
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
  return { nodes, into, outOf, now, guessed, method };
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
