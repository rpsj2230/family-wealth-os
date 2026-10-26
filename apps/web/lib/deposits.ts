import {
  capacityKeyFor,
  dicgcPosition,
  daysBetween,
  fdValueOn,
  maturityVariance,
  partnerMissing,
  type CoverRow,
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
): DepositsView {
  const val = new Map(valued.map((v) => [v.assetId, v]));
  const fdBy = new Map(fds.map((f) => [f.asset_id, f]));
  const lines: FdLine[] = [];
  for (const a of assets) {
    const f = fdBy.get(a.id);
    if (!f || a.type !== 'fixed_deposit') continue;
    const maturityOn = new Date(f.maturity_on + 'T00:00:00Z');
    const bookedOn = new Date(f.booked_on + 'T00:00:00Z');
    const v =
      val.get(a.id)?.estimate?.estimatedAmount ??
      fdValueOn({
        principal: f.principal,
        annualRate: f.rate,
        bookedOn,
        asOf: today,
        maturityOn,
        compounding: f.compounding,
      });
    lines.push({
      id: a.id,
      bank: a.institutionId ? (banks.get(a.institutionId) ?? 'Unknown bank') : 'Unknown bank',
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
        a.status === 'active' &&
        a.institutionId,
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
      };
    });
  const pos = dicgcPosition(deposits, limit);
  const assumptions: string[] = [];
  assumptions.push(
    'Cover is counted per bank and per ownership name as written. Rupash, Ragini, Rupash & Ragini and Ragini & Rupash are four different names, each insured separately; the order of the names matters. Set the second name of each joint account under Correct tags and details.',
  );
  if (deposits.some((d) => partnerMissing(d.capacityKey))) {
    assumptions.push(
      'Some joint accounts have no second name recorded yet, so they are grouped by their first name until you set it.',
    );
  }
  assumptions.push(
    `Cover limit used: ₹${limit.toLocaleString('en-IN')} per ownership name, per bank (a rule that can change).`,
  );
  assumptions.push(
    'Cover counts the deposit plus accrued interest. Overseas (S$) accounts are not covered by this scheme and are not included.',
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
