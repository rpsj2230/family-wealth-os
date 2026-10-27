import { describe, expect, it } from 'vitest';
import {
  parseGranularity,
  parseValuationRange,
  pickPeriods,
  periodsFor,
  positionConfig,
  signedRupees,
  signedShare,
  valuationCsvRows,
  valuationHistory,
  weekStartOn,
  DEFAULT_CONFIG,
  type PosFund,
  type PositionAsset,
  type PositionInput,
} from '../src';

const TODAY = '2026-10-27'; // a Tuesday

describe('weeks', () => {
  it('run Monday to Sunday and are labelled by their Monday', () => {
    expect(weekStartOn('2026-10-05')).toBe('2026-10-05'); // a Monday
    expect(weekStartOn('2026-10-11')).toBe('2026-10-05'); // the Sunday that ends it
    expect(weekStartOn('2026-10-12')).toBe('2026-10-12');
    const p = periodsFor('week', '2026-10-01', TODAY);
    expect(p.map((x) => x.label)).toEqual([
      'Week of 28 Sep 2026',
      'Week of 5 Oct 2026',
      'Week of 12 Oct 2026',
      'Week of 19 Oct 2026',
      'Week of 26 Oct 2026 (to date)',
    ]);
    expect(p[1]).toMatchObject({ start: '2026-10-05', end: '2026-10-11', through: '2026-10-11' });
  });
  it('a week can cross the new year and the leap day', () => {
    expect(weekStartOn('2021-01-03')).toBe('2020-12-28');
    expect(weekStartOn('2026-12-31')).toBe('2026-12-28');
    const p = periodsFor('week', '2026-12-30', '2027-01-06');
    expect(p[0]).toMatchObject({ start: '2026-12-28', end: '2027-01-03' });
    expect(weekStartOn('2028-02-29')).toBe('2028-02-28');
    expect(periodsFor('week', '2028-02-27', '2028-03-08')[1]).toMatchObject({
      start: '2028-02-28',
      end: '2028-03-05',
    });
  });
});

describe('months', () => {
  it('cut the first month where the records begin and the last at today, which says "to date"', () => {
    const p = periodsFor('month', '2026-08-15', TODAY);
    expect(p.map((x) => x.label)).toEqual(['Aug 2026', 'Sep 2026', 'Oct 2026 (to date)']);
    expect(p[0]).toMatchObject({
      start: '2026-08-01',
      from: '2026-08-15',
      through: '2026-08-31',
      startsInside: true,
    });
    expect(p[1]).toMatchObject({
      start: '2026-09-01',
      from: '2026-09-01',
      through: '2026-09-30',
      startsInside: false,
    });
    expect(p[2]).toMatchObject({ end: '2026-10-31', through: TODAY, toDate: true });
  });
  it('February ends on the 29th in a leap year', () => {
    const p = periodsFor('month', '2028-01-20', '2028-03-10');
    expect(p[1]).toMatchObject({ label: 'Feb 2028', end: '2028-02-29' });
    expect(periodsFor('month', '2027-02-02', '2027-03-10')[0]!.end).toBe('2027-02-28');
  });
  it('a month with a first day of data on the last day of the month is still that month', () => {
    const p = periodsFor('month', '2026-07-31', '2026-09-02');
    expect(p.map((x) => x.label)).toEqual(['Jul 2026', 'Aug 2026', 'Sep 2026 (to date)']);
    expect(p[0]!.from).toBe('2026-07-31');
  });
});

