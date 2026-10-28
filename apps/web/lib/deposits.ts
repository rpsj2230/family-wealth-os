import {
  capacityKeyFor,
  DEFAULT_CONFIG,
  depositListState,
  dicgcPosition,
  daysBetween,
  heldValueOf,
  maturityVariance,
  partnerMissing,
  type CoverRow,
  type DepositListState,
  type FdRow,
  type ValuedAsset,
} from '@fwos/core';

export interface DepositAsset {
  id: string;
  ownerId: string;
  institutionId: string | null;
  type: string;
  status: string;
  nickname: string;
  accountKind: string | null;
  isJoint?: boolean;
  /** the second name on a joint account; the owner is the first */
  jointHolderId?: string | null;
}

export interface FdLine {
  id: string;
  bank: string;
  /** the bank's id, for linking to its page (null when the deposit has no bank) */
  bankId: string | null;
  ownerId: string;
  owner: string;
  nickname: string;
  kind: string;
  principal: number;
  rate: number;
  bookedOn: string;
  maturityOn: string;
  bankMaturity: number | null;
  accruedToday: number;
  daysLeft: number;
  status: string;
  /** difference between our quarterly-compounding figure and the bank's maturity amount, in percent */
  varianceVsBankPct: number | null;
  /** the day a deposit that is no longer held left, when the History import worked it out */
  endedOn?: string | null;
  /** show: listed as usual; confirm: matured within the window, waiting for "Confirm matured"; hidden: confirmed, or older than the window */
  listState?: DepositListState;
}

export interface DepositsView {
  fds: FdLine[];
  cover: ReturnType<typeof dicgcPosition> & {
    bankNames: Record<string, string>;
    ownerNames: Record<string, string>;
    assumptions: string[];
  };
  byMonth: { month: string; total: number; items: FdLine[] }[];
}

/**
 * FD register, maturity calendar and DICGC position.
 * Cover applies per bank and per ownership name as written (single, or joint names in a given order), on balance PLUS accrued
 * interest. Until the second name of a joint account is recorded it is grouped under its first name and the page says so.
 */
