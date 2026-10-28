import { describe, expect, it } from 'vitest';
import { buildBankBlocks, filterBlocksByOwner } from '../src/accounts-view';
import { bankOverview, type OverviewOptions } from '../src/bank-overview';
import { fdValueOn } from '../src/fd';
import { formatPct } from '../src/money';
import { buildPortfolio, type AssetRow, type FdRow, type ObservationRow } from '../src/portfolio';

const today = new Date('2026-10-26T00:00:00Z');
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'r',
  type: 'bank_account',
  status: 'active',
  nickname: o.id,
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  institution_id: 'eq',
  ...o,
});
const obs = (o: Partial<ObservationRow> & { id: string; asset_id: string }): ObservationRow => ({
  kind: 'balance',
  amount: 100_000,
  currency: 'INR',
  fx_rate: null,
  as_of: '2026-10-20',
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: '2026-10-20T00:00:00Z',
  superseded_by: null,
  ...o,
});
const fd = (id: string, o: Partial<FdRow> = {}): FdRow => ({
  asset_id: id,
  principal: 500_000,
  rate: 0.08,
  booked_on: '2026-01-10',
  maturity_on: '2027-10-26',
  compounding: 'quarterly',
  bank_maturity_amount: null,
  ...o,
});

// r: a savings account, a long deposit and a deposit that matures in ten days (with the bank's own figure) at Equitas;
// g: a savings account and a deposit past its date (to confirm) at Yes Bank; r also has a Singapore account and money held by a friend.
const assets: AssetRow[] = [
  asset({ id: 'e-cash', sort_order: 1, identifier_last4: '1111' }),
  asset({ id: 'e-fd1', type: 'fixed_deposit', account_kind: null, sort_order: 2 }),
  asset({ id: 'e-fd2', type: 'fixed_deposit', account_kind: null, sort_order: 3 }),
  asset({
    id: 'y-cash',
    owner_id: 'g',
    institution_id: 'yb',
    account_kind: 'NRO',
    sort_order: 4,
  }),
  asset({
    id: 'y-fd',
    owner_id: 'g',
    institution_id: 'yb',
    type: 'fixed_deposit',
    account_kind: null,
    sort_order: 5,
  }),
  asset({ id: 'sg', currency: 'SGD', institution_id: 'yb', sort_order: 6, account_kind: 'NRE' }),
  asset({
    id: 'held',
    type: 'third_party_held',
    account_kind: null,
    institution_id: null,
    sort_order: 7,
  }),
];
const observations: ObservationRow[] = [
  obs({ id: '1', asset_id: 'e-cash', amount: 200_000 }),
  obs({ id: '2', asset_id: 'y-cash', amount: 100_000, as_of: '2026-09-01' }),
  obs({ id: '3', asset_id: 'sg', amount: 1_000, currency: 'SGD', fx_rate: 60 }),
  obs({ id: '4', asset_id: 'held', amount: 50_000 }),
];
const fds: FdRow[] = [
  fd('e-fd1', { principal: 1_000_000, booked_on: '2025-10-26', maturity_on: '2027-10-26' }),
  fd('e-fd2', {
    principal: 500_000,
    rate: 0.07,
    maturity_on: '2026-11-05',
    bank_maturity_amount: 530_000,
  }),
  fd('y-fd', { principal: 300_000, booked_on: '2025-10-20', maturity_on: '2026-10-20' }),
];
// y-fd's proceeds were placed the day after it matured (confirmed), so it is out of every total
const portfolio = buildPortfolio(assets, observations, fds, today, undefined, {
  placements: { 'y-fd': [{ on: '2026-10-21', amount: 400_000 }] },
});
const blocks = buildBankBlocks({
  assets,
  observations,
  fds,
  portfolio,
  institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
  today,
});
const base: OverviewOptions = { today, soonDays: 30, defaultSavingsRate: 0.03 };
const ov = bankOverview(blocks, base);

const sumCurrent = blocks.reduce((s, b) => s + b.totals.current, 0);
const fd1 = fds[0]!;
const fd1Day = (asOf: string) =>
  fdValueOn({
    principal: fd1.principal,
    annualRate: fd1.rate,
    bookedOn: new Date(`${fd1.booked_on}T00:00:00Z`),
    asOf: new Date(`${asOf}T00:00:00Z`),
    maturityOn: new Date(`${fd1.maturity_on}T00:00:00Z`),
    compounding: fd1.compounding,
  });

