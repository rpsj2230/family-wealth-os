import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import {
  avgCostPerUnit,
  cagr,
  concentration,
  estimateLots,
  foldShares,
  holdingProfile,
  realisedSummary,
  shareRows,
  singleInvestmentDate,
  statBlock,
  type StatFund,
} from '../src/fund-stats';

const TODAY = '2026-10-26';

const fund = (o: Partial<StatFund> & Pick<StatFund, 'assetId' | 'name'>): StatFund => ({
  ownerId: 'p1',
  value: 100_000,
  invested: 80_000,
  units: 1000,
  nav: 100,
  startedOn: '2023-01-05',
  sipMonthly: null,
  sipStopped: false,
  dayAmount: null,
  dayPct: null,
  folioLast4: null,
  category: { key: 'flexi', label: 'Flexi and multi cap', certain: true },
  amc: 'Alpha',
  taxClass: 'equity',
  hasStatement: true,
  txns: [],
  lots: [],
  lotsBasis: 'none',
  realised: [],
  ...o,
});

describe('shares', () => {
  const funds = [
    fund({ assetId: 'a', name: 'A', value: 600_000, invested: 400_000 }),
    fund({
      assetId: 'b',
      name: 'B',
      value: 300_000,
      invested: 330_000,
      category: { key: 'debt', label: 'Debt and liquid', certain: true },
      amc: 'Beta',
    }),
    fund({ assetId: 'c', name: 'C', value: 100_000, invested: 100_000, amc: null }),
    fund({ assetId: 'z', name: 'Zero', value: 0, invested: 5_000 }),
  ];
  it('groups value, money put in and gain, largest first, leaving out empty funds', () => {
    const rows = shareRows(funds, 'category');
    expect(rows.map((r) => r.key)).toEqual(['flexi', 'debt']);
    expect(rows[0]).toMatchObject({ value: 700_000, invested: 500_000, gain: 200_000, funds: 2 });
    expect(rows[0]!.share).toBeCloseTo(0.7, 6);
    expect(rows[0]!.gainPct).toBeCloseTo(0.4, 6);
    expect(rows[1]!.gain).toBe(-30_000);
    expect(shareRows(funds, 'amc').map((r) => r.label)).toEqual(['Alpha', 'Beta', 'AMC not known']);
  });
  it('folds the tail into Other so a ring stays readable', () => {
    const rows = shareRows(funds, 'fund');
    const folded = foldShares(rows, 2);
    expect(folded).toHaveLength(3);
    expect(folded[2]).toMatchObject({ key: '__other', value: 100_000, funds: 1 });
    expect(folded.reduce((a, r) => a + r.share, 0)).toBeCloseTo(1, 6);
    expect(foldShares(rows, 5)).toBe(rows);
  });
  it('measures how concentrated the money is', () => {
    const c = concentration(shareRows(funds, 'fund'), 2);
    expect(c.topShare).toBeCloseTo(0.9, 6);
    expect(c.top.map((t) => t.label)).toEqual(['A', 'B']);
    expect(c.effectiveFunds).toBeCloseTo(1 / (0.36 + 0.09 + 0.01), 4);
  });
});

describe('holdingProfile', () => {
  const lots = [
    { acquiredOn: '2024-01-10', units: 100, cost: 8_000 },
    { acquiredOn: '2025-12-10', units: 100, cost: 12_000 },
    { acquiredOn: '1900-01-01', units: 100, cost: null },
  ];
  it('splits value into long-term and short-term with the tax-rule period', () => {
    const p = holdingProfile({
      lots,
      basis: 'statement',
      value: 36_000,
      today: TODAY,
      holdingMonths: 12,
    });
    expect(p.longValue).toBe(24_000);
    expect(p.shortValue).toBe(12_000);
    expect(p.longShare).toBeCloseTo(2 / 3, 6);
    expect(p.longGain).toBe(4_000);
    expect(p.shortGain).toBe(0);
    expect(p.unknownCostValue).toBe(12_000);
    expect(p.nextTurn).toEqual({ on: '2026-12-11', value: 12_000 });
    expect(p.avgCost).toBeCloseTo(100, 6);
    expect(p.firstBought).toBe('2024-01-10');
  });
  it('a longer period moves value to short-term', () => {
    const p = holdingProfile({
      lots,
      basis: 'statement',
      value: 36_000,
      today: TODAY,
      holdingMonths: 36,
    });
    expect(p.longValue).toBe(12_000);
    expect(p.shortValue).toBe(24_000);
    // the last short-term lot turns long-term on this day, and then all of it is
    expect(p.nextTurn?.on).toBe('2027-01-11');
    expect(p.allLongOn).toBe('2028-12-11');
  });
  it('says when all of it is long-term only while some is not', () => {
    const p = holdingProfile({
      lots,
      basis: 'statement',
      value: 36_000,
      today: TODAY,
      holdingMonths: 12,
    });
    expect(p.allLongOn).toBe('2026-12-11');
    const old = holdingProfile({
      lots: lots.slice(0, 1),
      basis: 'statement',
      value: 12_000,
      today: TODAY,
      holdingMonths: 12,
    });
    expect(old.allLongOn).toBeNull();
  });
  it('has nothing to say without lots', () => {
    const p = holdingProfile({
      lots: [],
      basis: 'none',
      value: 1000,
      today: TODAY,
      holdingMonths: 12,
    });
    expect(p.basis).toBe('none');
    expect(p.longShare).toBeNull();
  });
});

