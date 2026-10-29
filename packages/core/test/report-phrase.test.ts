import { describe, expect, it } from 'vitest';
import { readAmount, readPhrase } from '../src/report-phrase';

const ctx = {
  today: '2026-10-29',
  people: { r1: 'Rupash Example', r2: 'Ragini Example' },
  banks: ['Equitas Bank', 'IDFC First Bank', 'RBL'],
  amcs: ['HDFC Mutual Fund', 'Nippon India Mutual Fund'],
};

describe('readAmount', () => {
  it.each([
    ['5 lakh', 500_000],
    ['2.5L', 250_000],
    ['1 cr', 10_000_000],
    ['50k', 50_000],
    ['75,000', 75_000],
  ] as const)('%s → %i', (s, n) => expect(readAmount(s)).toBe(n));
  it('rejects words', () => expect(readAmount('lots')).toBeNull());
});

describe('readPhrase', () => {
  it('a person, maturities ahead and an amount', () => {
    const r = readPhrase("Ragini's FDs maturing in the next 90 days above 5 lakh", ctx);
    expect(r.query).toMatchObject({
      template: 'maturities',
      period: 'next-90',
      owner: 'r2',
      min: 500_000,
    });
    expect(r.understood).toEqual([
      'Report: Deposit maturities',
      'Amount at least ₹5,00,000',
      'Next 90 days',
      'Person: Ragini Example',
    ]);
    expect(r.unknown).toEqual([]);
  });

  it('SIPs last financial year by month, compared', () => {
    const r = readPhrase('SIPs last FY by month vs previous', ctx);
    expect(r.query).toMatchObject({
      template: 'contributions',
      period: 'last-fy',
      group: 'month',
      compare: true,
    });
  });

  it('realised gains in a named financial year, for one fund house', () => {
    const r = readPhrase('realised gains FY 2025-26 nippon india', ctx);
    expect(r.query).toMatchObject({
      template: 'realised',
      period: 'custom',
      from: '2025-04-01',
      to: '2026-03-31',
      amc: 'Nippon India Mutual Fund',
    });
  });

  it('a month, a bank and transactions between two amounts', () => {
    const r = readPhrase('transactions march 2026 between 10k and 1 lakh', ctx);
    expect(r.query).toMatchObject({
      template: 'transactions',
      from: '2026-03-01',
      to: '2026-03-31',
      min: 10_000,
      max: 100_000,
    });
    expect(readPhrase('equitas cash balances', ctx).query).toMatchObject({
      template: 'cash',
      bank: 'Equitas Bank',
    });
  });

  it('a currency alone opens the currency report; plan and option are read', () => {
    expect(readPhrase('sgd', ctx).query.template).toBe('currency');
    expect(readPhrase('regular plan idcw funds', ctx).query).toMatchObject({
      template: 'funds',
      plan: 'regular',
      option: 'idcw',
    });
  });

  it('any number of days back or ahead', () => {
    expect(readPhrase('transactions last 45 days', ctx).query).toMatchObject({
      period: 'custom',
      from: '2026-09-15',
      to: '2026-10-29',
    });
    expect(readPhrase('deposits maturing next 120 days', ctx).query).toMatchObject({
      template: 'maturities',
      from: '2026-10-29',
      to: '2027-02-26',
    });
  });

  it('lists the words it did not understand instead of guessing', () => {
    const r = readPhrase('net worth this fy for the cat', ctx);
    expect(r.query).toMatchObject({ template: 'networth', period: 'this-fy' });
    expect(r.unknown).toEqual(['cat']);
  });

  it('a period on a report for today is shown as not used', () => {
    const r = readPhrase('cash last month', ctx);
    expect(r.query.template).toBe('cash');
    expect(r.understood.some((u) => /not used/.test(u))).toBe(true);
  });
});