describe('quarters', () => {
  it('follow the financial year: April to June is Q1, and 31 March is the last day of Q4', () => {
    const p = periodsFor('quarter', '2026-02-10', TODAY, true);
    expect(p.map((x) => x.label)).toEqual([
      'Q4 FY 2025-26',
      'Q1 FY 2026-27',
      'Q2 FY 2026-27',
      'Q3 FY 2026-27 (to date)',
    ]);
    expect(p[0]).toMatchObject({ start: '2026-01-01', end: '2026-03-31', from: '2026-02-10' });
    expect(p[1]).toMatchObject({ start: '2026-04-01', end: '2026-06-30', sub: 'Apr to Jun 2026' });
    expect(periodsFor('quarter', '2026-03-31', '2026-04-01')[0]!.label).toBe('Q4 FY 2025-26');
    expect(periodsFor('quarter', '2026-04-01', '2026-04-01')[0]!.label).toBe(
      'Q1 FY 2026-27 (to date)',
    );
  });
  it('can follow the calendar instead: January to March is Q1', () => {
    const p = periodsFor('quarter', '2026-02-10', TODAY, false);
    expect(p.map((x) => x.label)).toEqual(['Q1 2026', 'Q2 2026', 'Q3 2026', 'Q4 2026 (to date)']);
    // the quarters begin on the same days either way
    expect(p.map((x) => x.start)).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
  });
});

describe('years', () => {
  it('are financial years from 1 April', () => {
    const p = periodsFor('year', '2024-09-15', TODAY);
    expect(p.map((x) => x.label)).toEqual(['FY 2024-25', 'FY 2025-26', 'FY 2026-27 (to date)']);
    expect(p[0]).toMatchObject({
      start: '2024-04-01',
      end: '2025-03-31',
      from: '2024-09-15',
      startsInside: true,
    });
    expect(p[2]).toMatchObject({ start: '2026-04-01', through: TODAY });
    expect(periodsFor('year', '2026-03-31', '2026-04-01').map((x) => x.label)).toEqual([
      'FY 2025-26',
      'FY 2026-27 (to date)',
    ]);
  });
});

describe('the range', () => {
  const all = periodsFor('month', '2020-01-15', TODAY);
  it('shows the last N periods, twice that, all of them, or those between two dates', () => {
    expect(pickPeriods(all, { kind: 'recent' }, 12)).toHaveLength(12);
    expect(pickPeriods(all, { kind: 'double' }, 12)).toHaveLength(24);
    expect(pickPeriods(all, { kind: 'all' }, 12)).toHaveLength(all.length);
    const between = pickPeriods(all, { kind: 'between', from: '2025-03-10', to: '2025-05-02' }, 12);
    expect(between.map((x) => x.label)).toEqual(['Mar 2025', 'Apr 2025', 'May 2025']);
    expect(
      pickPeriods(periodsFor('month', '2026-09-01', TODAY), { kind: 'recent' }, 12),
    ).toHaveLength(2);
  });
  it('reads the address, ignoring dates that are not dates', () => {
    expect(parseValuationRange(undefined, undefined, undefined)).toEqual({ kind: 'recent' });
    expect(parseValuationRange('double', undefined, undefined)).toEqual({ kind: 'double' });
    expect(parseValuationRange('all', undefined, undefined)).toEqual({ kind: 'all' });
    expect(parseValuationRange('all', '2026-01-01', '2026-03-31')).toEqual({
      kind: 'between',
      from: '2026-01-01',
      to: '2026-03-31',
    });
    expect(parseValuationRange(undefined, '2026-02-30', '2026-03-31')).toEqual({ kind: 'recent' });
    expect(parseValuationRange(undefined, '2026-04-01', '2026-03-31')).toEqual({ kind: 'recent' });
    expect(parseGranularity('quarter')).toBe('quarter');
    expect(parseGranularity('decade')).toBe('month');
  });
});

// ------------------------------------------------------------------------------------------------
const fund = (over: Partial<PosFund>): PosFund => ({
  txns: [],
  navs: [],
  units: null,
  snapshots: [],
  flows: [],
  hasStatement: true,
  estimatedSince: null,
  ...over,
});
const asset = (id: string, owner: string, f: PosFund): PositionAsset => ({
  assetId: id,
  ownerId: owner,
  type: 'mutual_fund',
  status: 'active',
  name: id,
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: [],
  fd: null,
  fund: f,
});
const nav = (date: string, n: number) => ({ date, nav: n });
const input = (assets: PositionAsset[], current?: Record<string, number>): PositionInput => ({
  assets,
  config: positionConfig(DEFAULT_CONFIG, TODAY),
  ...(current
    ? {
        current: Object.fromEntries(
          Object.entries(current).map(([k, v]) => [k, { value: v, counted: true }]),
        ),
      }
    : {}),
});
const args = (position: PositionInput, over: object = {}) => ({
  position,
  granularity: 'month' as const,
  range: { kind: 'all' as const },
  owner: null,
  recent: 12,
  financialQuarters: true,
  ...over,
});

