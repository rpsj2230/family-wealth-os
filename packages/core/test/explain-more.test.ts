import { describe, expect, it } from 'vitest';
import { missingFigures } from '../src/explain';
import {
  buildMonthlyExplain,
  buildNewMoneyExplain,
  buildRatesExplain,
  buildTaxExplain,
} from '../src/explain-more';
import { buildReportsExplain, reportTableExplain } from '../src/explain-reports';
import { fdSummary, fundSummary, type ReportFd, type ReportFund } from '../src/reports';

const fd = (id: string, principal: number, rate: number, maturityAmount: number): ReportFd => ({
  id,
  bank: 'Sample Bank',
  owner: 'Anil',
  kind: 'NRE',
  principal,
  rate,
  bookedOn: '2025-05-12',
  maturityOn: '2027-05-12',
  maturityAmount,
  compounding: 'quarterly',
});
const fund = (id: string, hasStatement: boolean): ReportFund => ({
  id,
  name: `Fund ${id}`,
  owner: 'Anil',
  category: 'Flexi cap',
  amc: 'Alpha',
  value: 150_000,
  invested: 100_000,
  units: 10,
  startedOn: '2023-01-05',
  xirr: 0.12,
  sipMonthly: 5_000,
  sipStopped: false,
  txns: [],
  lots: [],
  hasStatement,
});

describe('Reports explainers', () => {
  const fds = [fd('a', 1_000_000, 0.07, 1_150_000), fd('b', 500_000, 0.08, 590_000)];
  const funds = [fund('1', true), fund('2', false)];
  const ex = buildReportsExplain({
    today: '2026-10-26',
    scope: null,
    fds,
    funds,
    links: {
      deposits: '/deposits',
      investments: '/investments',
      import: '/import',
      settings: '/s',
    },
  });

  it('covers every registered figure', () => {
    expect(missingFigures('reports', ex)).toEqual([]);
  });

  it('works out each total the way the strip does, with the average rate weighted by amount', () => {
    expect(ex['reports.fdPrincipal'].exact).toBe('₹15,00,000');
    expect(ex['reports.fdMaturity'].exact).toBe('₹17,40,000');
    expect(ex['reports.fdRate'].how).toContain('7.33%');
    expect(ex['reports.fundGain'].how).toContain('÷ ₹2,00,000 invested');
  });

  it('is candid that "interest still to earn" in the strip is the interest over the whole life', () => {
    expect(ex['reports.fdInterest'].completeness.text).toContain('whole life');
  });

  it('says the XIRR is one rate over all the funds together, the same rule as Investments', () => {
    expect(ex['reports.fundXirr'].title).toBe('XIRR');
    expect(ex['reports.fundXirr'].how).toContain('solved for one yearly rate');
    expect(ex['reports.fundXirr'].how).toContain('The same rule as Investments');
  });

  it('explains a table from the table itself', () => {
    const e = reportTableExplain(fdSummary(fds, { basis: 'maturity', period: 'month' }), {
      today: '2026-10-26',
      noStatement: 0,
      funds: 0,
      links: { import: '/import' },
    });
    expect(e.how).toContain('Grand total');
    expect(e.how).toContain('Maturity so far');
    const f = reportTableExplain(fundSummary(funds, 'owner'), {
      today: '2026-10-26',
      noStatement: 1,
      funds: 2,
      links: { import: '/import' },
    });
    expect(f.completeness.level).toBe('partly_estimated');
    expect(f.how).toContain('Overall % = Profit ÷ Invested');
    expect(f.fix?.href).toBe('/import');
  });
});