describe('estimateLots', () => {
  const navs = [
    { date: '2026-06-01', nav: 100 },
    { date: '2026-07-01', nav: 125 },
    { date: '2026-08-01', nav: 100 },
  ];
  const plan = { invested: 30_000, startedOn: '2026-06-01', sipMonthly: 10_000, sipStopped: false };
  it('builds one estimated lot per instalment and scales them to the units held', () => {
    const lots = estimateLots({ plan, navs, today: '2026-08-15', unitsHeld: 270, navGapDays: 10 })!;
    expect(lots).toHaveLength(3);
    expect(lots.every((l) => l.estimated)).toBe(true);
    expect(lots.reduce((a, l) => a + l.units, 0)).toBeCloseTo(270, 6);
    expect(lots.reduce((a, l) => a + (l.cost ?? 0), 0)).toBeCloseTo(30_000, 6);
  });
  it('refuses to guess when a price is missing near an instalment', () => {
    expect(
      estimateLots({
        plan,
        navs: [navs[0]!],
        today: '2026-08-15',
        unitsHeld: null,
        navGapDays: 10,
      }),
    ).toBeNull();
    expect(
      estimateLots({ plan, navs: [], today: '2026-08-15', unitsHeld: null, navGapDays: 10 }),
    ).toBeNull();
  });
});

describe('realisedSummary', () => {
  const equity = fund({
    assetId: 'e',
    name: 'Equity',
    realised: [
      { soldOn: '2026-05-01', acquiredOn: '2025-01-01', units: 10, proceeds: 15_000, cost: 10_000 },
      { soldOn: '2026-05-01', acquiredOn: '2026-02-01', units: 10, proceeds: 9_000, cost: 10_000 },
      { soldOn: '2025-06-01', acquiredOn: '1900-01-01', units: 10, proceeds: 5_000, cost: 1_000 },
      { soldOn: '2025-06-01', acquiredOn: '2020-01-01', units: 10, proceeds: 5_000, cost: null },
    ],
  });
  const debt = fund({
    assetId: 'd',
    name: 'Debt',
    taxClass: 'debt_slab',
    realised: [
      { soldOn: '2026-05-01', acquiredOn: '2025-01-01', units: 10, proceeds: 11_000, cost: 10_000 },
    ],
  });
  it('splits equity gains by term, keeps other funds apart and counts unknown costs', () => {
    const r = realisedSummary([equity, debt], 12);
    expect(r.ltcg).toBe(5_000 + 4_000);
    expect(r.stcg).toBe(-1_000);
    expect(r.other).toBe(1_000);
    expect(r.unknownCost).toBe(1);
    expect(r.sales).toBe(5);
    expect(r.byYear.map((y) => y.fy)).toEqual(['2026-27', '2025-26']);
    expect(r.byYear[0]).toMatchObject({ ltcg: 5_000, stcg: -1_000, other: 1_000 });
    expect(r.byYear[1]).toMatchObject({ ltcg: 4_000 });
  });
  it('without a long-term rule nothing is called equity', () => {
    const r = realisedSummary([equity], null);
    expect(r.ltcg).toBe(0);
    expect(r.other).toBe(8_000);
  });
});

