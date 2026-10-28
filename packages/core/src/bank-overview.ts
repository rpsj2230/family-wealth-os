/**
 * The "money in banks" overview at the top of Accounts: what was put in, what it is worth today, what it will be worth at maturity,
 * what it earned (in total and in the last day), where it sits and who holds it. Pure functions over the bank blocks; the page only
 * draws what this returns, so every figure can be tested.
 *
 * What counts is the same as in the bank totals (an active deposit not awaiting confirmation, a savings balance not closed), so
 * `current` always equals the sum of the blocks' own totals.
 *
 * Meaning of each figure:
 *  - invested: deposit principal + the last recorded balance of every savings account and holding
 *  - maturity: the amount each deposit pays at maturity + today's value of savings and holdings (they have no maturity)
 *  - current: today's value of each line, as estimated by the portfolio
 *  - today's change: what the lines earned in the last day, worked out by period-gains (the one module for every period figure). A
 *    deposit earns the difference between its value today and its value yesterday on its own terms; a savings account earns its last
 *    recorded balance at its rate, after tax at source, for one day. It is an estimate (the bank credits
 *    savings interest in lumps), and money held by others earns nothing in this figure.
 * Foreign-currency lines are counted at today's rupee value with no gain or loss (the exchange rate is not interest).
 */
import { dicgcPosition, capacityKeyFor } from './dicgc';
import { daysBetween } from './fd';
import { depositPeriod, recentWindow, savingsPeriod } from './period-gains';
import { OTHER_HOLDINGS_KEY, type BankBlock, type BankRow } from './accounts-view';
import {
  datedForeignCash,
  rowForeignItem,
  sumForeignCash,
  type ForeignCash,
  type ForeignCashItem,
  type FxOnFile,
} from './foreign-cash';

export interface OverviewPart {
  /** number of lines (accounts or deposits) */
  count: number;
  invested: number;
  current: number;
  maturity: number;
}

export interface OverviewShare {
  key: 'cash' | 'fd' | 'others';
  label: string;
  amount: number;
  /** 0 to 1 of the total today */
  share: number;
  count: number;
}

export interface OverviewPerson {
  ownerId: string;
  current: number;
  invested: number;
  profit: number;
  /** 0 to 1 of the total today */
  share: number;
  /** the part of this person's savings and cash that is in another currency (already inside `current`) */
  foreign: ForeignCash[];
}

export interface OverviewNextMaturity {
  /** ISO date */
  date: string;
  days: number;
  /** what is paid on that date (all deposits maturing that day) */
  amount: number;
  count: number;
  bank: string;
  ownerId: string;
}

export interface BankOverview {
  /** banks with at least one line (the block of holdings without a bank is not a bank) */
  banks: number;
  /** savings accounts and deposits counted */
  accounts: number;
  deposits: number;

  invested: number;
  maturity: number;
  current: number;

  profit: number;
  /** (current - invested) / invested; null when nothing is invested */
  profitPct: number | null;

  today: {
    change: number;
    /** against yesterday's value; null when there is no value */
    changePct: number | null;
    fd: number;
    savings: number;
    /** always 'estimate': worked out from rates, not read from a bank */
    basis: 'estimate';
  };

  parts: { cash: OverviewPart; fd: OverviewPart; others: OverviewPart };
  /**
   * The part of `parts.cash` that is held in another currency, one entry per currency, the biggest in rupees first: the balance in its
   * own currency and its worth in rupees today. It is already inside `parts.cash.current`, which stays the rupee total of all cash.
   */
  foreign: ForeignCash[];
  /** the three places the money sits, in a fixed order, with their share of the total */
  where: OverviewShare[];

  interest: {
    /** earned so far: current - invested */
    earned: number;
    /** still to earn until every deposit matures: maturity - current */
    toEarn: number;
    /** earned + still to earn */
    total: number;
    /** how far along the journey invested -> maturity today is, 0 to 1; null when there is nothing to earn */
    journey: number | null;
  };

