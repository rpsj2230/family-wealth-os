import { describe, expect, it } from 'vitest';
import {
  CENTRE_TEMPLATES,
  appliedFilters,
  fdInterestWithin,
  fundOption,
  fundPlan,
  isIndexFund,
  paramsToQuery,
  queryToParams,
  runReport,
  type CentreInput,
  type CentreQuery,
} from '../src/report-centre';
import { fdValueOn } from '../src/fd';

const today = '2026-10-29';

const input = (): CentreInput => ({
  today,
  first: '2020-01-01',
  people: { a: 'Asha', b: 'Bala' },
  holdings: [
    {
      id: 'c1',
      name: 'Cash-NRE-1',
      ownerId: 'a',
      cls: 'cash',
      type: 'bank_account',
      bank: 'Alpha Bank',
      currency: 'INR',
      value: 300_000,
      native: null,
      cost: null,
      asOf: '2026-10-20',
      estimated: true,
      stale: false,
    },
    {
      id: 'c2',
      name: 'Cash SGD',
      ownerId: 'b',
      cls: 'cash',
      type: 'bank_account',
      bank: 'Beta Bank',
      currency: 'SGD',
      value: 65_000,
      native: 1_000,
      cost: null,
      asOf: '2026-10-01',
      estimated: false,
      stale: true,
    },
    {
      id: 'f1',
      name: 'FD-1',
      ownerId: 'a',
      cls: 'fd',
      type: 'fixed_deposit',
      bank: 'Alpha Bank',
      currency: 'INR',
      value: 520_000,
      native: null,
      cost: 500_000,
      asOf: today,
      estimated: true,
      stale: false,
    },
    {
      id: 'm1',
      name: 'Alpha Flexi Cap Direct Growth',
      ownerId: 'b',
      cls: 'funds',
      type: 'mutual_fund',
      bank: null,
      currency: 'INR',
      value: 240_000,
      native: null,
      cost: 200_000,
      asOf: today,
      estimated: false,
      stale: false,
    },
  ],
  deposits: [
    {
      id: 'f1',
      name: 'FD-1',
      bank: 'Alpha Bank',
      ownerId: 'a',
      principal: 500_000,
      rate: 0.07,
      bookedOn: '2025-10-29',
      maturityOn: '2027-10-29',
      maturityAmount: 574_000,
      compounding: 'quarterly',
      running: true,
    },
    {
      id: 'f2',
      name: 'FD-2',
      bank: 'Beta Bank',
      ownerId: 'b',
      principal: 100_000,
      rate: 0.08,
      bookedOn: '2025-12-01',
      maturityOn: '2026-12-15',
      maturityAmount: 108_500,
      compounding: 'quarterly',
      running: true,
    },
  ],
  funds: [
    {
      id: 'm1',
      name: 'Alpha Flexi Cap Direct Growth',
      ownerId: 'b',
      amc: 'Alpha AMC',
      category: 'Flexi cap',
      plan: 'unknown',
      value: 240_000,
      cost: 200_000,
      units: 1000,
      hasStatement: true,
      txns: [
        { date: '2026-05-05', kind: 'sip', units: 50, amount: 10_000, estimated: false },
        { date: '2026-06-05', kind: 'sip', units: 50, amount: 10_000, estimated: true },
        { date: '2026-07-10', kind: 'redeem', units: -20, amount: -5_000, estimated: false },
        { date: '2025-07-05', kind: 'sip', units: 50, amount: 8_000, estimated: false },
      ],
      realised: [
        { soldOn: '2026-07-10', acquiredOn: '2024-01-05', units: 20, proceeds: 5_000, cost: 3_000 },
        { soldOn: '2026-08-10', acquiredOn: '1900-01-01', units: 5, proceeds: 1_000, cost: null },
        { soldOn: '2025-08-10', acquiredOn: '2024-01-05', units: 5, proceeds: 2_000, cost: 1_500 },
      ],
    },
  ],
  fx: [
    {
      currency: 'SGD',
      native: 1_000,
      inr: 65_000,
      rate: 65,
      rateDate: '2026-10-28',
      asOf: '2026-10-01',
      accounts: 1,
    },
  ],
  snapshots: [
    {
      date: '2026-03-31',
      total: 1_000_000,
      byType: { bank_account: 350_000, fixed_deposit: 450_000, mutual_fund: 200_000 },
      byOwner: { a: 700_000, b: 300_000 },
    },
    {
      date: '2025-03-31',
      total: 900_000,
      byType: { bank_account: 300_000 },
      byOwner: { a: 600_000, b: 300_000 },
    },
  ],
  receivables: [
    {
      id: 'r1',
      name: 'Cousin',
      outstanding: 50_000,
      expectedOn: '2026-09-01',
      daysOverdue: 58,
      settled: false,
    },
    { id: 'r2', name: 'Friend', outstanding: 0, expectedOn: null, daysOverdue: 0, settled: true },
  ],
  goals: [
    {
      id: 'g1',
      name: 'Education',
      target: 1_000_000,
      targetOn: '2032-06-01',
      setAside: 250_000,
      status: 'On track',
    },
  ],
  quality: { toAnswer: 7, fundsNoPrice: 0 },
});

