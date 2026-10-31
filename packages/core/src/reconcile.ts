/**
 * What is waiting to be explained (the "Explain movements" page): the items a person has to answer so own money, profit and the
 * savings estimates rest on confirmed facts. Nothing here is decided for them: each item comes with the likeliest answer and the reason,
 * to approve or change (see docs/UI-GUIDE.md, "Suggest, do not hand back").
 *
 *  1. Maturity proceeds: a deposit that matured or closed and whose proceeds nobody placed. The suggestion is the new deposit or the
 *     account that probably holds them; the answer is a movement (money_moves, kind fd_proceeds) and the deposit is marked matured.
 *  2. Balances that do not match: a new actual balance that differs from what the earlier balance, the confirmed movements and the
 *     interest predicted by more than the tolerance in Settings. The difference is "not yet explained" (never profit) until it is said
 *     what it was: outside money in or out, maturity proceeds, a transfer from another account, or a correction.
 *  3. New deposits with no recorded source: a deposit booked in the window whose funding is not recorded (a savings account, the
 *     proceeds of another deposit, or outside money).
 *
 * Pure: no I/O.
 */
import { contractOutOn } from './deposit-contract';
import { addDaysIso } from './harvest-lots';
import { contractOf, savingsTermsOf, type PositionInput } from './position';
import { reconcileBalance, type ReconcileSuggestion } from './savings-accrual';

export interface ProceedsItem {
  assetId: string;
  name: string;
  ownerId: string;
  /** the first day the money was out of the deposit */
  outOn: string;
  amount: number;
  status: 'awaiting' | 'probably_placed' | 'assumed_placed';
  note: string;
  /** the likeliest place: a deposit or an account, with the reason */
  suggestion: { assetId: string; name: string; why: string } | null;
}

export interface BalanceItem {
  assetId: string;
  name: string;
  ownerId: string;
  /** another of the family's accounts that moved the other way by the same sum within a few days: probably one transfer */
  pair?: { assetId: string; name: string; date: string; difference: number } | null;
  from: { date: string; amount: number };
  to: { date: string; amount: number };
  expected: number;
  difference: number;
  suggestions: (ReconcileSuggestion & { assetName?: string })[];
  /** the idempotency key an answer is stored under, so answering twice changes nothing */
  key: string;
}

export interface FundingItem {
  assetId: string;
  name: string;
  ownerId: string;
  bookedOn: string;
  principal: number;
  suggestion: { assetId: string; name: string; why: string } | null;
}

export interface ReconcileQueue {
  proceeds: ProceedsItem[];
  balances: BalanceItem[];
  funding: FundingItem[];
  count: number;
}

export interface QueueMove {
  movedOn: string;
  amount: number;
  kind: string;
  fromAssetId: string | null;
  toAssetId: string | null;
  status: string;
  idemKey: string | null;
}

/**
 * Do the bank's lines between two balances account for the whole change? The bank's lines and its balances are the same record, so
 * no estimate is needed: the first balance plus the lines after it is the second balance, within the tolerance. A balance may be
 * taken before or after the lines of its own day, so the lines of the first and the last day are tried both in and out. At least one
 * line must fall inside the stretch (no lines prove nothing).
 */
export function linesExplain(
  lines: readonly { date: string; amount: number }[] | undefined,
  from: { date: string; amount: number },
  to: { date: string; amount: number },
  tolerance: number,
): boolean {
  if (!lines?.length) return false;
  const sum = (f: (d: string) => boolean) => {
    const inside = lines.filter((l) => f(l.date));
    return { n: inside.length, total: inside.reduce((a, l) => a + l.amount, 0) };
  };
  const tries = [
    sum((d) => d > from.date && d <= to.date),
    sum((d) => d >= from.date && d <= to.date),
    sum((d) => d > from.date && d < to.date),
    sum((d) => d >= from.date && d < to.date),
  ];
  const change = to.amount - from.amount;
  return tries.some((t) => t.n > 0 && Math.abs(t.total - change) <= Math.max(tolerance, 1));
}

