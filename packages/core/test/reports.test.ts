import { describe, expect, it } from 'vitest';
import { estimateFd } from '../src/estimate';
import {
  dayLabel,
  fdBreakdown,
  fdInterestByFy,
  fdSummary,
  fundAge,
  fundFlow,
  fundSummary,
  periodOf,
  sipTable,
  tableToCsv,
  type ReportFd,
  type ReportFund,
} from '../src/reports';

const fd = (o: Partial<ReportFd> & { id: string }): ReportFd => ({
  bank: 'Bank A',
  owner: 'Asha',
  kind: 'NRE',
  principal: 100_000,
  rate: 0.07,
  bookedOn: '2025-11-01',
  maturityOn: '2026-11-01',
  maturityAmount: 107_000,
  compounding: 'quarterly',
  ...o,
});

const FDS: ReportFd[] = [
  fd({ id: '1', maturityOn: '2026-11-01', maturityAmount: 110_000 }),
  fd({
    id: '2',
    maturityOn: '2026-11-01',
    principal: 200_000,
    maturityAmount: 230_000,
    bank: 'Bank B',
    owner: 'Ravi',
    rate: 0.075,
  }),
  fd({
    id: '3',
    maturityOn: '2027-03-15',
    bookedOn: '2024-03-15',
    principal: 50_000,
    maturityAmount: 60_000,
    rate: 0.08,
  }),
];

describe('period labels', () => {
  it('names dates, months, quarters, financial years and years', () => {
    expect(dayLabel('2026-09-23')).toBe('23 Sep 2026');
    expect(periodOf('2026-09-23', 'month')).toEqual({ key: '2026-09', label: 'Sep 2026' });
    expect(periodOf('2026-09-23', 'quarter').label).toBe('Jul–Sep 2026');
    expect(periodOf('2027-02-01', 'fy')).toEqual({ key: '2026-27', label: 'FY 2026-27' });
    expect(periodOf('2026-09-23', 'year').key).toBe('2026');
  });
});

describe('fdSummary', () => {
  it('adds deposits maturing on the same date and gives a grand total and a running total', () => {
    const t = fdSummary(FDS, { basis: 'maturity', period: 'date' });
    expect(t.rows.map((r) => r.period)).toEqual(['1 Nov 2026', '15 Mar 2027']);
    expect(t.rows[0]).toMatchObject({
      count: 2,
      principal: 300_000,
      maturity: 340_000,
      interest: 40_000,
      running: 340_000,
    });
    expect(t.rows[1]).toMatchObject({ running: 400_000 });
    expect(t.total).toMatchObject({
      period: 'Grand total',
      count: 3,
      principal: 350_000,
      maturity: 400_000,
      interest: 50_000,
    });
    expect(t.chart).toHaveLength(2);
  });
  it('groups by financial year, and by start date for the start summary', () => {
    const m = fdSummary(FDS, { basis: 'maturity', period: 'fy' });
    expect(m.rows.map((r) => r.period)).toEqual(['FY 2026-27']);
    const s = fdSummary(FDS, { basis: 'start', period: 'year' });
    expect(s.rows.map((r) => r.period)).toEqual(['2024', '2025']);
    expect(s.columns[0]!.label).toBe('Start date');
    expect(s.total).toMatchObject({ principal: 350_000 });
  });
});

describe('fdBreakdown', () => {
  it('weights the average rate by amount and ranks banks by amount', () => {
    const t = fdBreakdown(FDS, 'bank');
    expect(t.rows.map((r) => r.group)).toEqual(['Bank B', 'Bank A']);
    const a = t.rows.find((r) => r.group === 'Bank A')!;
    expect(a.rate).toBeCloseTo((100_000 * 0.07 + 50_000 * 0.08) / 150_000, 6);
    expect(a.share).toBeCloseTo(150_000 / 350_000, 6);
    expect(t.total).toMatchObject({ count: 3, share: 1 });
  });
  it('lists rates from high to low and terms from short to long', () => {
    expect(fdBreakdown(FDS, 'rate').rows.map((r) => r.group)).toEqual(['8.00%', '7.50%', '7.00%']);
    expect(fdBreakdown(FDS, 'tenure').rows.map((r) => r.group)).toEqual(['1 year', '3 years']);
  });
});