describe('bankOverview: the three totals', () => {
  it('current value is the same figure as the bank totals', () => {
    expect(ov.current).toBeCloseTo(sumCurrent, 6);
  });

  it('invested is deposit principal plus recorded balances; a foreign balance is taken at today’s rupee value', () => {
    const sg = blocks
      .flatMap((b) => b.sections.flatMap((s) => s.rows))
      .find((r) => r.assetId === 'sg')!;
    expect(sg.current).toBeCloseTo(60_000, 0);
    // y-fd is past its date and awaits confirmation: it is in none of the totals
    expect(ov.invested).toBeCloseTo(
      1_000_000 + 500_000 + 200_000 + 100_000 + sg.current! + 50_000,
      4,
    );
  });

  it('maturity value is what each deposit pays at maturity plus today’s value of savings and holdings', () => {
    const rows = blocks.flatMap((b) => b.sections.flatMap((s) => s.rows));
    const cash = rows.filter((r) => r.kind !== 'fd').reduce((s, r) => s + (r.current ?? 0), 0);
    const f1 = rows.find((r) => r.assetId === 'e-fd1')!.fd!.maturityAmount;
    expect(ov.maturity).toBeCloseTo(f1 + 530_000 + cash, 4);
    expect(ov.maturity).toBeGreaterThan(ov.current);
    expect(ov.current).toBeGreaterThan(ov.invested);
  });

  it('profit and profit % are current minus invested, over invested', () => {
    expect(ov.profit).toBeCloseTo(ov.current - ov.invested, 6);
    expect(ov.profitPct).toBeCloseTo(ov.profit / ov.invested, 9);
  });
});

describe('bankOverview: maturity proceeds awaiting confirmation', () => {
  it('counts the proceeds of a matured deposit once, in the deposits total, until you say where they went', () => {
    const p = buildPortfolio(assets, observations, fds, today);
    const b = buildBankBlocks({
      assets,
      observations,
      fds,
      portfolio: p,
      institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
      today,
    });
    const o = bankOverview(b, base);
    const row = b
      .flatMap((x) => x.sections.flatMap((s) => s.rows))
      .find((r) => r.assetId === 'y-fd')!;
    expect(row.inNetWorth).toBe(true);
    expect(row.fd!.proceedsAwaiting).toBe(true);
    expect(row.fd!.listState).toBe('confirm');
    expect(o.current).toBeCloseTo(ov.current + row.current!, 4);
    expect(o.current).toBeCloseTo(p.netWorth.total, 0);
    // it earns nothing after its date
    expect(o.today.fd).toBeCloseTo(ov.today.fd, 9);
  });
});

describe('bankOverview: today’s change', () => {
  it('a deposit earns its value today minus its value yesterday, a savings account one day at its rate', () => {
    const rows = blocks.flatMap((b) => b.sections.flatMap((s) => s.rows));
    const f2 = rows.find((r) => r.assetId === 'e-fd2')!;
    const e = rows.find((r) => r.assetId === 'e-cash')!;
    const fd2 = fds[1]!;
    const fd2Day = (d: string) =>
      fdValueOn({
        principal: fd2.principal,
        annualRate: fd2.rate,
        bookedOn: new Date(`${fd2.booked_on}T00:00:00Z`),
        asOf: new Date(`${d}T00:00:00Z`),
        maturityOn: new Date(`${fd2.maturity_on}T00:00:00Z`),
        compounding: fd2.compounding,
      });
    expect(f2.fd!.daysLeft).toBe(10);
    const expectedFd =
      fd1Day('2026-10-26') - fd1Day('2026-10-25') + (fd2Day('2026-10-26') - fd2Day('2026-10-25'));
    expect(ov.today.fd).toBeCloseTo(expectedFd, 6);
    // INR savings only: the Singapore account and the friend's money earn nothing here. A day's interest is the last recorded
    // balance at the rate, the shared definition of period-gains, so it is the same figure on every page
    const other = blocks[1]!.sections[0]!.rows[0]!;
    // (interest credited on 30 Sep earns too, so the day's interest is a little above the recorded balance at the rate)
    expect(ov.today.savings).toBeCloseTo(((e.recorded! + other.recorded!) * 0.03) / 365, 1);
    expect(ov.today.savings).toBeGreaterThanOrEqual(((e.recorded! + other.recorded!) * 0.03) / 365);
    expect(ov.today.change).toBeCloseTo(ov.today.fd + ov.today.savings, 9);
    expect(ov.today.basis).toBe('estimate');
  });

  it('uses the rate given for an account, and the percentage is against yesterday’s value', () => {
    const rich = bankOverview(blocks, { ...base, savingsRates: { 'e-cash': 0.07 } });
    expect(rich.today.savings).toBeGreaterThan(ov.today.savings);
    expect(ov.today.changePct).toBeCloseTo(ov.today.change / (ov.current - ov.today.change), 9);
  });

  it('takes the tax rate off savings interest', () => {
    const net = bankOverview(blocks, { ...base, tdsRate: 0.1 });
    expect(net.today.savings).toBeCloseTo(ov.today.savings * 0.9, 2);
    expect(net.today.savings).toBeLessThan(ov.today.savings);
  });
});