describe('statBlock', () => {
  const funds = [
    fund({
      assetId: 'a',
      name: 'Alpha Flexi',
      value: 600_000,
      invested: 400_000,
      folioLast4: '1111',
      sipMonthly: 10_000,
      dayPct: 0.01,
      dayAmount: 6_000,
      lots: [{ acquiredOn: '2024-01-10', units: 600, cost: 400_000 }],
      lotsBasis: 'statement',
      txns: [{ date: '2026-10-05', kind: 'sip', units: 10, amount: 10_000 }],
    }),
    fund({
      assetId: 'b',
      name: 'Beta Debt',
      taxClass: 'debt_slab',
      value: 300_000,
      invested: 330_000,
      folioLast4: '2222',
      dayPct: -0.002,
      dayAmount: -600,
      hasStatement: false,
    }),
    fund({
      assetId: 'c',
      name: 'Gamma Equity',
      value: 100_000,
      invested: 100_000,
      folioLast4: '1111',
      sipMonthly: 5_000,
      sipStopped: true,
      dayPct: 0.003,
      dayAmount: 300,
    }),
  ];
  const b = statBlock(funds, { today: TODAY, holdingMonths: 12, config: DEFAULT_CONFIG.funds });
  it('totals, gains and the best and worst fund', () => {
    expect(b.funds).toBe(3);
    expect(b.folios).toBe(2);
    expect(b.value).toBe(1_000_000);
    expect(b.invested).toBe(830_000);
    expect(b.unrealised).toBe(170_000);
    expect(b.unrealisedPct).toBeCloseTo(170_000 / 830_000, 6);
    expect(b.withStatement).toBe(2);
    expect(b.estimated).toBe(1);
    expect(b.best?.name).toBe('Alpha Flexi');
    expect(b.worst?.name).toBe('Beta Debt');
    expect(b.bestDay?.name).toBe('Alpha Flexi');
    expect(b.worstDay?.name).toBe('Beta Debt');
    expect(b.gainBars.map((g) => g.assetId)).toEqual(['a', 'c', 'b']);
  });
  it('concentration uses the configured count', () => {
    expect(b.concentration.top).toHaveLength(DEFAULT_CONFIG.funds.concentrationTop);
    expect(b.concentration.topShare).toBeCloseTo(1, 6);
  });
  it('holding: equity with lots is split, a fund with no lots and other kinds are kept apart', () => {
    expect(b.holding.longValue).toBe(600_000);
    expect(b.holding.shortValue).toBe(0);
    expect(b.holding.longShare).toBe(1);
    expect(b.holding.otherValue).toBe(300_000);
    expect(b.holding.unknownValue).toBe(100_000);
    expect(b.holding.fundsByBasis).toEqual({ statement: 1, estimated: 0, none: 1 });
  });
  it('SIP block: running, stopped, next instalment', () => {
    expect(b.sip.monthly).toBe(10_000);
    expect(b.sip.running).toBe(1);
    expect(b.sip.stopped).toBe(1);
    expect(b.sip.totalPaid).toBe(10_000);
    expect(b.sip.next).toMatchObject({ on: '2026-11-05', fund: 'Alpha Flexi', estimated: false });
  });
  it('one fund has no best and worst', () => {
    const one = statBlock([funds[0]!], {
      today: TODAY,
      holdingMonths: 12,
      config: DEFAULT_CONFIG.funds,
    });
    expect(one.best).toBeNull();
    expect(one.worst).toBeNull();
  });
});

describe('per fund helpers', () => {
  it('average cost needs units and money', () => {
    expect(avgCostPerUnit(50_000, 500)).toBe(100);
    expect(avgCostPerUnit(50_000, null)).toBeNull();
    expect(avgCostPerUnit(0, 10)).toBeNull();
  });
  it('CAGR waits for the minimum time and needs one date', () => {
    expect(
      cagr({ invested: 100, value: 121, from: '2024-10-26', today: TODAY, minMonths: 12 }),
    ).toBeCloseTo(0.1, 2);
    expect(
      cagr({ invested: 100, value: 121, from: '2026-05-26', today: TODAY, minMonths: 12 }),
    ).toBeNull();
    expect(
      singleInvestmentDate([
        { date: '2024-01-01', kind: 'purchase', units: 1, amount: 1 },
        { date: '2024-01-01', kind: 'purchase', units: 1, amount: 1 },
      ]),
    ).toBe('2024-01-01');
    expect(
      singleInvestmentDate([
        { date: '2024-01-01', kind: 'purchase', units: 1, amount: 1 },
        { date: '2024-02-01', kind: 'sip', units: 1, amount: 1 },
      ]),
    ).toBeNull();
  });
});
