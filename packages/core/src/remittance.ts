/**
 * Which Indian account a transfer from Singapore reached, when the transfer record does not say (a Wise history lists the amount and
 * the day, not always the account). The candidates are the accounts the money is sent to; the evidence is what the records show:
 *
 *  1. an account that was not open yet on the day cannot have received it (its opening window, assets.opened_after);
 *  2. when only one candidate was open, it is that one;
 *  3. otherwise the balances recorded on either side of the day: the account's rise between the two records, plus any deposit booked
 *     at the same bank by the same person in between (money that arrived and went straight into a deposit), must hold the transfer.
 *     Transfers that fall between the same two records are placed together, largest first, so two of them cannot both be explained
 *     by one rise. When exactly one account can hold it, it is that one; when several can, the one it fits best is taken and the
 *     others are named; when none can (the money arrived and left again between the records), it is left open.
 *
 * Every answer says how it was reached, so the trail can show how certain each link is. A bank statement that shows the credit is
 * always better evidence and replaces this. Pure: no I/O.
 */

export interface Transfer {
  id: string;
  /** the day the money arrived */
  date: string;
  amount: number;
}

export interface DestinationAccount {
  assetId: string;
  ownerId: string;
  institutionId: string | null;
  /** the last day it was certainly not open yet */
  openedAfter: string | null;
}

export interface Destination {
  id: string;
  assetId: string | null;
  basis: 'balances' | 'only_open' | null;
  /** the other accounts it could have been, when the choice was not certain */
  alternatives: string[];
  reason: string;
}

export function remittanceDestinations(args: {
  transfers: Transfer[];
  accounts: DestinationAccount[];
  /** recorded balances of the candidate accounts */
  balances: { assetId: string; date: string; amount: number }[];
  /** deposits booked: where and when, and for how much */
  deposits: {
    ownerId: string;
    institutionId: string | null;
    bookedOn: string;
    principal: number;
  }[];
  /** two records further apart than this say too little */
  windowDays?: number;
  /** the share of a transfer a rise must reach to hold it (interest and small spending blur the rest) */
  fit?: number;
  /** an account whose statements cover the day and do not show the transfer: it did not receive it */
  ruledOut?: (transferId: string, assetId: string) => boolean;
}): Destination[] {
  const windowDays = args.windowDays ?? 160;
  const fit = args.fit ?? 0.9;
  const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;
  const recs = new Map<string, { date: string; amount: number }[]>();
  for (const b of args.balances)
    if (args.accounts.some((a) => a.assetId === b.assetId))
      recs.set(b.assetId, [...(recs.get(b.assetId) ?? []), b]);
  for (const list of recs.values()) list.sort((x, y) => x.date.localeCompare(y.date));

  /** the two records around a day, and what the account (with deposits booked at its bank) took in between them */
  const windowOf = (a: DestinationAccount, date: string) => {
    const list = recs.get(a.assetId) ?? [];
    let prev: { date: string; amount: number } | undefined;
    let next: { date: string; amount: number } | undefined;
    for (const r of list) {
      if (r.date < date) prev = r;
      else if (!next) next = r;
    }
    if (!prev || !next || days(prev.date, next.date) > windowDays) return null;
    const booked = args.deposits
      .filter(
        (d) =>
          d.ownerId === a.ownerId &&
          d.institutionId === a.institutionId &&
          d.bookedOn > prev!.date &&
          d.bookedOn <= next!.date,
      )
      .reduce((s, d) => s + d.principal, 0);
    return {
      key: `${a.assetId}|${prev.date}|${next.date}`,
      took: next.amount - prev.amount + booked,
    };
  };

  const open = (t: Transfer) =>
    args.accounts.filter(
      (a) => !(a.openedAfter && t.date <= a.openedAfter) && !args.ruledOut?.(t.id, a.assetId),
    );
  const left = new Map<string, number>();
  const out = new Map<string, Destination>();
  for (const t of [...args.transfers].sort((x, y) => y.amount - x.amount)) {
    const cands = open(t);
    if (cands.length === 0) {
      out.set(t.id, {
        id: t.id,
        assetId: null,
        basis: null,
        alternatives: [],
        reason: 'None of the accounts was open yet on that day.',
      });
      continue;
    }
    if (cands.length === 1) {
      out.set(t.id, {
        id: t.id,
        assetId: cands[0]!.assetId,
        basis: 'only_open',
        alternatives: [],
        reason: args.ruledOut
          ? 'The only one of the accounts open on that day whose statements do not rule it out.'
          : 'The only one of the accounts open on that day.',
      });
      continue;
    }
    const able = cands
      .map((a) => {
        const w = windowOf(a, t.date);
        if (!w) return null;
        const room = left.get(w.key) ?? w.took;
        return room >= fit * t.amount ? { a, w, room } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null)
      // the account whose rise it fits most closely
      .sort((x, y) => x.room - t.amount - (y.room - t.amount));
    if (able.length === 0) {
      out.set(t.id, {
        id: t.id,
        assetId: null,
        basis: null,
        alternatives: cands.map((a) => a.assetId),
        reason:
          'No account’s recorded balances show it arriving: it may have arrived and moved on before the next record. A statement will tell.',
      });
      continue;
    }
    const pick = able[0]!;
    left.set(pick.w.key, pick.room - t.amount);
    out.set(t.id, {
      id: t.id,
      assetId: pick.a.assetId,
      basis: 'balances',
      alternatives: able.slice(1).map((x) => x.a.assetId),
      reason:
        able.length === 1
          ? 'The only account whose balance rose enough between the records around that day.'
          : 'The account whose rise between the records around that day it fits best; another could also hold it.',
    });
  }
  return args.transfers.map((t) => out.get(t.id)!);
}