describe('fdInterestByFy', () => {
  it('splits a deposit across the financial years it runs in and adds back to its total interest', () => {
    const real = estimateFd({
      principal: 100_000,
      annualRate: 0.08,
      bookedOn: new Date('2026-01-01T00:00:00Z'),
      today: new Date('2026-10-26T00:00:00Z'),
      maturityOn: new Date('2027-07-01T00:00:00Z'),
    });
    const f = fd({
      id: 'x',
      rate: 0.08,
      bookedOn: '2026-01-01',
      maturityOn: '2027-07-01',
      principal: 100_000,
      maturityAmount: 100_000 + 12_000,
    });
    const t = fdInterestByFy([f], '2026-10-26');
    expect(t.rows.map((r) => r.fy)).toEqual(['FY 2025-26', 'FY 2026-27', 'FY 2027-28']);
    expect(t.rows.map((r) => r.basis)).toEqual([
      'earned',
      'part earned, part to come',
      'projected',
    ]);
    // three months, a full year, three months
    expect(Number(t.rows[1]!.total)).toBeGreaterThan(Number(t.rows[0]!.total) * 3);
    const all = Number(t.total!.total);
    expect(all).toBeGreaterThan(11_000);
    expect(all).toBeLessThan(13_000);
    expect(real).toBeTruthy();
  });
  it('has one column per person', () => {
    const t = fdInterestByFy(FDS, '2026-10-26');
    expect(t.columns.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Asha', 'Ravi', 'Total']),
    );
  });
});

const fund = (o: Partial<ReportFund> & { id: string }): ReportFund => ({
  name: `Fund ${o.id}`,
  owner: 'Asha',
  category: 'Small cap',
  amc: 'House X',
  value: 120_000,
  invested: 100_000,
  units: 1000,
  startedOn: '2025-01-05',
  xirr: 0.2,
  sipMonthly: 10_000,
  sipStopped: false,
  hasStatement: true,
  txns: [
    { date: '2025-01-05', kind: 'sip', units: 100, amount: 10_000 },
    { date: '2025-02-05', kind: 'sip', units: 90, amount: 10_000 },
    { date: '2025-03-10', kind: 'purchase', units: 500, amount: 50_000 },
    { date: '2026-01-10', kind: 'redeem', units: -50, amount: -6_000 },
  ],
  lots: [
    { acquiredOn: '2025-01-05', units: 100, cost: 10_000 },
    { acquiredOn: '2025-03-10', units: 500, cost: 50_000 },
    { acquiredOn: '2026-08-01', units: 400, cost: 40_000 },
  ],
  ...o,
});
const FUNDS = [
  fund({ id: 'A' }),
  fund({
    id: 'B',
    owner: 'Ravi',
    category: 'Flexi cap',
    amc: null,
    value: 80_000,
    invested: 90_000,
    xirr: -0.05,
    startedOn: '2025-02-20',
    sipMonthly: null,
    hasStatement: false,
    txns: [],
    lots: [],
  }),
];

