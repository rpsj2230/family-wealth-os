/**
 * The money figures at the top of the daily summary: net worth, what it did today, the profit so far, and the four kinds of holding
 * (deposits, funds, cash, others). Pure, and the same arithmetic as Home's headline: the day's change is what the banks earned plus
 * the funds' move, the profit is what is worth less what was put in, and the four cards come from `classCards`, which makes them add
 * up to net worth exactly. Whoever loads the data builds the bank blocks and the overview the way Home does.
 */
import type { BankBlock } from './accounts-view';
import type { BankOverview } from './bank-overview';
import { capacityKeyFor, dicgcPosition } from './dicgc';
import type { ValuedAsset } from './networth';
import type { AssetRow } from './portfolio';
import { classCards, type ClassCard } from './home';

export interface DigestWealthInput {
  netWorth: number;
  blocks: BankBlock[];
  /** bankOverview() of those blocks, for the whole household */
  overview: BankOverview;
  /** the funds as Investments counts them; null when none is held */
  funds: {
    count: number;
    invested: number;
    value: number;
    /** what they moved in rupees over their last two prices (0 when no fund has a price move) */
    today: number;
    withoutStatement: number;
  } | null;
}

export interface DigestWealth {
  total: number;
  today: { amount: number; pct: number | null; banks: number; funds: number };
  overall: { invested: number; profit: number; profitPct: number | null; estimated: boolean };
  /** deposits, funds, cash and the rest: together they are net worth */
  classes: ClassCard[];
}

/** Deposits past their date that are still listed as running: in net worth, waiting to be confirmed. */
export function awaitingDeposits(blocks: BankBlock[]): {
  count: number;
  invested: number;
  current: number;
} {
  const rows = blocks
    .flatMap((b) => b.sections.flatMap((s) => s.rows))
    .filter((r) => r.fd?.needsConfirmation && r.status === 'active');
  return {
    count: rows.length,
    invested: rows.reduce((a, r) => a + r.fd!.principal, 0),
    current: rows.reduce((a, r) => a + (r.current ?? 0), 0),
  };
}

export function digestWealth(i: DigestWealthInput): DigestWealth {
  const o = i.overview;
  const fundsDay = i.funds ? i.funds.today : 0;
  const dayAmount = o.today.change + fundsDay;
  const dayBase = i.netWorth - dayAmount;
  const classes = classCards({
    netWorth: i.netWorth,
    fd: o.parts.fd,
    fdToday: o.today.fd,
    awaiting: awaitingDeposits(i.blocks),
    cash: o.parts.cash,
    cashToday: o.today.savings,
    othersHeld: o.parts.others,
    funds: i.funds,
    earned: {},
  });
  const invested = classes.reduce((a, c) => a + c.invested, 0);
  const profit = classes.reduce((a, c) => a + c.profit, 0);
  return {
    total: i.netWorth,
    today: {
      amount: dayAmount,
      pct: dayBase > 0 ? dayAmount / dayBase : null,
      banks: o.today.change,
      funds: fundsDay,
    },
    overall: {
      invested,
      profit,
      profitPct: invested > 0 ? profit / invested : null,
      estimated: classes.some((c) => c.estimated && c.profit !== 0),
    },
    classes,
  };
}

export interface DigestMaturity {
  name: string;
  /** ISO date */
  on: string;
  daysLeft: number;
  amount: number;
}

/** The largest deposits that pay out within `days`, biggest first. Deposits waiting to be confirmed are already past their date. */
export function biggestMaturities(
  blocks: BankBlock[],
  days: number,
  max: number,
): DigestMaturity[] {
  const out: DigestMaturity[] = [];
  for (const b of blocks)
    for (const s of b.sections)
      for (const r of s.rows)
        if (
          r.fd &&
          r.status === 'active' &&
          !r.fd.needsConfirmation &&
          r.fd.daysLeft >= 0 &&
          r.fd.daysLeft <= days
        )
          out.push({
            name: `${b.name} ${r.code}`,
            on: r.fd.maturityOn,
            daysLeft: r.fd.daysLeft,
            amount: r.fd.maturityAmount,
          });
  return out.sort((a, b) => b.amount - a.amount).slice(0, max);
}

/**
 * Money above the deposit-insurance limit, the way the Deposits page counts it (per bank and per ownership name, balance plus
 * interest, a deposit past its date still counted until it is paid out, foreign banks left out). The same rule as `buildDeposits`
 * in the web app, which a test holds equal to this one.
 */
export function depositCover(i: {
  assets: AssetRow[];
  valued: ValuedAsset[];
  /** the second holder of a joint account, by asset id */
  jointHolders: Record<string, string>;
  /** banks outside the insurance scheme */
  outside: ReadonlySet<string>;
  limit: number;
}): { limit: number; uninsured: number; banksOver: number } {
  const val = new Map(i.valued.map((v) => [v.assetId, v]));
  const deposits = i.assets
    .filter(
      (a) =>
        (a.type === 'fixed_deposit' || a.type === 'bank_account') &&
        (a.status === 'active' || a.status === 'matured_unconfirmed') &&
        a.institution_id &&
        !i.outside.has(a.institution_id),
    )
    .map((a) => ({
      id: a.id,
      bankId: a.institution_id!,
      capacityKey: capacityKeyFor({
        ownerId: a.owner_id,
        isJoint: a.account_kind === 'joint' || !!a.is_joint,
        jointHolderId: i.jointHolders[a.id] ?? null,
      }),
      amountIncludingInterest: Math.max(0, val.get(a.id)?.estimate?.estimatedAmount ?? 0),
    }));
  const pos = dicgcPosition(deposits, i.limit);
  return {
    limit: i.limit,
    uninsured: pos.uninsured,
    banksOver: Object.values(pos.byBank).filter((b) => b.uninsured > 0).length,
  };
}