describe('bankOverview: where it sits', () => {
  it('splits into savings, deposits and other holdings, and the shares add up to one', () => {
    const w = Object.fromEntries(ov.where.map((x) => [x.key, x]));
    expect(w.others!.amount).toBeCloseTo(50_000, 0);
    expect(w.fd!.count).toBe(2);
    expect(w.cash!.count).toBe(3); // two rupee savings accounts and the Singapore account
    expect(ov.where.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 9);
    expect(ov.where.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(ov.current, 6);
    expect(ov.deposits).toBe(2);
  });

  it('counts banks without the block of holdings that have no bank', () => {
    expect(blocks.map((b) => b.name)).toContain('Other holdings');
    expect(ov.banks).toBe(2);
  });

  it('names the biggest bank and its share of the money in banks', () => {
    expect(ov.topBank!.name).toBe('Equitas');
    const bankTotal = blocks
      .filter((b) => b.name !== 'Other holdings')
      .reduce((s, b) => s + b.totals.current, 0);
    expect(ov.topBank!.share).toBeCloseTo(blocks[0]!.totals.current / bankTotal, 9);
  });

  it('splits by NRE and NRO, and by person, largest first', () => {
    const t = Object.fromEntries(ov.accountTypes.map((x) => [x.key, x.amount]));
    expect(t.NRO).toBeCloseTo(blocks[1]!.sections[0]!.rows[0]!.current!, 6);
    expect(t.unset).toBeGreaterThan(0); // the friend’s money has no account type
    expect(ov.accountTypes.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(ov.current, 6);
    expect(ov.people.map((p) => p.ownerId)).toEqual(['r', 'g']);
    expect(ov.people.reduce((s, p) => s + p.share, 0)).toBeCloseTo(1, 9);
  });
});

describe('bankOverview: interest and maturities', () => {
  it('says how much interest is earned, how much is still to come and how far along it is', () => {
    expect(ov.interest.earned).toBeCloseTo(ov.profit, 6);
    expect(ov.interest.toEarn).toBeCloseTo(ov.maturity - ov.current, 6);
    expect(ov.interest.total).toBeCloseTo(ov.maturity - ov.invested, 6);
    expect(ov.interest.journey!).toBeGreaterThan(0);
    expect(ov.interest.journey!).toBeLessThan(1);
    expect(ov.interest.journey!).toBeCloseTo(ov.interest.earned / ov.interest.total, 9);
  });

  it('weights the average deposit rate by the amount put in', () => {
    expect(ov.fdRate).toBeCloseTo((1_000_000 * 0.08 + 500_000 * 0.07) / 1_500_000, 9);
  });

  it('finds the next maturity and uses the window from Settings for what matures soon', () => {
    expect(ov.next).toMatchObject({
      date: '2026-11-05',
      days: 10,
      amount: 530_000,
      count: 1,
      bank: 'Equitas',
      ownerId: 'r',
    });
    expect(ov.soon).toEqual({ days: 30, count: 1, amount: 530_000 });
    expect(bankOverview(blocks, { ...base, soonDays: 5 }).soon).toEqual({
      days: 5,
      count: 0,
      amount: 0,
    });
    expect(bankOverview(blocks, { ...base, soonDays: 400 }).soon.count).toBe(2);
  });

  it('does not count a deposit past its date until it is confirmed, and says so', () => {
    expect(ov.toConfirm).toBe(1);
    expect(ov.needsYou).toBeGreaterThanOrEqual(1);
    expect(ov.deposits).toBe(2);
  });
});

describe('bankOverview: cover, freshness and people', () => {
  it('shows nothing about cover when no limit is given, and the amount above it per bank and name when it is', () => {
    expect(ov.cover).toBeNull();
    const c = bankOverview(blocks, { ...base, insuranceLimit: 500_000 }).cover!;
    // Equitas, r: savings + two deposits are far above 5 lakh; Yes Bank: g's savings (1 lakh) and the Singapore account are not counted/covered
    expect(c.limit).toBe(500_000);
    expect(c.banksOver).toBe(1);
    const eq = blocks[0]!.totals;
    expect(c.uninsured).toBeCloseTo(eq.current - 500_000, 4);
    expect(c.insured + c.uninsured).toBeGreaterThan(0);
  });

  it('counts joint accounts under their own name', () => {
    const joint = assets.map((a) => (a.id === 'e-cash' ? { ...a, is_joint: true } : a));
    const b = buildBankBlocks({
      assets: joint,
      observations,
      fds,
      portfolio: buildPortfolio(joint, observations, fds, today),
      institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
      today,
    });
    const single = bankOverview(b, { ...base, insuranceLimit: 500_000 }).cover!;
    const split = bankOverview(b, {
      ...base,
      insuranceLimit: 500_000,
      jointHolders: { 'e-cash': 'g' },
    }).cover!;
    const solo = bankOverview(blocks, { ...base, insuranceLimit: 500_000 }).cover!;
    expect(single.uninsured).toBeCloseTo(solo.uninsured - 200_000 - 0.0, -3); // the joint account is covered on its own name
    expect(split.uninsured).toBeCloseTo(single.uninsured, 6);
  });

  it('follows the person chosen: the overview of one person adds up to their rows only', () => {
    const mine = bankOverview(filterBlocksByOwner(blocks, 'g'), base);
    expect(mine.people.map((p) => p.ownerId)).toEqual(['g']);
    expect(mine.current).toBeCloseTo(ov.people.find((p) => p.ownerId === 'g')!.current, 6);
    expect(mine.next).toBeNull();
    expect(mine.fdRate).toBeNull();
    expect(mine.deposits).toBe(0);
  });

  it('reports banks updated this month and the oldest balance', () => {
    expect(ov.banksDone).toBe(1); // Equitas only: Yes Bank has a September balance, and holdings without a bank are not a bank
    expect(ov.oldestUpdate).toBe('2026-09-01');
    const rows = blocks.flatMap((b) => b.sections.flatMap((x) => x.rows));
    expect(ov.staleBalances).toBe(rows.filter((r) => r.kind !== 'fd' && r.stale).length);
  });

  it('is all zeros and nulls with nothing to show', () => {
    const e = bankOverview([], base);
    expect(e).toMatchObject({
      banks: 0,
      invested: 0,
      current: 0,
      profit: 0,
      profitPct: null,
      fdRate: null,
      next: null,
      topBank: null,
      people: [],
      oldestUpdate: null,
    });
    expect(e.today.changePct).toBeNull();
    expect(e.interest.journey).toBeNull();
    expect(e.where.every((x) => x.share === 0)).toBe(true);
  });
});

describe('formatPct', () => {
  it('writes a share as a percentage and never rounds a small share to zero', () => {
    expect(formatPct(0.1234)).toBe('12.3%');
    expect(formatPct(0.1234, 0)).toBe('12%');
    expect(formatPct(0)).toBe('0.0%');
    expect(formatPct(0.00002, 2)).toBe('<0.01%');
    expect(formatPct(-0.05)).toBe('-5.0%');
    expect(formatPct(Number.NaN)).toBe('–');
  });
});