const q = (over: Partial<CentreQuery>): CentreQuery => ({
  template: 'holdings',
  period: 'this-fy',
  ...over,
});
const total = (r: ReturnType<typeof runReport>, id: string, key: string) =>
  r.tables.find((t) => t.id === id)!.total![key];

describe('runReport', () => {
  it('net worth: start, end and change, by kind and by person, from the snapshots and today’s holdings', () => {
    const r = runReport(input(), q({ template: 'networth', period: 'this-fy' }));
    expect(r.range).toMatchObject({ from: '2026-04-01', to: today });
    expect(r.kpis[0]!.value).toBe(1_000_000);
    expect(r.kpis[1]!.value).toBe(1_125_000);
    expect(r.kpis[2]!.value).toBe(125_000);
    const person = r.tables.find((t) => t.id === 'networth-person')!;
    expect(person.rows.map((x) => [x.item, x.start, x.end])).toEqual([
      ['Asha', 700_000, 820_000],
      ['Bala', 300_000, 305_000],
    ]);
  });

  it('net worth for one person, compared with the year before', () => {
    const r = runReport(
      input(),
      q({ template: 'networth', period: 'this-fy', owner: 'a', compare: true }),
    );
    expect(r.kpis[2]!.value).toBe(120_000);
    // the previous financial year: 600,000 on 31 Mar 2025 to 700,000 on 31 Mar 2026
    expect(r.kpis[2]!.previous).toBe(100_000);
    expect(r.applied).toEqual(['Person: Asha']);
    expect(r.tables.find((t) => t.id === 'networth-kind')!.note).toMatch(/whole family/);
  });

  it('says when no snapshot reaches the start, instead of showing a zero', () => {
    const r = runReport(
      input(),
      q({ template: 'networth', period: 'custom', from: '2020-01-01', to: '2020-12-31' }),
    );
    expect(r.kpis[0]!.value).toBeNull();
    expect(r.kpis[2]!.value).toBeNull();
    expect(r.notes.join(' ')).toMatch(/No daily snapshot reaches back/);
  });

  it('holdings: filters, grouping and totals; cost left blank where it is not known', () => {
    const r = runReport(input(), q({ template: 'holdings', group: 'owner' }));
    expect(r.tables[0]!.id).toBe('holdings-by-owner');
    expect(r.tables[0]!.rows.map((x) => [x.group, x.value])).toEqual([
      ['Asha', 820_000],
      ['Bala', 305_000],
    ]);
    const detail = r.tables.find((t) => t.id === 'holdings')!;
    expect(detail.rows.find((x) => x.name === 'Cash-NRE-1')!.cost).toBeNull();
    expect(detail.total!.value).toBe(1_125_000);
    const only = runReport(input(), q({ template: 'holdings', cls: 'cash', min: 100_000 }));
    expect(only.tables.find((t) => t.id === 'holdings')!.rows.map((x) => x.name)).toEqual([
      'Cash-NRE-1',
    ]);
  });

  it('cash never includes deposits or funds and shows foreign balances in their own currency', () => {
    const r = runReport(input(), q({ template: 'cash', group: 'none' }));
    const rows = r.tables[0]!.rows;
    expect(rows.map((x) => x.name)).toEqual(['Cash-NRE-1', 'Cash SGD']);
    expect(rows[1]).toMatchObject({
      currency: 'SGD',
      native: 1_000,
      value: 65_000,
      basis: 'Out of date',
    });
    expect(r.kpis[0]!.value).toBe(365_000);
  });

  it('deposits in a period: interest within the period only, from the terms', () => {
    const r = runReport(input(), q({ template: 'deposits', period: 'this-fy', group: 'none' }));
    const f1 = r.tables[0]!.rows.find((x) => x.name === 'FD-1')!;
    const v = (d: string) =>
      fdValueOn({
        principal: 500_000,
        annualRate: 0.07,
        bookedOn: new Date('2025-10-29T00:00:00Z'),
        asOf: new Date(`${d}T00:00:00Z`),
      });
    expect(f1.interest).toBeCloseTo(v('2026-10-30') - v('2026-04-01'), 1);
    expect(r.basis).toBe('C');
  });

  it('maturities look ahead and group by month', () => {
    const r = runReport(input(), q({ template: 'maturities', period: 'next-90' }));
    expect(r.tables[0]!.id).toBe('maturities-by-month');
    expect(r.tables[0]!.rows).toEqual([
      { group: 'Dec 2026', n: 1, back: 108_500, principal: 100_000 },
    ]);
    expect(r.kpis[2]!.value).toBe(108_500);
  });

  it('funds: plan, option and index from the scheme; gain not yet booked apart', () => {
    const r = runReport(input(), q({ template: 'funds', group: 'plan' }));
    const row = r.tables.find((t) => t.id === 'funds')!.rows[0]!;
    expect(row).toMatchObject({ plan: 'Direct', option: 'Growth', index: 'Active', gain: 40_000 });
    expect(r.tables[0]!.rows[0]!.group).toBe('Direct');
  });

  it('transactions: money in and out in the period, assumed instalments marked, with the period before', () => {
    const r = runReport(
      input(),
      q({ template: 'transactions', period: 'this-fy', compare: true, group: 'none' }),
    );
    expect(r.kpis.map((k) => [k.label, k.value, k.previous])).toEqual([
      ['Money in', 20_000, 8_000],
      ['Money out', 5_000, 0],
      ['Added less withdrawn', 15_000, 8_000],
    ]);
    expect(r.tables[0]!.rows.filter((x) => x.basis === 'Assumed from the SIP plan')).toHaveLength(
      1,
    );
    const sales = runReport(
      input(),
      q({ template: 'transactions', period: 'this-fy', kind: 'redeem' }),
    );
    expect(sales.tables.find((t) => t.id === 'transactions')!.rows).toHaveLength(1);
  });

  it('contributions keep confirmed and assumed instalments apart; they are not profit', () => {
    const r = runReport(input(), q({ template: 'contributions', period: 'this-fy', group: 'fy' }));
    expect(r.tables[0]!.rows).toEqual([
      { group: 'FY 2026-27', confirmed: 10_000, assumed: 10_000, out: 5_000, net: 15_000 },
    ]);
    expect(r.notes[0]).toMatch(/not profit/);
  });

  it('gains booked: sales in the period, an unknown cost left blank, compared with the year before', () => {
    const r = runReport(input(), q({ template: 'realised', period: 'this-fy', compare: true }));
    const rows = r.tables[0]!.rows;
    expect(rows.map((x) => [x.soldOn, x.gain])).toEqual([
      ['2026-08-10', null],
      ['2026-07-10', 2_000],
    ]);
    expect(rows[1]!.held).toBe(917);
    expect(r.kpis[1]).toMatchObject({ value: 2_000, previous: 500 });
    expect(r.notes.join(' ')).toMatch(/left blank rather than guessed/);
  });

  it('currency, money lent, goals and data quality', () => {
    expect(runReport(input(), q({ template: 'currency' })).tables[0]!.rows[0]).toMatchObject({
      currency: 'SGD',
      native: 1_000,
      rate: 65,
      rateDate: '2026-10-28',
      inr: 65_000,
    });
    expect(
      total(runReport(input(), q({ template: 'receivables' })), 'receivables', 'outstanding'),
    ).toBe(50_000);
    expect(runReport(input(), q({ template: 'goals' })).tables[0]!.rows[0]!.funded).toBe(0.25);
    const dq = runReport(input(), q({ template: 'quality' }));
    expect(dq.tables[0]!.rows.map((x) => x.n)).toEqual([1, 2, 0, 0, 7]);
  });

  it('a template with its own page points there', () => {
    const r = runReport(input(), q({ template: 'tax' }));
    expect(r.tables).toEqual([]);
    expect(r.notes[0]).toMatch(/\/tax\/filing/);
  });

  it('every template runs on an empty household without throwing', () => {
    const empty: CentreInput = {
      ...input(),
      holdings: [],
      deposits: [],
      funds: [],
      fx: [],
      snapshots: [],
      receivables: [],
      goals: [],
      quality: { toAnswer: null, fundsNoPrice: 0 },
    };
    for (const t of CENTRE_TEMPLATES)
      expect(() => runReport(empty, q({ template: t.key, compare: true }))).not.toThrow();
  });
});