export function buildDeposits(
  assets: DepositAsset[],
  valued: ValuedAsset[],
  fds: FdRow[],
  banks: Map<string, string>,
  owners: Map<string, string>,
  today: Date,
  limit: number,
  /** banks outside the Indian deposit insurance scheme (foreign banks): their money is not counted in the cover */
  outside: ReadonlySet<string> = new Set(),
  /** Settings: deposits.hideMaturedAfterDays */
  hideAfterDays: number = DEFAULT_CONFIG.deposits.hideMaturedAfterDays,
): DepositsView {
  const todayIso = today.toISOString().slice(0, 10);
  const val = new Map(valued.map((v) => [v.assetId, v]));
  const fdBy = new Map(fds.map((f) => [f.asset_id, f]));
  const lines: FdLine[] = [];
  for (const a of assets) {
    const f = fdBy.get(a.id);
    if (!f || a.type !== 'fixed_deposit') continue;
    const maturityOn = new Date(f.maturity_on + 'T00:00:00Z');
    const bookedOn = new Date(f.booked_on + 'T00:00:00Z');
    const v =
      val.get(a.id)?.estimate?.estimatedAmount ?? heldValueOf(f, today.toISOString().slice(0, 10));
    lines.push({
      id: a.id,
      bank: a.institutionId ? (banks.get(a.institutionId) ?? 'Unknown bank') : 'Unknown bank',
      bankId: a.institutionId ?? null,
      ownerId: a.ownerId,
      owner: owners.get(a.ownerId) ?? '—',
      nickname: a.nickname,
      kind: a.accountKind ?? 'unknown',
      principal: Number(f.principal),
      rate: Number(f.rate),
      bookedOn: f.booked_on,
      maturityOn: f.maturity_on,
      bankMaturity: f.bank_maturity_amount === null ? null : Number(f.bank_maturity_amount),
      accruedToday: v,
      daysLeft: daysBetween(today, maturityOn),
      status: a.status,
      endedOn: f.ended_on ?? null,
      listState: depositListState({
        status: a.status,
        maturityOn: f.maturity_on,
        endedOn: f.ended_on ?? null,
        today: todayIso,
        hideAfterDays,
      }),
      varianceVsBankPct:
        f.bank_maturity_amount === null
          ? null
          : maturityVariance({
              principal: Number(f.principal),
              annualRate: Number(f.rate),
              bookedOn,
              maturityOn,
              bankMaturityAmount: Number(f.bank_maturity_amount),
              compounding: f.compounding,
            }).diffPct,
    });
  }
  lines.sort((x, y) => x.maturityOn.localeCompare(y.maturityOn));

  // DICGC: every INR deposit-type asset that counts today (active FDs and bank balances) at a known bank
  const deposits = assets
    .filter(
      (a) =>
        (a.type === 'fixed_deposit' || a.type === 'bank_account') &&
        // counted by the central engine's rule: a running deposit, or the proceeds of a matured one still awaiting confirmation (once);
        // proceeds already placed are in the savings account or the new deposit they went to, which are counted on their own
        (val.get(a.id)?.status ?? a.status) === 'active' &&
        !!val.get(a.id)?.estimate &&
        a.institutionId &&
        !outside.has(a.institutionId),
    )
    .map((a) => {
      const v = val.get(a.id)?.estimate?.estimatedAmount ?? 0;
      return {
        id: a.id,
        bankId: a.institutionId!,
        capacityKey: capacityKeyFor({
          ownerId: a.ownerId,
          isJoint: a.accountKind === 'joint' || !!a.isJoint,
          jointHolderId: a.jointHolderId ?? null,
        }),
        amountIncludingInterest: Math.max(0, v),
        label: a.nickname,
        kind: a.type === 'fixed_deposit' ? 'Fixed deposit' : 'Savings',
        status: a.status,
      };
    });
  const pos = dicgcPosition(deposits, limit);
  const assumptions: string[] = [];
  assumptions.push(
    'Cover is counted per bank and per ownership name as written. Rupash, Ragini, Rupash & Ragini and Ragini & Rupash are four different names, each insured separately; the order of the names matters. Set the second name of each joint account: press Edit on it, then More details.',
  );
  if (deposits.some((d) => partnerMissing(d.capacityKey))) {
    assumptions.push(
      'Some joint accounts have no second name recorded yet, so they are grouped by their first name until you set it.',
    );
  }
  assumptions.push(
    'All deposits at a bank are added together: savings, fixed and recurring deposits in the same ownership name count towards one limit. Open a row in the table to see what it is made of.',
  );
  assumptions.push(
    `Cover limit used: ₹${limit.toLocaleString('en-IN')} per ownership name, per bank (a rule that can change).`,
  );
  assumptions.push(
    'Cover counts the deposit plus accrued interest. Overseas (S$) accounts are not covered by this scheme and are not included.',
  );
  if (outside.size > 0)
    assumptions.push(
      `Not counted, because they are foreign banks outside the Indian scheme: ${[...outside].map((id) => banks.get(id) ?? 'a bank').join(', ')}.`,
    );

  const byMonthMap = new Map<string, FdLine[]>();
  for (const l of lines) {
    if (l.status !== 'active' || l.daysLeft < 0) continue;
    const key = l.maturityOn.slice(0, 7);
    byMonthMap.set(key, [...(byMonthMap.get(key) ?? []), l]);
  }
  const byMonth = [...byMonthMap.entries()].map(([month, items]) => ({
    month,
    total: items.reduce((s, i) => s + (i.bankMaturity ?? i.accruedToday), 0),
    items,
  }));
  return {
    fds: lines,
    cover: {
      ...pos,
      bankNames: Object.fromEntries(banks),
      ownerNames: Object.fromEntries(owners),
      assumptions,
    },
    byMonth,
  };
}

export type { CoverRow };
