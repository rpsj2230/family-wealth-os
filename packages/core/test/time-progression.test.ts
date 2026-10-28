/**
 * Acceptance test 13 (time progression): the application is left untouched for several days and opened again. With no new record,
 * savings estimates, deposit accrual, maturity statuses and market values move on to the day it is opened, and a price that has not
 * been refreshed is flagged as old rather than presented as today's.
 */
import { describe, expect, it } from 'vitest';
import {
  depositOn,
  fundViews,
  positionAsOf,
  type PositionAsset,
  type PositionConfig,
  type PositionInput,
} from '../src';

const DAY0 = '2026-10-20';
const LATER = '2026-10-28'; // eight days later, nothing recorded in between

const cfg = (today: string): PositionConfig => ({
  today,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
});

const asset = (
  o: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'o1',
  status: 'active',
  name: o.assetId,
  currency: 'INR',
  rate: { own: 0.04, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  ...o,
});

const savings = asset({
  assetId: 'sav',
  type: 'bank_account',
  records: [{ date: '2026-10-01', amount: 500_000, currency: 'INR', fxRate: null }],
});
const running = asset({
  assetId: 'fd-running',
  type: 'fixed_deposit',
  fd: {
    principal: 1_000_000,
    rate: 0.07,
    bookedOn: '2025-10-01',
    maturityOn: '2027-10-01',
    compounding: 'quarterly',
    bankMaturityAmount: null,
    endedOn: null,
  },
});
// matures between the two visits; nobody has said where the money went
const contract = {
  principal: 1_000_000,
  rate: 0.07,
  bookedOn: '2025-10-24',
  maturityOn: '2026-10-24',
  compounding: 'quarterly' as const,
  bankMaturityAmount: null,
  endedOn: null,
};
const maturing = asset({
  assetId: 'fd-maturing',
  type: 'fixed_deposit',
  fd: {
    ...contract,
    proceeds: {
      status: 'awaiting',
      amount: 1_071_859,
      placedOn: null,
      countedToday: 1_071_859,
      note: 'Waiting for you to say where the money went.',
    },
  },
});
// the price list stops on 22 Oct (a market holiday or a job that did not run)
const fund = asset({
  assetId: 'fund',
  type: 'mutual_fund',
  rate: { own: null, listed: null, tds: null },
  fund: {
    txns: [{ date: '2026-01-05', units: 1_000, amount: 100_000, estimated: false }],
    navs: [
      { date: '2026-10-19', nav: 120 },
      { date: '2026-10-20', nav: 121 },
      { date: '2026-10-22', nav: 123 },
    ],
    units: { units: 1_000, asOf: '2026-09-30' },
    snapshots: [],
    flows: [{ date: '2026-01-05', amount: 100_000 }],
    hasStatement: true,
    estimatedSince: null,
  },
});

const input = (today: string): PositionInput => ({
  assets: [savings, running, maturing, fund],
  config: cfg(today),
});
const holding = (today: string, id: string) =>
  positionAsOf(input(today), today).holdings.find((h) => h.assetId === id)!;

describe('acceptance test 13: opened again after several days with nothing recorded', () => {
  it('the savings estimate earns interest for the days that passed, from the same confirmed balance', () => {
    const a = holding(DAY0, 'sav');
    const b = holding(LATER, 'sav');
    expect(a.savings!.baseline).toEqual(b.savings!.baseline);
    expect(b.value!).toBeGreaterThan(a.value!);
    expect(b.estimated).toBe(true);
    // 8 more days at 4% on ₹5,00,000, give or take a credit date
    expect(b.value! - a.value!).toBeCloseTo((500_000 * 0.04 * 8) / 365, -1);
  });

  it('a running deposit accrues for those days', () => {
    const a = holding(DAY0, 'fd-running');
    const b = holding(LATER, 'fd-running');
    expect(b.value!).toBeGreaterThan(a.value!);
    expect(b.state).toBe('held');
  });

  it('a deposit that matured in between is no longer valued as running: its proceeds are counted once, awaiting confirmation', () => {
    const a = holding(DAY0, 'fd-maturing');
    const b = holding(LATER, 'fd-maturing');
    expect(a.deposit?.proceeds).toBe(false);
    expect(b.deposit?.proceeds).toBe(true);
    expect(b.value!).toBeCloseTo(1_071_859, 0);
    // the contract agrees: on the later day the money has left the deposit
    const later = depositOn({ ...contract, payout: 'cumulative' }, LATER);
    expect(later.state).not.toBe('running');
  });

  it('a fund uses the latest price available, and a price that stopped is flagged as old instead of passed off as today’s', () => {
    const a = holding(DAY0, 'fund');
    const b = holding(LATER, 'fund');
    expect(a.value).toBeCloseTo(1_000 * 121, 6);
    expect(b.value).toBeCloseTo(1_000 * 123, 6);
    expect(b.fundSplit?.nav).toEqual({ date: '2026-10-22', nav: 123 });
    const fresh = fundViews(input(DAY0), { navStaleDays: 4, upcomingDays: 30 });
    const old = fundViews(input(LATER), { navStaleDays: 4, upcomingDays: 30 });
    expect(fresh.staleCount).toBe(0);
    expect(old.staleCount).toBe(1);
    expect(old.oldestNav).toBe('2026-10-22');
  });

  it('net worth on the later day is the sum of the moved-on holdings, with nothing new recorded', () => {
    const later = positionAsOf(input(LATER), LATER);
    const sum = later.holdings.reduce((t, h) => t + (h.value ?? 0), 0);
    expect(sum).toBeGreaterThan(
      positionAsOf(input(DAY0), DAY0).holdings.reduce((t, h) => t + (h.value ?? 0), 0),
    );
  });
});