export function reconcileQueue(args: {
  position: PositionInput;
  moves: QueueMove[];
  /** Settings: a difference within this many rupees is explained */
  tolerance: number;
  /** how far back to look for balances that do not match and deposits with no source, in days */
  sinceDays: number;
  /** Settings: two changes this many days apart or less, of the same sum in opposite directions, are offered as one transfer */
  pairDays?: number;
  /**
   * The bank's own statement lines (from statements and alerts) of the accounts: a balance change they account for in full is
   * explained by the bank itself (a fund bought, interest and the tax on it, a transfer) and is not asked about. What each line was
   * is the line's own matter: a line that needs an answer is asked once, on the line (Bank statements), never again as a balance.
   */
  lines?: readonly { assetId: string; date: string; amount: number }[];
}): ReconcileQueue {
  const { position, moves } = args;
  const c = position.config;
  const today = c.today;
  const since = addDaysIso(today, -args.sinceDays);
  const byId = new Map(position.assets.map((a) => [a.assetId, a]));
  const confirmed = moves.filter((m) => m.status === 'confirmed');
  const answered = new Set(moves.filter((m) => m.idemKey).map((m) => m.idemKey!));
  const pairDays = args.pairDays ?? 3;
  // only the lines of this family's own accounts count
  const ownLines = (args.lines ?? []).filter((l) => byId.has(l.assetId));
  const linesOf = new Map<string, { date: string; amount: number }[]>();
  for (const l of ownLines) {
    const list = linesOf.get(l.assetId);
    if (list) list.push(l);
    else linesOf.set(l.assetId, [l]);
  }
  const apart = (a: string, b: string) =>
    Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
  /** the same sum, give or take the tolerance or half a per cent (interest of a day or two) */
  const same = (x: number, y: number) =>
    Math.abs(Math.abs(x) - Math.abs(y)) <= Math.max(args.tolerance, 0.005 * Math.abs(x));

  // 1. maturity proceeds nobody placed
  const proceeds: ProceedsItem[] = [];
  for (const a of position.assets) {
    const p = a.fd?.proceeds;
    if (!a.fd || !p || p.status === 'confirmed' || a.status === 'gifted') continue;
    if (
      p.status === 'assumed_placed' &&
      a.status !== 'active' &&
      a.status !== 'matured_unconfirmed'
    )
      continue;
    // an old one assumed placed is listed only while its date is inside the window
    const outOn = contractOutOn(contractOf(a.fd, c));
    if (p.status === 'assumed_placed' && outOn < since) continue;
    const ev = (() => {
      const renew = position.assets.find(
        (x) =>
          x.fd &&
          x.assetId !== a.assetId &&
          (x.fd.renewedFrom === a.assetId ||
            (x.ownerId === a.ownerId &&
              x.institutionId &&
              x.institutionId === a.institutionId &&
              x.fd.bookedOn >= addDaysIso(outOn, -3) &&
              x.fd.bookedOn <= addDaysIso(outOn, 15))),
      );
      if (renew)
        return {
          assetId: renew.assetId,
          name: renew.name,
          why: `a deposit booked on ${renew.fd!.bookedOn} at the same bank`,
        };
      const linked = position.assets.find(
        (x) =>
          x.type === 'bank_account' &&
          x.ownerId === a.ownerId &&
          a.linkedLast4 &&
          x.last4 === a.linkedLast4,
      );
      if (linked)
        return {
          assetId: linked.assetId,
          name: linked.name,
          why: 'the account the deposit is linked to',
        };
      const sameBank = position.assets.find(
        (x) =>
          x.type === 'bank_account' &&
          x.ownerId === a.ownerId &&
          x.institutionId &&
          x.institutionId === a.institutionId &&
          x.currency === 'INR',
      );
      return sameBank
        ? {
            assetId: sameBank.assetId,
            name: sameBank.name,
            why: 'a savings account of the same person at the same bank',
          }
        : null;
    })();
    proceeds.push({
      assetId: a.assetId,
      name: a.name,
      ownerId: a.ownerId,
      outOn,
      amount: p.amount,
      status: p.status,
      note: p.note,
      suggestion: ev,
    });
  }

  // 2. actual balances that do not match the estimate
  const balances: BalanceItem[] = [];
  const awaitingAmounts = proceeds.map((p) => ({
    kind: 'fd_proceeds' as const,
    amount: p.amount,
    assetId: p.assetId,
    label: `Proceeds of ${p.name}, matured ${p.outOn}`,
  }));
  for (const a of position.assets) {
    if (a.type !== 'bank_account' || a.currency !== 'INR' || a.status === 'gifted') continue;
    const recs = [
      ...new Map(a.records.filter((r) => !r.sheet).map((r) => [r.date, r])).values(),
    ].sort((x, y) => x.date.localeCompare(y.date));
    const terms = savingsTermsOf(a, c);
    for (let k = 1; k < recs.length; k++) {
      const prev = recs[k - 1]!;
      const cur = recs[k]!;
      if (cur.date < since) continue;
      const key = `recon:${a.assetId}:${cur.date}`;
      if (answered.has(key)) continue;
      const r = reconcileBalance({
        baseline: { date: prev.date, amount: prev.amount },
        actual: { date: cur.date, amount: cur.amount },
        txns: a.moves ?? [],
        terms,
        tolerance: args.tolerance,
        candidates: awaitingAmounts.filter((x) => byId.get(x.assetId)?.ownerId === a.ownerId),
      });
      if (r.explained) continue;
      if (linesExplain(linesOf.get(a.assetId), prev, cur, args.tolerance)) continue;
      // answered from the other side: a transfer or a deposit's funding you confirmed for the account it pairs with
      const settled = confirmed.some(
        (m) =>
          (m.fromAssetId === a.assetId || m.toAssetId === a.assetId) &&
          same(m.amount, r.difference) &&
          apart(m.movedOn, cur.date) <= pairDays,
      );
      if (settled) continue;
      balances.push({
        assetId: a.assetId,
        name: a.name,
        ownerId: a.ownerId,
        from: r.baseline,
        to: r.actual,
        expected: r.expected,
        difference: r.difference,
        suggestions: r.suggestions.map((s) =>
          s.assetId ? { ...s, assetName: byId.get(s.assetId)?.name ?? '' } : s,
        ),
        key,
      });
    }
  }

  // 3. deposits booked in the window with no recorded source
  const funded = new Set(confirmed.filter((m) => m.toAssetId).map((m) => m.toAssetId!));
  const placedInto = new Set(
    position.assets
      .filter(
        (x) =>
          x.fd?.proceeds?.status === 'confirmed' || x.fd?.proceeds?.status === 'probably_placed',
      )
      .map((x) => x.fd?.renewedFrom)
      .filter((x): x is string => !!x),
  );
  const funding: FundingItem[] = [];
  // the bank lines that paid for a deposit: money of the same sum leaving a family account within the pairing days of the booking.
  // Each line pays for one deposit only (several deposits of the same sum are often booked on one day), the closest first: the
  // same bank and person, then the same bank, then the same person, then the nearest day.
  const paid = new Set<string>();
  {
    const pairs = position.assets
      .filter(
        (d) => d.fd && d.status !== 'gifted' && d.fd.bookedOn >= since && d.fd.bookedOn <= today,
      )
      .flatMap((d) =>
        ownLines
          .map((l, i) => ({ l, i }))
          .filter(
            ({ l }) =>
              l.amount < 0 &&
              l.assetId !== d.assetId &&
              Math.abs(-l.amount - d.fd!.principal) <= Math.max(1, args.tolerance) &&
              apart(l.date, d.fd!.bookedOn) <= pairDays,
          )
          .map(({ l, i }) => {
            const acct = byId.get(l.assetId);
            const bank = !!acct?.institutionId && acct.institutionId === d.institutionId;
            const person = acct?.ownerId === d.ownerId;
            return {
              d: d.assetId,
              i,
              rank: (bank ? 0 : 2) + (person ? 0 : 1),
              days: apart(l.date, d.fd!.bookedOn),
            };
          }),
      )
      .sort((x, y) => x.rank - y.rank || x.days - y.days || x.d.localeCompare(y.d) || x.i - y.i);
    const usedLine = new Set<number>();
    for (const p of pairs) {
      if (paid.has(p.d) || usedLine.has(p.i)) continue;
      paid.add(p.d);
      usedLine.add(p.i);
    }
  }
  for (const a of position.assets) {
    if (!a.fd || a.status === 'gifted' || a.fd.bookedOn < since || a.fd.bookedOn > today) continue;
    if (funded.has(a.assetId) || a.fd.renewedFrom || placedInto.has(a.assetId)) continue;
    // a renewal found by the evidence of another deposit's proceeds is funded by them
    const fromProceeds = position.assets.find(
      (x) =>
        x.fd?.proceeds &&
        x.fd.proceeds.placedOn === a.fd!.bookedOn &&
        x.institutionId === a.institutionId &&
        x.ownerId === a.ownerId &&
        x.assetId !== a.assetId,
    );
    if (fromProceeds) continue;
    // the bank's own line shows the money leaving an account for it
    if (paid.has(a.assetId)) continue;
    const acct =
      position.assets.find(
        (x) =>
          x.type === 'bank_account' &&
          x.ownerId === a.ownerId &&
          a.linkedLast4 &&
          x.last4 === a.linkedLast4,
      ) ??
      position.assets.find(
        (x) =>
          x.type === 'bank_account' &&
          x.ownerId === a.ownerId &&
          x.institutionId &&
          x.institutionId === a.institutionId &&
          x.currency === 'INR',
      ) ??
      null;
    funding.push({
      assetId: a.assetId,
      name: a.name,
      ownerId: a.ownerId,
      bookedOn: a.fd.bookedOn,
      principal: a.fd.principal,
      suggestion: acct
        ? {
            assetId: acct.assetId,
            name: acct.name,
            why: 'a savings account of the same person at the same bank',
          }
        : null,
    });
  }
  // transfers between the family's own accounts: one balance rose and another fell by the same sum within a few days. The closest pair
  // (by sum, then by date) is offered as one transfer, already chosen; answering either side clears both.
  const taken = new Set<string>();
  const ups = balances.filter((b) => b.difference > 0);
  const downs = balances.filter((b) => b.difference < 0);
  const candidates = ups
    .flatMap((u) =>
      downs
        .filter(
          (d) =>
            d.assetId !== u.assetId &&
            same(u.difference, d.difference) &&
            apart(u.to.date, d.to.date) <= pairDays,
        )
        .map((d) => ({
          u,
          d,
          gap: Math.abs(u.difference + d.difference),
          days: apart(u.to.date, d.to.date),
        })),
    )
    .sort((x, y) => x.gap - y.gap || x.days - y.days);
  for (const { u, d } of candidates) {
    if (taken.has(u.key) || taken.has(d.key)) continue;
    taken.add(u.key);
    taken.add(d.key);
    u.pair = { assetId: d.assetId, name: d.name, date: d.to.date, difference: d.difference };
    d.pair = { assetId: u.assetId, name: u.name, date: u.to.date, difference: u.difference };
    u.suggestions.unshift({
      kind: 'transfer',
      amount: u.difference,
      assetId: d.assetId,
      assetName: d.name,
      label: `A transfer from ${d.name} (the same sum left it by ${d.to.date})`,
    });
    d.suggestions.unshift({
      kind: 'transfer',
      amount: d.difference,
      assetId: u.assetId,
      assetName: u.name,
      label: `A transfer to ${u.name} (the same sum arrived there by ${u.to.date})`,
    });
  }
  // a fall in a balance that matches a new deposit booked within a few days: the deposit's funding, offered on both sides
  for (const f of funding) {
    const from = downs.find(
      (d) =>
        !taken.has(d.key) &&
        d.ownerId === f.ownerId &&
        same(d.difference, f.principal) &&
        apart(d.to.date, f.bookedOn) <= pairDays,
    );
    if (!from) continue;
    taken.add(from.key);
    f.suggestion = {
      assetId: from.assetId,
      name: from.name,
      why: `the same sum left ${from.name} by ${from.to.date}`,
    };
    from.suggestions.unshift({
      kind: 'fd_funding',
      amount: from.difference,
      assetId: f.assetId,
      assetName: f.name,
      label: `Opened the deposit ${f.name} (booked ${f.bookedOn})`,
    });
  }
  return {
    proceeds: proceeds.sort((x, y) => y.outOn.localeCompare(x.outOn)),
    balances: balances.sort((x, y) => y.to.date.localeCompare(x.to.date)),
    funding: funding.sort((x, y) => y.bookedOn.localeCompare(x.bookedOn)),
    count: proceeds.length + balances.length + funding.length,
  };
}