describe('the query in the address', () => {
  it('round-trips, and drops values a template does not group by or that are malformed', () => {
    const query: CentreQuery = {
      template: 'transactions',
      period: 'custom',
      from: '2026-01-01',
      to: '2026-03-31',
      owner: 'a',
      kind: 'sip',
      min: 1000,
      group: 'fund',
      compare: true,
    };
    const back = paramsToQuery(queryToParams(query));
    expect(back).toMatchObject(query);
    expect(
      paramsToQuery({ t: 'funds', g: 'month', min: 'abc', cur: 'sgd!', period: 'bogus' }),
    ).toMatchObject({
      template: 'funds',
      group: null,
      min: null,
      currency: null,
      period: 'today',
    });
    expect(paramsToQuery({}).template).toBe('networth');
  });

  it('filters in words', () => {
    expect(
      appliedFilters(
        q({ template: 'holdings', owner: 'b', cls: 'fd', min: 100000, max: 500000, q: 'alpha' }),
        { b: 'Bala' },
      ),
    ).toEqual([
      'Person: Bala',
      'Kind: Fixed deposits',
      'Amount: ₹1,00,000 to ₹5,00,000',
      'Name contains “alpha”',
    ]);
  });
});

describe('fund classification', () => {
  it.each([
    ['Alpha Small Cap Fund - Regular Plan - Growth', 'growth'],
    ['Beta Balanced Advantage - Direct - IDCW Payout', 'idcw'],
    ['Gamma Equity Dividend Yield', 'idcw'],
    ['Delta Liquid Fund', 'unknown'],
  ] as const)('%s → %s', (name, option) => expect(fundOption(name)).toBe(option));

  it('index funds and plans', () => {
    expect(isIndexFund('Nifty 50 Index Fund', 'Index')).toBe(true);
    expect(isIndexFund('Alpha Flexi Cap', 'Flexi cap')).toBe(false);
    expect(fundPlan({ plan: 'unknown', name: 'X Fund Regular Plan' })).toBe('regular');
    expect(fundPlan({ plan: 'direct', name: 'X Fund Regular Plan' })).toBe('direct');
  });

  it('deposit interest within dates stops at maturity', () => {
    const d = input().deposits[1]!;
    expect(fdInterestWithin(d, '2027-01-01', '2027-12-31')).toBe(0);
    expect(fdInterestWithin(d, '2025-01-01', '2027-12-31')).toBeGreaterThan(8_000);
  });
});
