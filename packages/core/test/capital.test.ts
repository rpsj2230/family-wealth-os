import { describe, expect, it } from 'vitest';
import {
  capitalLedger,
  ledgerBetween,
  ledgerMoveOf,
  wealthMovement,
  yearByYear,
  fyStartYear,
  fyLabel,
  earnedPct,
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

describe('yearByYear: earned and saved for every financial year', () => {
  const old = fd('old', 1_000_000, '2025-04-01', '2026-04-01');
  const renewed = fd('new', 1_070_000, '2026-04-02', '2027-04-02');
  const l = capitalLedger({
    position: input([old, renewed]),
    moves: [],
    openingDate: '2025-04-01',
  });
  const years = yearByYear(l, TODAY);
  it('names the years, newest first, and marks the running one as partial', () => {
    expect(years.map((y) => y.label)).toEqual(['FY 2026–27', 'FY 2025–26']);
    expect(years[0]!.partial).toBe(true);
    // the records begin on 2 April, the day after the first deposit was booked: that year is not quite whole
    expect(years[1]!.from).toBe('2025-04-02');
    expect(years[1]!.partial).toBe(true);
    const later = yearByYear(l, '2027-06-01').find((y) => y.fy === 2026)!;
    expect(later.partial).toBe(false);
    expect(years[1]!.months).toHaveLength(12);
  });
  it('the running year matches Home (Earned this FY, Saved this FY) to the rupee', () => {
    const fy = wealthMovement(l, 'fy', TODAY).figures!;
    expect(years[0]!.earned).toBeCloseTo(fy.earnings.total, 6);
    expect(years[0]!.saved).toBeCloseTo(fy.moved, 6);
  });
  it('each year: end − start = earned + saved, and the years add up to the whole ledger', () => {
    for (const y of years) expect(y.end - y.start).toBeCloseTo(y.earned + y.saved, 6);
    const all = wealthMovement(l, 'all', TODAY).figures!;
    expect(years.reduce((a, y) => a + y.earned, 0)).toBeCloseTo(all.earnings.total, 6);
    expect(years.reduce((a, y) => a + y.saved, 0)).toBeCloseTo(all.moved, 6);
    expect(years[1]!.pct!).toBeGreaterThan(0.06);
  });
  it('financial-year helpers', () => {
    expect(fyStartYear('2026-10-31')).toBe(2026);
    expect(fyStartYear('2027-03-31')).toBe(2026);
    expect(fyStartYear('2027-04-01')).toBe(2027);
    expect(fyLabel(2029)).toBe('FY 2029–30');
    expect(fyLabel(2099)).toBe('FY 2099–00');
    // ₹1,00,000 at work all year plus ₹20,000 saved (half counted): ₹11,000 earned is 10%
    expect(earnedPct(100_000, 11_000, 20_000)).toBeCloseTo(0.1, 9);
    expect(earnedPct(0, 100, 0)).toBeNull();
  });
});

describe('capitalLedger: a tax harvest (sell, then buy the same fund back) is a reinvestment', () => {
  // 1,000 units at ₹100 bought on 1 Jan 2026; the price is ₹150 from February; all sold on 31 Mar, bought back on 2 Apr
  const navs: { date: string; nav: number }[] = [];
  for (let d = Date.parse('2025-12-25'); d <= Date.parse(TODAY); d += 3 * 86_400_000) {
    const date = new Date(d).toISOString().slice(0, 10);
    navs.push({ date, nav: date < '2026-02-01' ? 100 : 150 });
  }
  const harvested = (txnsExtra: { date: string; units: number; amount: number }[]) =>
    base({
      assetId: 'mf',
      type: 'mutual_fund',
      fund: {
        txns: [
          { date: '2026-01-01', units: 1000, amount: 100_000, estimated: false },
          ...txnsExtra.map((t) => ({ ...t, estimated: false })),
        ],
        navs,
        units: null,
        snapshots: [],
        // money put in and taken out, as the loader writes it from the same lines
        flows: [
          { date: '2026-01-01', amount: 100_000 },
          ...txnsExtra.map((x) => ({ date: x.date, amount: x.amount })),
        ],
        hasStatement: true,
        estimatedSince: null,
      },
    });
  const sellAndBuy = [
    { date: '2026-03-31', units: -1000, amount: -150_000 },
    { date: '2026-04-02', units: 1000, amount: 150_000 },
  ];
  const month = (l: ReturnType<typeof capitalLedger>, from: string) =>
    l.months.find((m) => m.from === from)!;

  it('the sale before the month end and the buy-back after it are neither money taken out nor brought in', () => {
    const l = capitalLedger({
      position: input([harvested(sellAndBuy)]),
      moves: [],
      openingDate: '2025-12-31',
    });
    expect(Math.round(month(l, '2026-03-01').unexplained)).toBe(0);
    expect(Math.round(month(l, '2026-04-01').unexplained)).toBe(0);
    // own money is the ₹1,00,000 put in on 1 January, and the yearly return is the same as without the harvest
    const plain = capitalLedger({
      position: input([harvested([])]),
      moves: [],
      openingDate: '2025-12-31',
    });
    expect(Math.round(l.totals.ownMoney)).toBe(Math.round(plain.totals.ownMoney));
    expect(l.totals.xirr.rate).toBeCloseTo(plain.totals.xirr.rate!, 6);
  });

  it('without the pairing the same harvest would read as money out in March and back in April', () => {
    const l = capitalLedger({
      position: input([harvested(sellAndBuy)]),
      moves: [],
      openingDate: '2025-12-31',
      reinvestDays: 1,
    });
    expect(Math.round(month(l, '2026-03-01').unexplained)).toBe(-150_000);
    expect(Math.round(month(l, '2026-04-01').unexplained)).toBe(150_000);
  });

  it('a savings balance recorded between the sale and the buy-back may hold the proceeds, so nothing is added then', () => {
    const bank = base({
      assetId: 'sav',
      type: 'bank_account',
      records: [rec('2025-12-31', 0), rec('2026-03-31', 150_000), rec('2026-04-03', 0)],
    });
    // sold on 28 March; the money is in the bank (and recorded) on 31 March; bought back on 2 April
    const early = [{ ...sellAndBuy[0]!, date: '2026-03-28' }, sellAndBuy[1]!];
    const l = capitalLedger({
      position: input([harvested(early), bank], cfg({ savingsRate: 0 })),
      moves: [],
      openingDate: '2025-12-31',
    });
    // the proceeds sat in the bank at the month end: still no money in or out in either month
    expect(Math.round(month(l, '2026-03-01').unexplained)).toBe(0);
    expect(Math.round(month(l, '2026-04-01').unexplained)).toBe(0);
  });
});
