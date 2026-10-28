import { describe, expect, it } from 'vitest';
import {
  capitalLedger,
  ledgerBetween,
  ledgerMoveOf,
  wealthMovement,
  type LedgerMove,
} from '../src/capital';
import { attachProceeds } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';

const TODAY = '2026-10-27';
const cfg = (over: Partial<PositionConfig> = {}): PositionConfig => ({
  today: TODAY,
  savingsRate: 0.04,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
  ...over,
});
const base = (
  o: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'r',
  status: 'active',
  name: o.assetId,
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  institutionId: 'bank',
  ...o,
});
const rec = (date: string, amount: number) => ({ date, amount, currency: 'INR', fxRate: null });
const fd = (id: string, principal: number, bookedOn: string, maturityOn: string, rate = 0.07) =>
  base({
    assetId: id,
    type: 'fixed_deposit',
    fd: {
      principal,
      rate,
      bookedOn,
      maturityOn,
      compounding: 'simple',
      bankMaturityAmount: null,
      endedOn: null,
    },
  });
const input = (assets: PositionAsset[], c = cfg()): PositionInput => ({
  assets: attachProceeds(assets, c),
  config: c,
});

describe('capitalLedger: acceptance test 2 (FD maturity and reinvestment)', () => {
  // ₹10,00,000 at 7% simple for a year earns ₹70,000; a new FD of ₹10,70,000 is opened with the proceeds
  const old = fd('old', 1_000_000, '2025-04-01', '2026-04-01');
  const renewed = fd('new', 1_070_000, '2026-04-02', '2027-04-02');
  const l = capitalLedger({
    position: input([old, renewed]),
    moves: [],
    openingDate: '2025-04-01',
  });

  it('keeps the new FD’s principal at ₹10,70,000 and the family’s own money at ₹10,00,000', () => {
    expect(renewed.fd!.principal).toBe(1_070_000);
    // the opening position is the deposit at the end of its first day (one night of interest on it)
    expect(l.totals.opening).toBeCloseTo(1_000_000 * (1 + 0.07 / 365), 4);
    expect(l.totals.ownMoney).toBeCloseTo(l.totals.opening, 0);
    expect(Math.abs(l.totals.unexplained)).toBeLessThan(1);
    expect(l.totals.confirmedExternal).toBe(0);
  });

  it('counts the ₹70,000 as earnings, not as money put in, and profit is net worth less own money', () => {
    const april = ledgerBetween(l, '2026-04-01', '2026-05-01')!;
    expect(april.unexplained).toBeCloseTo(0, 0);
    expect(l.totals.earnings.deposits).toBeGreaterThan(70_000);
    expect(l.totals.profit).toBeCloseTo(l.totals.netWorth - l.totals.ownMoney, 4);
    // net worth today is the new deposit alone: the old one's proceeds are never counted twice
    const newValue = 1_070_000 * (1 + (0.07 * 208) / 365);
    expect(l.totals.netWorth).toBeCloseTo(newValue, 0);
  });

  it('gives a yearly return close to the deposits’ rate (acceptance test 10)', () => {
    expect(l.totals.xirr.status).toBe('ok');
    expect(l.totals.xirr.rate!).toBeGreaterThan(0.065);
    expect(l.totals.xirr.rate!).toBeLessThan(0.075);
    expect(l.totals.profitPct).toBeCloseTo(l.totals.profit / l.totals.ownMoney, 10);
  });
});

describe('capitalLedger: acceptance test 3 (savings interest reinvested in an FD)', () => {
  const sav = base({
    assetId: 's',
    type: 'bank_account',
    records: [rec('2025-04-01', 1_000_000)],
    rate: { own: 0.04, listed: null, tds: null },
    // a confirmed transfer of 10.3 lakh from the account into the new deposit
    moves: [{ date: '2026-01-15', amount: -1_030_000 }],
  });
  const dep = fd('d', 1_030_000, '2026-01-15', '2027-01-15');
  const l = capitalLedger({ position: input([sav, dep]), moves: [], openingDate: '2025-04-01' });

  it('counts the interest once as earnings and leaves own money unchanged when it is reinvested', () => {
    expect(l.totals.ownMoney).toBeCloseTo(l.totals.opening, 0);
    expect(l.totals.opening).toBeLessThan(1_000_200);
    expect(Math.abs(l.totals.unexplained)).toBeLessThan(1);
    const january = ledgerBetween(l, '2026-01-01', '2026-02-01')!;
    // the transfer moved money between the family's own holdings: nothing came in or went out
    expect(Math.abs(january.moved)).toBeLessThan(1);
    expect(l.totals.earnings.savings).toBeGreaterThan(0);
    expect(l.totals.earnings.deposits).toBeGreaterThan(0);
    expect(l.totals.netWorth).toBeCloseTo(l.totals.ownMoney + l.totals.profit, 4);
  });
});