  /** average rate of the deposits weighted by amount put in (decimal); null without a deposit */
  fdRate: number | null;
  next: OverviewNextMaturity | null;
  soon: { days: number; count: number; amount: number };
  topBank: { name: string; amount: number; share: number } | null;

  accountTypes: { key: 'NRE' | 'NRO' | 'unset'; label: string; amount: number; share: number }[];
  people: OverviewPerson[];

  /** deposit insurance: null when no limit was given */
  cover: { limit: number; insured: number; uninsured: number; banksOver: number } | null;

  banksDone: number;
  /** stale balances plus deposits to confirm */
  needsYou: number;
  staleBalances: number;
  toConfirm: number;
  oldestUpdate: string | null;
}

export interface OverviewOptions {
  today: Date;
  /** a deposit maturing within this many days counts as "soon" (Settings: reminders.maturitySoonDays) */
  soonDays: number;
  /** savings rate per asset id (decimal), as shown beside each account */
  savingsRates?: Record<string, number | null | undefined>;
  /** used for a savings account with no rate of its own (Settings: estimates.savingsRate) */
  defaultSavingsRate: number;
  /** tax taken off savings interest (Settings: estimates.interestTdsRate) */
  tdsRate?: number;
  /** deposit insurance limit per bank per ownership name (Settings: deposits.insuranceLimit) */
  insuranceLimit?: number;
  /** banks outside deposit insurance, by the block key (a foreign bank's branch): left out of the cover */
  uninsuredBanks?: ReadonlySet<string>;
  /** second holder of a joint account, by asset id, so cover is counted per ownership name */
  jointHolders?: Record<string, string>;
  /** the latest exchange rate on file per currency, to date the rate behind a foreign balance's rupee value */
  fx?: FxOnFile;
}

const WHERE_LABEL = { cash: 'Savings and cash', fd: 'Fixed deposits', others: 'Other holdings' };
const TYPE_LABEL = { NRE: 'NRE', NRO: 'NRO', unset: 'No type set' };

const emptyPart = (): OverviewPart => ({ count: 0, invested: 0, current: 0, maturity: 0 });
const ratio = (a: number, b: number) => (b > 0 ? a / b : 0);

/** Whether a row is in the totals: the same rule as the block totals. */
function counted(r: BankRow): boolean {
  // the central engine's rule when the row carries it (proceeds awaiting confirmation are counted once), else the older status rule
  if (r.inNetWorth !== undefined && r.kind === 'fd') return r.inNetWorth;
  if (r.kind === 'fd' && r.fd) return r.status === 'active' && !r.fd.needsConfirmation;
  return r.status !== 'closed' && r.status !== 'stopped';
}

/**
 * What one line adds to the totals: invested (deposit principal, or the last balance recorded), what it pays at maturity (savings: today's
 * value) and today's value. `counted` is false for a line that is out of the totals (closed, stopped, or a deposit past its date waiting to
 * be confirmed). The page totals and the overview use this one function, so they always agree.
 */
export function bankRowFigures(r: BankRow): {
  counted: boolean;
  invested: number;
  maturity: number;
  current: number;
} {
  const current = r.current ?? 0;
  if (r.kind === 'fd' && r.fd)
    return {
      counted: counted(r),
      invested: r.fd.principal,
      maturity: r.fd.maturityAmount,
      current,
    };
  // a foreign balance is in another currency: take it at today's rupee value, with no gain or loss
  return {
    counted: counted(r),
    invested: r.currency === 'INR' ? (r.recorded ?? current) : current,
    maturity: current,
    current,
  };
}