describe('fundSummary', () => {
  it('groups by person with gain, gain %, value-weighted return and share', () => {
    const t = fundSummary(FUNDS, 'owner');
    expect(t.rows.map((r) => r.group)).toEqual(['Asha', 'Ravi']);
    expect(t.rows[0]).toMatchObject({ invested: 100_000, value: 120_000, gain: 20_000 });
    expect(t.rows[0]!.gainPct).toBeCloseTo(0.2, 6);
    expect(t.rows[1]!.gain).toBe(-10_000);
    expect(t.total).toMatchObject({ invested: 190_000, value: 200_000, gain: 10_000 });
    expect(t.total!.xirr).toBeCloseTo((120_000 * 0.2 + 80_000 * -0.05) / 200_000, 6);
    expect(t.rows[0]!.share).toBeCloseTo(0.6, 6);
  });
  it('lists funds with person and start date, and groups by start month', () => {
    const f = fundSummary(FUNDS, 'fund');
    expect(f.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['owner', 'started']));
    const s = fundSummary(FUNDS, 'start', 'month');
    expect(s.rows.map((r) => r.group)).toEqual(['Jan 2025', 'Feb 2025']);
    expect(s.chart).toHaveLength(2);
  });
  it('keeps a fund with no fund house or start date visible', () => {
    const t = fundSummary([fund({ id: 'C', amc: null, startedOn: null })], 'amc');
    expect(t.rows[0]!.group).toBe('Not known');
    expect(fundSummary([fund({ id: 'C', startedOn: null })], 'start').rows[0]!.group).toBe(
      'Start not known',
    );
  });
});

describe('sipTable', () => {
  it('shows running SIPs with what has been paid, and totals the monthly commitment', () => {
    const t = sipTable(FUNDS, '2026-10-26');
    expect(t.rows).toHaveLength(1);
    expect(t.rows[0]).toMatchObject({
      fund: 'Fund A',
      status: 'Running',
      monthly: 10_000,
      instalments: 2,
      paid: 20_000,
    });
    expect(t.rows[0]!.months).toBe(21);
    expect(t.total).toMatchObject({ monthly: 10_000, paid: 20_000 });
  });
  it('marks a stopped SIP and counts months to its last instalment', () => {
    const t = sipTable([fund({ id: 'S', sipStopped: true })], '2026-10-26');
    expect(t.rows[0]).toMatchObject({ status: 'Stopped', months: 1 });
    expect(t.total!.fund as string).toContain('0 running');
  });
});

describe('fundFlow', () => {
  it('splits money in into SIP and one-time buys, and money out, by month or financial year', () => {
    const m = fundFlow(FUNDS, 'month');
    expect(m.rows.map((r) => r.period)).toEqual(['Jan 2025', 'Feb 2025', 'Mar 2025', 'Jan 2026']);
    expect(m.rows[2]).toMatchObject({ lump: 50_000, sip: 0 });
    expect(m.rows[3]).toMatchObject({ out: 6_000, net: -6_000 });
    const y = fundFlow(FUNDS, 'fy');
    expect(y.rows.map((r) => r.period)).toEqual(['FY 2024-25', 'FY 2025-26']);
    expect(y.total).toMatchObject({ sip: 20_000, lump: 50_000, out: 6_000, net: 64_000 });
    expect(y.note).toContain('1 fund has none yet');
  });
});

describe('fundAge', () => {
  it('values the units by how long they have been held, with the long-term period from the rules', () => {
    const t = fundAge([fund({ id: 'A' })], '2026-10-26', 12);
    expect(t.columns.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Under 1 year', '1 year or more']),
    );
    const row = t.rows[0]!;
    // 1000 units are worth 120,000: 400 bought 3 months ago, 600 bought about 20 months ago
    expect(row.b0).toBeCloseTo(48_000, 0);
    expect(row.bl).toBeCloseTo(72_000, 0);
    expect(row.total).toBe(120_000);
  });
});

describe('tableToCsv', () => {
  it('writes plain numbers, percentages and quotes, with the grand total last', () => {
    const csv = tableToCsv(fdBreakdown(FDS, 'bank'));
    const lines = csv.split('\n');
    expect(lines[0]).toContain('Avg rate (%)');
    expect(lines[lines.length - 1]).toContain('Grand total');
    expect(lines[1]).toContain('Bank B,1,200000,230000,30000,7.50,57.14');
  });
});
