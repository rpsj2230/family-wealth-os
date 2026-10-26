import { describe, expect, it } from 'vitest';
import {
  chartDates,
  clipSeries,
  downsample,
  monthlyContributions,
  navChart,
  parseRange,
  periodChange,
  rangeStart,
  returnSeries,
  sipCalendar,
  sipSummary,
  unitsOverTime,
  xirrOverTime,
} from '../src/fund-timeline';

const sip = (date: string, amount = 10_000) => ({ date, kind: 'sip', units: amount / 100, amount });

describe('ranges', () => {
  it('reads the address value and falls back safely', () => {
    expect(parseRange('1y')).toBe('1y');
    expect(parseRange('forever')).toBe('all');
    expect(parseRange(undefined, '6m')).toBe('6m');
  });
  it('starts a range that many months back, and All has no start', () => {
    expect(rangeStart('6m', '2026-10-26')).toBe('2026-04-26');
    expect(rangeStart('3y', '2026-10-26')).toBe('2023-10-26');
    expect(rangeStart('all', '2026-10-26')).toBeNull();
  });
  it('draws days for a month, weeks for a year and month ends beyond', () => {
    const d1 = chartDates('1m', '2020-01-01', '2026-10-26');
    expect(d1[0]).toBe('2026-09-26');
    expect(d1[d1.length - 1]).toBe('2026-10-26');
    expect(d1).toHaveLength(31);
    const d2 = chartDates('1y', '2020-01-01', '2026-10-26');
    expect(d2[d2.length - 1]).toBe('2026-10-26');
    expect(d2.length).toBeGreaterThan(50);
    const d3 = chartDates('all', '2025-08-10', '2026-10-26');
    expect(d3[0]).toBe('2025-08-31');
    expect(d3[d3.length - 1]).toBe('2026-10-26');
  });
  it('clips a series to the range plus the point before it, and notes a late start', () => {
    const pts = ['2026-05-31', '2026-08-31', '2026-09-30', '2026-10-26'].map((date) => ({
      date,
      value: 1,
      invested: 1,
    }));
    const c = clipSeries(pts, '1m', '2026-10-26');
    expect(c.points.map((p) => p.date)).toEqual(['2026-08-31', '2026-09-30', '2026-10-26']);
    expect(c.startsLate).toBe(false);
    expect(clipSeries(pts, '3y', '2026-10-26').startsLate).toBe(true);
    expect(clipSeries(pts, 'all', '2026-10-26').points).toHaveLength(4);
  });
});

describe('periodChange', () => {
  it('separates market gain from new money', () => {
    const c = periodChange([
      { date: '2026-04-26', value: 100_000, invested: 90_000 },
      { date: '2026-10-26', value: 140_000, invested: 120_000 },
    ])!;
    expect(c.netIn).toBe(30_000);
    expect(c.gain).toBe(10_000);
    expect(c.returnPct).toBeCloseTo(10_000 / (100_000 + 15_000), 6);
  });
  it('does not guess when the money put in is not known', () => {
    const c = periodChange([
      { date: '2026-04-26', value: 100_000, invested: null },
      { date: '2026-10-26', value: 140_000, invested: 120_000 },
    ])!;
    expect(c.gain).toBeNull();
    expect(c.returnPct).toBeNull();
    expect(periodChange([{ date: 'x', value: 1, invested: 1 }])).toBeNull();
  });
});

describe('returnSeries', () => {
  it('is the gain over the money put in, skipping unknown or zero cost', () => {
    const r = returnSeries([
      { date: 'a', value: 100, invested: null },
      { date: 'b', value: 100, invested: 0 },
      { date: 'c', value: 120, invested: 100 },
    ]);
    expect(r).toEqual([{ date: 'c', value: 0.2 }]);
  });
});