describe('portfolio value by period', () => {
  // 100 units bought on 10 Aug at 100; 50 more on 15 Sep at 120 (6,000 of new money); prices every few days
  const f = fund({
    txns: [
      { date: '2026-08-10', units: 100, amount: 10_000, estimated: false },
      { date: '2026-09-15', units: 50, amount: 6_000, estimated: false },
    ],
    flows: [
      { date: '2026-08-10', amount: 10_000 },
      { date: '2026-09-15', amount: 6_000 },
    ],
    navs: [
      nav('2026-08-10', 100),
      nav('2026-08-31', 110),
      nav('2026-09-15', 120),
      nav('2026-09-30', 130),
      nav('2026-10-20', 140),
    ],
  });
  const a = asset('f1', 'o1', f);
  const h = valuationHistory(args(input([a], { f1: 150 * 140 })));

  it('values every period end from units times the price on or before it', () => {
    expect(h.rows.map((r) => r.period.label)).toEqual([
      'Aug 2026',
      'Sep 2026',
      'Oct 2026 (to date)',
    ]);
    expect(h.rows.map((r) => r.value)).toEqual([100 * 110, 150 * 130, 150 * 140]);
    expect(h.firstDate).toBe('2026-08-10');
  });

  it('the plain change counts new money; the gain does not', () => {
    const [aug, sep, oct] = h.rows;
    // August is the first period: there is no earlier value to compare with, and the gain is on the 10,000 put in
    expect(aug!.change).toBeNull();
    expect(aug!.netIn).toBe(10_000);
    expect(aug!.gain).toBeCloseTo(11_000 - 10_000, 4);
    // September: the value rose by 19,500 − 11,000 = 8,500, of which 6,000 was bought
    expect(sep!.change).toBeCloseTo(8_500, 4);
    expect(sep!.changePct).toBeCloseTo(8_500 / 11_000, 6);
    expect(sep!.netIn).toBe(6_000);
    expect(sep!.gain).toBeCloseTo(2_500, 4);
    expect(sep!.gainPct).toBeGreaterThan(0);
    expect(sep!.gainPct!).toBeLessThan(sep!.changePct!);
    // October, to date: no purchase, so the change and the gain are the same
    expect(oct!.change).toBeCloseTo(1_500, 4);
    expect(oct!.netIn).toBe(0);
    expect(oct!.gain).toBeCloseTo(1_500, 4);
    expect(oct!.period.toDate).toBe(true);
    expect(oct!.period.through).toBe(TODAY);
  });

  it('a sale is money taken out: it lowers the value but is no loss', () => {
    const sold = fund({
      txns: [
        { date: '2026-08-10', units: 100, amount: 10_000, estimated: false },
        { date: '2026-09-10', units: -40, amount: -4_400, estimated: false },
      ],
      flows: [
        { date: '2026-08-10', amount: 10_000 },
        { date: '2026-09-10', amount: -4_400 },
      ],
      navs: [
        nav('2026-08-10', 100),
        nav('2026-08-31', 110),
        nav('2026-09-30', 110),
        nav('2026-10-25', 110),
      ],
    });
    const r = valuationHistory(args(input([asset('f1', 'o1', sold)], { f1: 60 * 110 }))).rows[1]!;
    expect(r.change).toBeCloseTo(60 * 110 - 100 * 110, 4);
    expect(r.netIn).toBe(-4_400);
    expect(r.gain).toBeCloseTo(0, 4);
  });

  it('a period with no price and no record says no data, not zero', () => {
    const thin = fund({
      txns: [{ date: '2026-08-10', units: 100, amount: 10_000, estimated: false }],
      flows: [{ date: '2026-08-10', amount: 10_000 }],
      navs: [nav('2026-08-10', 100), nav('2026-08-31', 110)],
    });
    const r = valuationHistory(args(input([asset('f1', 'o1', thin)], { f1: 11_500 })));
    const sep = r.rows[1]!;
    expect(sep.value).toBeNull();
    expect(sep.gain).toBeNull();
    expect(sep.change).toBeNull();
    expect(signedRupees(sep.value)).toBe('no data');
    // the period after it still has its own value, and its change is not made up against the gap
    expect(r.rows[2]!.value).toBe(11_500);
    expect(r.rows[2]!.change).toBeNull();
    const csv = valuationCsvRows(r);
    expect(csv[0]![0]).toBe('Period');
    expect(csv[2]).toEqual([
      'Sep 2026',
      '2026-09-01',
      '2026-09-30',
      '',
      '',
      '',
      '',
      '',
      '',
      'no data',
    ]);
  });

  it('only the chosen person’s funds, and nothing for a person with none', () => {
    const b = asset(
      'f2',
      'o2',
      fund({
        txns: [{ date: '2026-09-01', units: 10, amount: 1_000, estimated: false }],
        flows: [{ date: '2026-09-01', amount: 1_000 }],
        navs: [nav('2026-09-01', 100), nav('2026-09-30', 100)],
      }),
    );
    const both = input([a, b], { f1: 21_000, f2: 1_000 });
    const mine = valuationHistory(args(both, { owner: 'o2' }));
    expect(mine.rows.map((r) => r.value)).toEqual([1_000, 1_000]);
    expect(mine.firstDate).toBe('2026-09-01');
    expect(valuationHistory(args(both, { owner: 'nobody' })).rows).toEqual([]);
    const together = valuationHistory(args(both));
    expect(together.rows[1]!.value).toBe(150 * 130 + 1_000);
  });

  it('weeks, quarters and years come from the same values', () => {
    const q = valuationHistory(args(input([a], { f1: 21_000 }), { granularity: 'quarter' }));
    expect(q.rows.map((r) => r.period.label)).toEqual(['Q2 FY 2026-27', 'Q3 FY 2026-27 (to date)']);
    expect(q.rows[0]!.value).toBe(150 * 130);
    expect(q.rows[0]!.netIn).toBe(16_000);
    const y = valuationHistory(args(input([a], { f1: 21_000 }), { granularity: 'year' }));
    expect(y.rows).toHaveLength(1);
    expect(y.rows[0]!.gain).toBeCloseTo(21_000 - 16_000, 4);
    const w = valuationHistory(
      args(input([a], { f1: 21_000 }), { granularity: 'week', range: { kind: 'recent' } }),
    );
    expect(w.rows).toHaveLength(12);
    expect(w.rows.at(-1)!.period.label).toBe('Week of 26 Oct 2026 (to date)');
    expect(w.total).toBe(12);
  });

  it('marks a value that rests on a record moved forward as estimated', () => {
    const rec = asset(
      'f3',
      'o1',
      fund({
        navs: [nav('2026-08-30', 100), nav('2026-09-29', 110)],
        hasStatement: false,
        estimatedSince: '2026-08-01',
      }),
    );
    rec.records = [{ date: '2026-08-31', amount: 10_000, currency: 'INR', fxRate: null }];
    const r = valuationHistory(args(input([rec], { f3: 11_000 })));
    expect(r.rows[1]!.value).toBeCloseTo(11_000, 4);
    expect(r.rows[1]!.estimated).toBe(true);
    expect(valuationCsvRows(r)[2]![9]).toBe('estimated');
  });
});

describe('words', () => {
  it('signs money with Indian grouping and a real minus', () => {
    expect(signedRupees(1234567)).toBe('+₹12,34,567');
    expect(signedRupees(-4500)).toBe('−₹4,500');
    expect(signedRupees(0)).toBe('₹0');
    expect(signedShare(-0.0123)).toBe('−1.23%');
    expect(signedShare(null)).toBe('–');
  });
});
