/**
 * The money trail: where the money in each account and deposit came from, and whose it was.
 *
 * Every statement line is replayed in date order. Each account is a pool of money with a known make-up: so much from Singapore
 * (Wise or DBS), so much interest, so much that was there before its first statement, so much from an account with no statement on
 * file, and so on, each part also tagged with the person whose money it was. Money leaving an account takes the account's make-up at
 * that moment with it, in proportion; money arriving adds what it brought. So a deposit booked from YES Bank, funded the month before
 * by a transfer from IDFC, which was funded by a Wise transfer, shows "from Singapore" at the end of the chain, however many hops and
 * however the money was mixed on the way.
 *
 *  - A transfer between two accounts that both have statements carries the make-up across (the two lines are paired by the rules).
 *  - A deposit takes the make-up of the money that booked it; when it is paid back, the principal returns with that make-up and the
 *    rest is the deposit's interest.
 *  - Money from or to an account with no statement on file is a part of its own ("from Ragini's AU account, not traced further").
 *
 * Whose money: Singapore money is the person's whose Indian account first received it; interest, the account holder's; money already
 * in an account before its first statement, the holder's. A part keeps its person when it moves to someone else's account, which is
 * what clubbing looks at.
 *
 * Pure: no I/O.
 */
import type { Classified, LineClass } from './statement-classify';

export type OriginKind =
  | 'singapore'
  | 'interest'
  | 'deposit_interest'
  | 'before_records'
  | 'outside'
  | 'rent'
  | 'untraced_account'
  | 'untraced_deposit'
  | 'unexplained';

export interface MoneyOrigin {
  kind: OriginKind;
  /** the account the part came from, for an untraced account or deposit */
  assetId?: string | null;
  /** whose money the part is */
  person: string;
}

export interface TrailLine {
  id: string;
  assetId: string;
  date: string;
  /** + in, − out */
  amount: number;
  cls: LineClass;
  /** the other side: an account or a deposit, when known */
  counterpart: string | null;
  /** the person named on the other side, when the narration names one of the household */
  person?: string;
  narration: string;
}

export interface TrailAsset {
  id: string;
  ownerId: string;
  /** a deposit (its make-up is the money that booked it) or an account */
  kind: 'account' | 'deposit';
  principal?: number;
}

export interface Part extends MoneyOrigin {
  amount: number;
}

/** One movement into a holding, with what it brought. */
export interface Hop {
  date: string;
  amount: number;
  /** where it came from: an account or a deposit on file, or null (Singapore, interest, outside, untraced) */
  from: string | null;
  cls: LineClass;
  narration: string;
  parts: Part[];
}

export interface Trail {
  assetId: string;
  /** what the holding is made of now (an account) or was booked with (a deposit) */
  parts: Part[];
  /** the movements into it, newest first */
  hops: Hop[];
  /** money that moved from one person's account to another's, by the person whose money it was */
  crossings: {
    date: string;
    amount: number;
    fromPerson: string;
    toPerson: string;
    assetId: string;
  }[];
}

type Pool = Map<string, Part>;
const key = (o: MoneyOrigin) => `${o.kind}|${o.assetId ?? ''}|${o.person}`;
const total = (p: Pool) => [...p.values()].reduce((s, x) => s + x.amount, 0);
const add = (p: Pool, part: Part) => {
  if (Math.abs(part.amount) < 0.005) return;
  const k = key(part);
  const cur = p.get(k);
  if (cur) cur.amount += part.amount;
  else p.set(k, { ...part });
};
/** Takes `amount` out of a pool in proportion to what it is made of; what is missing is unexplained. */
function take(p: Pool, amount: number, holder: string): Part[] {
  const t = total(p);
  const out: Part[] = [];
  const from = Math.min(amount, Math.max(t, 0));
  if (from > 0.005)
    for (const part of [...p.values()]) {
      const share = (part.amount / t) * from;
      out.push({ ...part, amount: share });
      part.amount -= share;
    }
  if (amount - from > 0.005)
    out.push({ kind: 'unexplained', person: holder, amount: amount - from });
  for (const [k, part] of p) if (Math.abs(part.amount) < 0.005) p.delete(k);
  return out;
}

