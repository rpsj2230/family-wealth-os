import { describe, expect, it } from 'vitest';
import { capitalLedger, type LedgerMove } from '../src/capital';
import { historyReview } from '../src/history-review';
import { attachProceeds } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';

const TODAY = '2026-10-27';
const cfg: PositionConfig = {
  today: TODAY,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
};
const rec = (date: string, amount: number) => ({ date, amount, currency: 'INR', fxRate: null });
const savings = (id: string, records: ReturnType<typeof rec>[]): PositionAsset => ({
  assetId: id,
  ownerId: 'r',
  type: 'bank_account',
  status: 'active',
  name: `${id} savings`,
  currency: 'INR',
  rate: { own: 0.03, listed: null, tds: null },
  records,
  fd: null,
  fund: null,
  institutionId: id,
});
const input = (assets: PositionAsset[]): PositionInput => ({
  assets: attachProceeds(assets, cfg),
  config: cfg,
});

// month-end balances as the monthly tabs give them: a salary remittance in March, a transfer that the tabs show leaving one bank in
// June and arriving at the other in July, and small differences of interest in between
const a = savings('a', [
  rec('2025-01-31', 1_000_000),
  rec('2025-02-28', 1_002_300),
  rec('2025-03-31', 2_504_700), // +15 lakh from outside
  rec('2025-04-30', 2_510_900),
  rec('2025-05-31', 2_517_200),
  rec('2025-06-30', 1_523_400), // 10 lakh left for the other bank
  rec('2025-07-31', 1_527_200),
]);
const b = savings('b', [
  rec('2025-01-31', 100_000),
  rec('2025-05-31', 101_000),
  rec('2025-06-30', 101_300),
  rec('2025-07-31', 1_101_500), // and arrived here a month later
]);
const position = input([a, b]);
const review = (moves: LedgerMove[] = [], minimum = 25_000) =>
  historyReview({
    ledger: capitalLedger({ position, moves, openingDate: '2025-01-31' }),
    position,
    minimum,
    pairMonths: 2,
    before: '2026-07-01',
    limit: 15,
  });

describe('historyReview: the earlier months to explain, largest first', () => {
  it('lists the month of the remittance with the holding that changed', () => {
    const r = review();
    expect(r.open).toHaveLength(1);
    const m = r.open[0]!;
    expect(m.key).toBe('2025-03');
    expect(m.amount).toBeGreaterThan(1_495_000);
    expect(m.amount).toBeLessThan(1_500_000);
    expect(m.changes[0]).toMatchObject({ assetId: 'a', name: 'a savings' });
    expect(m.changes[0]!.change).toBeGreaterThan(1_495_000);
    expect(r.listedTotal).toBeCloseTo(r.openTotal, 6);
  });

  it('sets apart a transfer the tabs show in two months: it cancels out, so there is nothing to answer', () => {
    const r = review();
    expect(r.cancelling).toHaveLength(1);
    expect(r.cancelling[0]!.first.key).toBe('2025-06');
    expect(r.cancelling[0]!.second.key).toBe('2025-07');
    expect(r.cancelling[0]!.first.amount + r.cancelling[0]!.second.amount).toBeCloseTo(0, -3);
  });

  it('leaves small differences out of the list, but counts them', () => {
    const r = review();
    expect(r.open.every((m) => Math.abs(m.amount) >= 25_000)).toBe(true);
    expect(r.small.count).toBeGreaterThanOrEqual(0);
  });

  it('an answer settles the month: confirmed outside money takes its place, and own money and profit do not change', () => {
    const before = capitalLedger({ position, moves: [], openingDate: '2025-01-31' });
    const moves: LedgerMove[] = [{ date: '2025-03-15', amount: 1_500_000, kind: 'external' }];
    const after = capitalLedger({ position, moves, openingDate: '2025-01-31' });
    expect(review(moves).open).toHaveLength(0);
    expect(after.totals.confirmedExternal).toBe(1_500_000);
    expect(after.totals.ownMoney).toBeCloseTo(before.totals.ownMoney, 0);
    expect(after.totals.profit).toBeCloseTo(before.totals.profit, 0);
  });

  it('earnings the app did not estimate move the sum from own money to profit', () => {
    const before = capitalLedger({ position, moves: [], openingDate: '2025-01-31' });
    const moves: LedgerMove[] = [{ date: '2025-03-31', amount: 50_000, kind: 'income' }];
    const after = capitalLedger({ position, moves, openingDate: '2025-01-31' });
    expect(after.totals.profit - before.totals.profit).toBeCloseTo(50_000, 0);
    expect(before.totals.ownMoney - after.totals.ownMoney).toBeCloseTo(50_000, 0);
    expect(after.totals.netWorth).toBeCloseTo(after.totals.ownMoney + after.totals.profit, 6);
  });

  it('leaves recent months to the recent list', () => {
    const r = historyReview({
      ledger: capitalLedger({ position, moves: [], openingDate: '2025-01-31' }),
      position,
      minimum: 25_000,
      pairMonths: 2,
      before: '2025-03-01',
      limit: 15,
    });
    expect(r.open).toHaveLength(0);
  });
});
