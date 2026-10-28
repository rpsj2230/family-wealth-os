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

export function reconcileQueue(args: {
  position: PositionInput;
  moves: QueueMove[];
  /** Settings: a difference within this many rupees is explained */
  tolerance: number;
  /** how far back to look for balances that do not match and deposits with no source, in days */
  sinceDays: number;
}): ReconcileQueue {
  const { position, moves } = args;
  const c = position.config;
  const today = c.today;
  const since = addDaysIso(today, -args.sinceDays);
  const byId = new Map(position.assets.map((a) => [a.assetId, a]));
  const confirmed = moves.filter((m) => m.status === 'confirmed');
  const answered = new Set(moves.filter((m) => m.idemKey).map((m) => m.idemKey!));

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
  return {
    proceeds: proceeds.sort((x, y) => y.outOn.localeCompare(x.outOn)),
    balances: balances.sort((x, y) => y.to.date.localeCompare(x.to.date)),
    funding: funding.sort((x, y) => y.bookedOn.localeCompare(x.bookedOn)),
    count: proceeds.length + balances.length + funding.length,
  };
}