describe('capitalLedger: outside money (acceptance tests 9 and 12)', () => {
  const sav = (
    moves: { date: string; amount: number }[] = [],
    records = [rec('2025-04-01', 100_000)],
  ) =>
    base({
      assetId: 's',
      type: 'bank_account',
      records,
      rate: { own: 0.04, listed: null, tds: null },
      moves,
    });

  it('a confirmed salary transfer is own money put in, and never profit', () => {
    const moves: LedgerMove[] = [{ date: '2026-06-01', amount: 500_000, kind: 'external' }];
    const l = capitalLedger({
      position: input([sav([{ date: '2026-06-01', amount: 500_000 }])]),
      moves,
      openingDate: '2025-04-01',
    });
    expect(l.totals.confirmedExternal).toBe(500_000);
    expect(Math.abs(l.totals.unexplained)).toBeLessThan(1);
    expect(l.totals.ownMoney).toBeCloseTo(l.totals.opening + 500_000, 0);
    expect(l.totals.profit).toBeLessThan(30_000);
  });

  it('a jump in a balance that nobody explained is kept apart: not profit, not confirmed', () => {
    const l = capitalLedger({
      position: input([sav([], [rec('2025-04-01', 100_000), rec('2025-09-01', 600_000)])]),
      moves: [],
      openingDate: '2025-04-01',
    });
    // a balance is known from its own day: the jump falls in the stretch that ends with it
    const aug = ledgerBetween(l, '2025-08-01', '2025-09-01')!;
    expect(aug.unexplained).toBeGreaterThan(495_000);
    expect(aug.unexplained).toBeLessThan(500_000);
    expect(l.totals.unexplained).toBeCloseTo(aug.unexplained, 0);
    expect(l.totals.profit).toBeLessThan(40_000);
    expect(l.limitations.join(' ')).toMatch(/worked out from balances/);
  });

  it('a correction (the earlier balance was wrong) is own money, never profit, so net worth is still own money plus profit', () => {
    const records = [rec('2025-04-01', 100_000), rec('2025-09-01', 600_000)];
    const before = capitalLedger({
      position: input([sav([], records)]),
      moves: [],
      openingDate: '2025-04-01',
    });
    const l = capitalLedger({
      position: input([sav([], records)]),
      moves: [{ date: '2025-09-01', amount: 500_000, kind: 'correction' }],
      openingDate: '2025-04-01',
    });
    expect(l.totals.corrections).toBe(500_000);
    expect(l.totals.netWorth).toBeCloseTo(l.totals.ownMoney + l.totals.profit, 6);
    expect(l.totals.profit).toBeCloseTo(before.totals.profit, 6);
    expect(l.totals.ownMoney).toBeCloseTo(before.totals.ownMoney, 0);
  });

  it('does not show a per cent with no own money to measure it against', () => {
    const l = capitalLedger({ position: input([]), moves: [] });
    expect(l.opening).toBeNull();
    expect(l.totals.profitPct).toBeNull();
    expect(l.totals.xirr.rate).toBeNull();
  });
});

describe('ledgerMoveOf', () => {
  const m = (o: Partial<Parameters<typeof ledgerMoveOf>[0]>) =>
    ledgerMoveOf({
      movedOn: '2026-01-01',
      amount: 100,
      kind: 'contribution',
      fromAssetId: null,
      toAssetId: 'a',
      status: 'confirmed',
      ...o,
    });
  it('counts outside money in and out, income and costs, and nothing for a transfer between own holdings', () => {
    expect(m({})).toEqual({ date: '2026-01-01', amount: 100, kind: 'external' });
    expect(m({ kind: 'withdrawal', fromAssetId: 'a', toAssetId: null })).toMatchObject({
      amount: -100,
      kind: 'external',
    });
    expect(m({ kind: 'income' })).toMatchObject({ amount: 100, kind: 'income' });
    expect(m({ kind: 'fee', fromAssetId: 'a', toAssetId: null })).toMatchObject({
      amount: -100,
      kind: 'cost',
    });
    expect(m({ kind: 'fd_proceeds', fromAssetId: 'fd', toAssetId: 'a' })).toBeNull();
    expect(m({ status: 'suggested' })).toBeNull();
  });
});

describe('wealthMovement (acceptance test 11)', () => {
  const old = fd('old', 1_000_000, '2025-04-01', '2026-04-01');
  const renewed = fd('new', 1_070_000, '2026-04-02', '2027-04-02');
  const l = capitalLedger({
    position: input([old, renewed]),
    moves: [],
    openingDate: '2025-04-01',
  });
  it('splits a period into the money moved and what was earned, adding up to the change of net worth', () => {
    const fy = wealthMovement(l, 'fy', TODAY);
    expect(fy.from).toBe('2026-04-01');
    const f = fy.figures!;
    expect(f.end - f.start).toBeCloseTo(
      f.earnings.total + f.confirmedExternal + f.unexplained + f.corrections,
      6,
    );
    expect(Math.abs(f.unexplained)).toBeLessThan(1);
    expect(fy.twr!).toBeGreaterThan(0.03);
  });
  it('the months of a period add up to the period, and a period before the data starts says so', () => {
    const all = wealthMovement(l, 'all', TODAY);
    const parts = ['2025-04', '2026-03'].length;
    expect(parts).toBe(2);
    const a = wealthMovement(l, 'custom', TODAY, { from: '2025-04', to: '2026-03' }).figures!;
    const b = wealthMovement(l, 'custom', TODAY, { from: '2026-04', to: '2026-10' }).figures!;
    expect(a.earnings.total + b.earnings.total).toBeCloseTo(all.figures!.earnings.total, 6);
    expect(wealthMovement(l, 'custom', TODAY, { from: '2020-01', to: '2025-06' }).clamped).toBe(
      true,
    );
  });
});