describe('xirrOverTime', () => {
  it('waits for the minimum span and solves from the transactions up to each date', () => {
    const txns = [
      { date: '2024-01-01', units: 100, amount: 10_000 },
      { date: '2025-01-01', units: 100, amount: 10_000 },
    ];
    const series = [
      { date: '2024-07-01', value: 10_500 },
      { date: '2025-07-01', value: 24_000 },
    ];
    const r = xirrOverTime({
      funds: [{ txns, series }],
      dates: ['2024-07-01', '2025-07-01'],
      minMonths: 12,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.date).toBe('2025-07-01');
    expect(r[0]!.value).toBeGreaterThan(0.1);
    expect(r[0]!.value).toBeLessThan(0.5);
  });
  it('is empty without transactions', () => {
    expect(
      xirrOverTime({ funds: [{ txns: [], series: [] }], dates: ['2025-01-01'], minMonths: 1 }),
    ).toEqual([]);
  });
});

describe('monthlyContributions', () => {
  it('splits instalments, one-off money, moved units and sales into the last months', () => {
    const rows = monthlyContributions(
      [
        sip('2026-10-05'),
        sip('2026-09-05'),
        { date: '2026-09-10', kind: 'purchase', units: 10, amount: 5000 },
        { date: '2026-08-01', kind: 'switch_in', units: 10, amount: 2000 },
        { date: '2026-10-12', kind: 'redeem', units: -5, amount: -3000 },
        { date: '2025-01-01', kind: 'purchase', units: 1, amount: 99 },
      ],
      '2026-10-26',
      3,
    );
    expect(rows.map((r) => r.month)).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(rows[0]).toMatchObject({ moved: 2000, sip: 0 });
    expect(rows[1]).toMatchObject({ sip: 10_000, lump: 5000 });
    expect(rows[2]).toMatchObject({ sip: 10_000, out: 3000 });
  });
});

describe('SIP summary and calendar', () => {
  const base = {
    sipMonthly: 10_000,
    sipStopped: false,
    startedOn: '2026-01-05',
    today: '2026-10-26',
  };
  it('counts instalments from the statement and finds the next date', () => {
    const txns = ['2026-01-05', '2026-02-05', '2026-03-05', '2026-05-05'].map((d) => sip(d));
    const s = sipSummary({ ...base, txns });
    expect(s.basis).toBe('statement');
    expect(s.instalments).toBe(4);
    expect(s.totalPaid).toBe(40_000);
    expect(s.monthsRunning).toBe(9);
    expect(s.nextOn).toBe('2026-11-05');
  });
  it('uses the plan when there is no statement, and says so', () => {
    const s = sipSummary({ ...base, txns: [] });
    expect(s.basis).toBe('plan');
    expect(s.totalPaid).toBeNull();
    expect(s.instalments).toBeNull();
    expect(s.nextOn).toBe('2026-11-05');
  });
  it('a stopped SIP has no next date and stops counting at the last instalment', () => {
    const s = sipSummary({
      ...base,
      sipStopped: true,
      txns: [sip('2026-01-05'), sip('2026-03-05')],
    });
    expect(s.active).toBe(false);
    expect(s.stopped).toBe(true);
    expect(s.nextOn).toBeNull();
    expect(s.monthsRunning).toBe(2);
  });
  it('no SIP at all', () => {
    const s = sipSummary({ ...base, sipMonthly: null, txns: [] });
    expect(s.basis).toBe('none');
    expect(s.active).toBe(false);
    expect(s.nextOn).toBeNull();
  });
  it('marks paid, missed and pending months', () => {
    const txns = ['2026-06-05', '2026-07-05', '2026-09-05'].map((d) => sip(d));
    const cal = sipCalendar({ ...base, startedOn: '2026-06-05', txns }, 6);
    expect(cal.cells.map((c) => c.state)).toEqual([
      'idle', // May: before the SIP began
      'paid',
      'paid',
      'missed',
      'paid',
      'pending',
    ]);
    expect(cal.paid).toBe(3);
    expect(cal.missed).toBe(1);
  });
  it('marks planned months when only the plan is known', () => {
    const cal = sipCalendar({ ...base, startedOn: '2026-08-05', txns: [] }, 4);
    expect(cal.basis).toBe('plan');
    expect(cal.cells.map((c) => c.state)).toEqual(['idle', 'planned', 'planned', 'planned']);
  });
});

describe('navChart and units', () => {
  const navs = [
    { date: '2026-01-01', nav: 100 },
    { date: '2026-02-01', nav: 110 },
    { date: '2026-03-01', nav: 105 },
  ];
  it('puts a dot at the price paid, or the line price that day when the statement has none', () => {
    const m = navChart({
      navs,
      txns: [
        { date: '2026-02-01', kind: 'sip', units: 10, amount: 1100, nav: 108 },
        { date: '2026-03-01', kind: 'purchase', units: 10, amount: 1050 },
        { date: '2026-03-01', kind: 'redeem', units: -5, amount: -520, nav: 104 },
      ],
      avgCost: 104,
      from: null,
      maxPoints: 100,
    });
    expect(m.buys.map((b) => b.nav)).toEqual([108, 105]);
    expect(m.sells.map((b) => b.nav)).toEqual([104]);
    expect(m.avgCost).toBe(104);
    expect(m.latest?.nav).toBe(105);
  });
  it('downsamples keeping both ends', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const d = downsample(pts, 50);
    expect(d).toHaveLength(50);
    expect(d[0]).toBe(0);
    expect(d[49]).toBe(999);
    expect(downsample([1, 2, 3], 50)).toEqual([1, 2, 3]);
  });
  it('follows the statement balance, otherwise adds up', () => {
    expect(
      unitsOverTime([
        { date: '2026-01-01', units: 10, balance: 110 },
        { date: '2026-02-01', units: -20, balance: 90 },
      ]),
    ).toEqual([
      { date: '2026-01-01', value: 110 },
      { date: '2026-02-01', value: 90 },
    ]);
    expect(
      unitsOverTime([
        { date: '2026-01-01', units: 10 },
        { date: '2026-01-01', units: 5 },
        { date: '2026-02-01', units: -3 },
      ]),
    ).toEqual([
      { date: '2026-01-01', value: 15 },
      { date: '2026-02-01', value: 12 },
    ]);
  });
});