export function moneyTrail(args: {
  lines: TrailLine[];
  assets: TrailAsset[];
  /** each account's balance before its first statement line */
  openings: Map<string, number>;
}): Map<string, Trail> {
  const owner = new Map(args.assets.map((a) => [a.id, a.ownerId]));
  const isDeposit = new Set(args.assets.filter((a) => a.kind === 'deposit').map((a) => a.id));
  const withLines = new Set(args.lines.map((l) => l.assetId));
  const pools = new Map<string, Pool>();
  const trails = new Map<string, Trail>();
  const trail = (id: string) =>
    trails.get(id) ?? trails.set(id, { assetId: id, parts: [], hops: [], crossings: [] }).get(id)!;
  const pool = (id: string) => pools.get(id) ?? pools.set(id, new Map()).get(id)!;
  // money in flight between two accounts with statements: the debit's make-up waits for its credit
  const inFlight = new Map<string, Part[][]>();
  const flightKey = (from: string, to: string, amount: number) =>
    `${from}|${to}|${Math.round(Math.abs(amount) * 100)}`;

  for (const [id, amt] of args.openings) {
    if (amt > 0.005)
      add(pool(id), { kind: 'before_records', person: owner.get(id) ?? '', amount: amt });
  }
  // debits before credits on the same day, so a transfer's make-up is known when it arrives
  const sorted = [...args.lines].sort(
    (a, b) => a.date.localeCompare(b.date) || a.amount - b.amount || a.id.localeCompare(b.id),
  );
  for (const l of sorted) {
    const holder = owner.get(l.assetId) ?? '';
    const p = pool(l.assetId);
    if (l.amount < 0) {
      const parts = take(p, -l.amount, holder);
      const to = l.counterpart;
      if (to && isDeposit.has(to)) {
        // a deposit booked: it is made of this money
        for (const part of parts) add(pool(to), part);
        const t = trail(to);
        t.hops.unshift({
          date: l.date,
          amount: -l.amount,
          from: l.assetId,
          cls: l.cls,
          narration: l.narration,
          parts,
        });
        const depOwner = owner.get(to) ?? holder;
        if (depOwner !== holder)
          t.crossings.push({
            date: l.date,
            amount: -l.amount,
            fromPerson: holder,
            toPerson: depOwner,
            assetId: to,
          });
      } else if (to && withLines.has(to)) {
        const k = flightKey(l.assetId, to, l.amount);
        inFlight.set(k, [...(inFlight.get(k) ?? []), parts]);
      } else if (!to && l.cls === 'fd_funding') {
        // a deposit not on file, booked from this account: its money waits for the deposit to be paid back here
        for (const part of parts) add(pool(`held:${l.assetId}`), part);
      }
      continue;
    }
    // money in: what it brings
    let parts: Part[];
    const from = l.counterpart;
    const flying = from ? inFlight.get(flightKey(from, l.assetId, l.amount)) : undefined;
    if (flying && flying.length) parts = flying.shift()!;
    else if (from && isDeposit.has(from) && (l.cls === 'fd_proceeds' || l.cls === 'own_transfer')) {
      // a deposit paid back: its own make-up for the principal, the rest its interest
      const dep = pool(from);
      const principal = Math.min(total(dep), l.amount);
      parts = principal > 0 ? take(dep, principal, owner.get(from) ?? holder) : [];
      if (l.amount - principal > 0.005)
        parts.push({
          kind: 'deposit_interest',
          person: owner.get(from) ?? holder,
          amount: l.amount - principal,
        });
    } else if (!from && l.cls === 'fd_proceeds' && total(pool(`held:${l.assetId}`)) > 0.005) {
      // a deposit not on file paid back here: the money that booked deposits from this account, the rest its interest
      const held = pool(`held:${l.assetId}`);
      const principal = Math.min(total(held), l.amount);
      parts = take(held, principal, holder);
      if (l.amount - principal > 0.005)
        parts.push({ kind: 'deposit_interest', person: holder, amount: l.amount - principal });
    } else parts = [originOf(l, holder, owner)];
    for (const part of parts) add(p, part);
    const t = trail(l.assetId);
    t.hops.unshift({
      date: l.date,
      amount: l.amount,
      from,
      cls: l.cls,
      narration: l.narration,
      parts,
    });
    // money from someone else's account (on file, or named in the narration): it changed hands here
    const fromPerson =
      from && owner.has(from) ? owner.get(from)! : l.cls === 'own_transfer' ? l.person : undefined;
    if (fromPerson && fromPerson !== holder && !(from && isDeposit.has(from)))
      t.crossings.push({
        date: l.date,
        amount: l.amount,
        fromPerson,
        toPerson: holder,
        assetId: l.assetId,
      });
  }
  for (const [id, p] of pools) {
    if (id.startsWith('held:')) continue;
    const t = trail(id);
    // an account: what it holds now; a deposit: the money that booked it
    const from: Part[] = isDeposit.has(id)
      ? (() => {
          const booked: Pool = new Map();
          for (const h of t.hops) for (const part of h.parts) add(booked, part);
          return [...booked.values()];
        })()
      : [...p.values()];
    t.parts = from.filter((x) => x.amount > 0.5).sort((a, b) => b.amount - a.amount);
  }
  return trails;
}