export function bankOverview(blocks: BankBlock[], opts: OverviewOptions): BankOverview {
  // "earned today" is the last day of the shared period figures (period-gains), so it agrees with Home and the other pages
  const todayIso = opts.today.toISOString().slice(0, 10);
  const lastDay = recentWindow(todayIso, 1);
  const parts = { cash: emptyPart(), fd: emptyPart(), others: emptyPart() };
  const byOwner = new Map<string, { current: number; invested: number }>();
  const foreignItems: ForeignCashItem[] = [];
  const foreignByOwner = new Map<string, ForeignCashItem[]>();
  const byType = { NRE: 0, NRO: 0, unset: 0 };
  const byBank = new Map<string, { name: string; amount: number }>();
  const coverRows: Parameters<typeof dicgcPosition>[0] = [];
  const nextCandidates: { row: BankRow; bank: string }[] = [];
  let fdRateWeight = 0;
  let fdRateSum = 0;
  let todayFd = 0;
  let todaySavings = 0;
  let soonCount = 0;
  let soonAmount = 0;
  let stale = 0;
  let toConfirm = 0;
  let needsYou = 0;
  let banksDone = 0;
  let banks = 0;
  const dates: string[] = [];
  const tds = opts.tdsRate ?? 0;

  for (const b of blocks) {
    const isBank = b.key !== OTHER_HOLDINGS_KEY;
    needsYou += b.needsYou;
    if (isBank) banks++;
    if (isBank && b.doneThisMonth) banksDone++;
    for (const sct of b.sections) {
      for (const r of sct.rows) {
        if (r.kind === 'fd' && r.fd?.listState === 'confirm') toConfirm++;
        if (r.kind !== 'fd' && r.stale && r.status !== 'closed' && r.status !== 'stopped') stale++;
        if (!counted(r)) continue;
        if (r.kind !== 'fd' && r.asOf) dates.push(r.asOf);
        const { current, invested, maturity } = bankRowFigures(r);
        const isFd = r.kind === 'fd' && !!r.fd;
        const bucket = isFd ? parts.fd : r.kind === 'held' || !isBank ? parts.others : parts.cash;
        bucket.count++;
        bucket.invested += invested;
        bucket.current += current;
        bucket.maturity += maturity;
        if (bucket === parts.cash) {
          const fi = rowForeignItem(r);
          if (fi) {
            foreignItems.push(fi);
            (
              foreignByOwner.get(r.ownerId) ?? foreignByOwner.set(r.ownerId, []).get(r.ownerId)!
            ).push(fi);
          }
        }

        const o = byOwner.get(r.ownerId) ?? { current: 0, invested: 0 };
        o.current += current;
        o.invested += invested;
        byOwner.set(r.ownerId, o);
        byType[r.accountKind ?? 'unset'] += current;
        if (isBank) {
          const bk = byBank.get(b.key) ?? { name: b.name, amount: 0 };
          bk.amount += current;
          byBank.set(b.key, bk);
        }

        if (isFd) {
          const fd = r.fd!;
          fdRateSum += fd.principal * fd.rate;
          fdRateWeight += fd.principal;
          if (fd.daysLeft >= 0) {
            todayFd += Math.max(
              0,
              depositPeriod(
                [
                  {
                    assetId: r.assetId,
                    principal: fd.principal,
                    rate: fd.rate,
                    bookedOn: fd.bookedOn,
                    maturityOn: fd.maturityOn,
                    compounding: fd.compounding,
                    held: true,
                  },
                ],
                lastDay,
                todayIso,
              ).profit,
            );
            nextCandidates.push({ row: r, bank: b.name });
            if (fd.daysLeft <= opts.soonDays) {
              soonCount++;
              soonAmount += fd.maturityAmount;
            }
          }
        } else if (r.kind === 'cash' && r.status === 'active' && r.currency === 'INR') {
          todaySavings += savingsPeriod(
            [
              {
                assetId: r.assetId,
                currency: r.currency,
                rate: opts.savingsRates?.[r.assetId] ?? opts.defaultSavingsRate,
                tdsRate: tds,
                balances:
                  r.asOf && r.recorded !== null ? [{ date: r.asOf, amount: r.recorded }] : [],
              },
            ],
            lastDay,
          ).profit;
        }

        if (
          opts.insuranceLimit &&
          isBank &&
          !opts.uninsuredBanks?.has(b.key) &&
          r.currency === 'INR' &&
          r.status === 'active'
        ) {
          coverRows.push({
            id: r.assetId,
            bankId: b.key,
            capacityKey: capacityKeyFor({
              ownerId: r.ownerId,
              isJoint: r.joint,
              jointHolderId: opts.jointHolders?.[r.assetId] ?? null,
            }),
            amountIncludingInterest: Math.max(0, current),
          });
        }
      }
    }
  }

  const sum = (f: (p: OverviewPart) => number) => f(parts.cash) + f(parts.fd) + f(parts.others);
  const invested = sum((p) => p.invested);
  const maturity = sum((p) => p.maturity);
  const current = sum((p) => p.current);
  const profit = current - invested;
  const change = todayFd + todaySavings;
  const earlier = current - change;
  const toEarn = maturity - current;
  const bankTotal = [...byBank.values()].reduce((s, x) => s + x.amount, 0);
  const top = [...byBank.values()].sort((a, b) => b.amount - a.amount)[0];

  const soonest = nextCandidates.sort(
    (a, b) => a.row.fd!.daysLeft - b.row.fd!.daysLeft || a.row.order - b.row.order,
  )[0];
  const next: OverviewNextMaturity | null = soonest
    ? (() => {
        const same = nextCandidates.filter(
          (c) => c.row.fd!.maturityOn === soonest.row.fd!.maturityOn,
        );
        return {
          date: soonest.row.fd!.maturityOn,
          days: daysBetween(opts.today, new Date(`${soonest.row.fd!.maturityOn}T00:00:00Z`)),
          amount: same.reduce((s, c) => s + c.row.fd!.maturityAmount, 0),
          count: same.length,
          bank: soonest.bank,
          ownerId: soonest.row.ownerId,
        };
      })()
    : null;

  const pos = opts.insuranceLimit ? dicgcPosition(coverRows, opts.insuranceLimit) : null;

  return {
    banks,
    accounts: parts.cash.count + parts.others.count,
    deposits: parts.fd.count,
    invested,
    maturity,
    current,
    profit,
    profitPct: invested > 0 ? profit / invested : null,
    today: {
      change,
      changePct: earlier > 0 ? change / earlier : null,
      fd: todayFd,
      savings: todaySavings,
      basis: 'estimate',
    },
    parts,
    foreign: datedForeignCash(sumForeignCash(foreignItems), opts.fx),
    where: (['cash', 'fd', 'others'] as const).map((key) => ({
      key,
      label: WHERE_LABEL[key],
      amount: parts[key].current,
      share: ratio(parts[key].current, current),
      count: parts[key].count,
    })),
    interest: {
      earned: profit,
      toEarn,
      total: profit + toEarn,
      journey:
        maturity > invested ? Math.min(1, Math.max(0, profit / (maturity - invested))) : null,
    },
    fdRate: fdRateWeight > 0 ? fdRateSum / fdRateWeight : null,
    next,
    soon: { days: opts.soonDays, count: soonCount, amount: soonAmount },
    topBank: top
      ? { name: top.name, amount: top.amount, share: ratio(top.amount, bankTotal) }
      : null,
    accountTypes: (['NRE', 'NRO', 'unset'] as const)
      .map((key) => ({
        key,
        label: TYPE_LABEL[key],
        amount: byType[key],
        share: ratio(byType[key], current),
      }))
      .filter((t) => t.amount > 0),
    people: [...byOwner.entries()]
      .map(([ownerId, v]) => ({
        ownerId,
        current: v.current,
        invested: v.invested,
        profit: v.current - v.invested,
        share: ratio(v.current, current),
        foreign: datedForeignCash(sumForeignCash(foreignByOwner.get(ownerId) ?? []), opts.fx),
      }))
      .sort((a, b) => b.current - a.current),
    cover: pos
      ? {
          limit: pos.limit,
          insured: pos.insured,
          uninsured: pos.uninsured,
          banksOver: Object.values(pos.byBank).filter((x) => x.uninsured > 0).length,
        }
      : null,
    banksDone,
    needsYou,
    staleBalances: stale,
    toConfirm,
    oldestUpdate: dates.length > 0 ? dates.reduce((a, b) => (a < b ? a : b)) : null,
  };
}