describe('Tax, Monthly, New money and Rates explainers', () => {
  it('Tax covers every figure and ties the meter to its parts', () => {
    const ex = buildTaxExplain({
      fy: '2026-27',
      today: '2026-11-20',
      deadline: '2027-03-31',
      daysLeft: 131,
      orderBy: '2027-03-15',
      status: 'ok',
      rulesVerified: false,
      rulesCarriedForward: true,
      people: [
        {
          name: 'Anil',
          meter: { allowance: 125_000, used: 20_000, plan: 60_000, free: 45_000 },
          sell: [{ fund: 'F', worth: 200_000, gain: 60_000, estimated: true }],
          losses: [{ fund: 'G', loss: 8_000, shortLoss: 8_000, longLoss: 0, estimated: false }],
        },
      ],
      costs: { stt: 100, stampDuty: 20, exitLoad: 0, total: 120 },
      refunds: {
        count: 2,
        open: 1,
        expectedGain: 60_000,
        expectedRefund: 6_000,
        received: 0,
        incomeLimit: 700_000,
      },
      links: {
        settings: '/settings',
        investments: '/investments',
        filing: '/tax/filing',
        import: '/import',
      },
    });
    expect(missingFigures('tax', ex)).toEqual([]);
    expect(ex['tax.allowance'].how).toContain(
      '₹1,25,000 − used this year ₹20,000 − this plan ₹60,000 = still free ₹45,000',
    );
    expect(ex['tax.allowance'].completeness.level).toBe('partly_estimated');
    expect(ex['tax.sell'].completeness.level).toBe('estimated');
    expect(ex['tax.costs'].how).toContain('= ₹120');
  });

  it('Monthly says what current means and how many banks are up to date', () => {
    const ex = buildMonthlyExplain({
      today: '2026-10-26',
      month: 'October 2026',
      summary: {
        banks: 6,
        current: 4,
        waiting: 1,
        attention: 1,
        balances: 20,
        balancesCurrent: 15,
        depositsToConfirm: 2,
        newestUpdate: '2026-10-24',
      },
      freshnessDays: 35,
      links: { inbox: '/inbox', accounts: '/accounts' },
    });
    expect(missingFigures('monthly', ex)).toEqual([]);
    expect(ex['monthly.status'].how).toContain('4 of 6 banks are up to date');
    expect(ex['monthly.status'].completeness.level).toBe('partly_estimated');
    expect(ex['monthly.freshness'].how).toContain('70 days');
  });

  it('New money and Rates cover every figure and name the dates of the rates', () => {
    const offers = {
      count: 12,
      newest: '2026-10-21',
      oldest: '2026-08-02',
      stale: 3,
      staleDays: 30,
    };
    const nm = buildNewMoneyExplain({
      today: '2026-10-26',
      offers,
      limit: 500_000,
      baselineRate: 0.03,
      amount: 1_500_000,
      kind: 'NRE',
      pick: {
        title: 'Spread',
        totalAnnual: 110_000,
        uplift: 60_000,
        blendedNet: 0.0733,
        topShare: 0.4,
        liquidNow: 300_000,
        longestTerm: 24,
        banks: 3,
      },
      suggestions: { count: 1, totalGain: 12_000 },
      room: { names: 5, over: 1, outside: 0 },
      links: { rates: '/rates', deposits: '/deposits?tab=cover' },
    });
    expect(missingFigures('newmoney', nm)).toEqual([]);
    expect(nm['newmoney.options'].how).toContain('₹1,10,000 a year');
    expect(nm['newmoney.options'].inputs[0]?.from).toBe('2026-08-02');
    expect(nm['newmoney.options'].completeness.level).toBe('partly_estimated');
    const r = buildRatesExplain({
      today: '2026-10-26',
      offers,
      unreadable: 1,
      banks: 5,
      links: { settings: '/settings' },
    });
    expect(missingFigures('rates', r)).toEqual([]);
    expect(r['rates.freshness'].how).toContain('2 Aug 2026 and 21 Oct 2026');
  });

  it('a New money explainer without an amount says it is missing', () => {
    const nm = buildNewMoneyExplain({
      today: '2026-10-26',
      offers: { count: 0, newest: null, oldest: null, stale: 0, staleDays: 30 },
      limit: 500_000,
      baselineRate: 0.03,
      amount: 0,
      kind: 'NRE',
      pick: null,
      suggestions: { count: 0, totalGain: 0 },
      room: { names: 0, over: 0, outside: 0 },
      links: { rates: '/rates', deposits: '/d' },
    });
    expect(nm['newmoney.options'].completeness.level).toBe('missing');
  });
});