/** What a credit with no traced source is, as an origin. */
function originOf(l: TrailLine, holder: string, owner: Map<string, string>): Part {
  const amount = l.amount;
  switch (l.cls) {
    case 'interest':
    case 'interest_tax':
      return { kind: 'interest', person: holder, amount };
    case 'fd_interest':
      return { kind: 'deposit_interest', person: holder, amount };
    case 'fd_proceeds':
      return { kind: 'untraced_deposit', assetId: l.counterpart, person: holder, amount };
    case 'rent':
    case 'income':
      return { kind: 'rent', person: holder, amount };
    case 'outside_in':
      return { kind: 'outside', person: holder, amount };
    case 'own_transfer':
      if (l.counterpart && !owner.has(l.counterpart))
        // the Singapore account (or another not in the list of holdings with statements)
        return { kind: 'singapore', person: holder, amount };
      if (!l.counterpart && /wise|dbs/i.test(l.narration))
        return { kind: 'singapore', person: holder, amount };
      return {
        kind: 'untraced_account',
        assetId: l.counterpart,
        person: l.person ?? (l.counterpart ? (owner.get(l.counterpart) ?? holder) : holder),
        amount,
      };
    default:
      return { kind: 'unexplained', person: holder, amount };
  }
}

/** Statement lines as the trail reads them: the class and the other side from the rules. */
export function trailLines(
  lines: { id: string; assetId: string; date: string; amount: number; narration: string }[],
  classified: Classified[],
): TrailLine[] {
  const c = new Map(classified.map((x) => [x.id, x]));
  return lines.map((l) => {
    const k = c.get(l.id);
    return {
      ...l,
      cls: k?.cls ?? 'ask_in',
      counterpart: k?.counterpart ?? null,
      ...(k?.person ? { person: k.person } : {}),
    };
  });
}

export const ORIGIN_LABEL: Record<OriginKind, string> = {
  singapore: 'From Singapore (Wise or DBS)',
  interest: 'Savings interest',
  deposit_interest: 'Deposit interest',
  before_records: 'Already in the account before its first statement',
  outside: 'Other money from outside',
  rent: 'Rent and other earnings',
  untraced_account: 'From an account with no statement on file',
  untraced_deposit: 'From a deposit not on file',
  unexplained: 'Not explained by the statements',
};
