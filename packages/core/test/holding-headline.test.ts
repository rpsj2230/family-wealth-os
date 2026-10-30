import { describe, expect, it } from 'vitest';
import {
  afterTaxWords,
  buildDepositPageExplain,
  buildSavingsPageExplain,
  contractOfStored,
  depositInterestWords,
  missingFigures,
  depositHeadline,
  depositOn,
  pointsAhead,
  rateAfterTax,
  savingsHeadline,
  savingsPeriod,
  sipStatus,
  spanBetween,
} from '../src';

const TODAY = '2026-10-30';
const FD = {
  principal: 500_000,
  rate: 0.0725,
  booked_on: '2025-03-12',
  maturity_on: '2028-03-12',
  compounding: 'quarterly' as const,
  bank_maturity_amount: null,
};

describe('rateAfterTax', () => {
  it('NRE interest is tax-free, NRO is taxed at the rate given (Settings), any other account is not known', () => {
    expect(rateAfterTax(0.07, 'NRE', 0.3)).toEqual({ rate: 0.07, kind: 'NRE', taxRate: 0 });
    const nro = rateAfterTax(0.07, 'NRO', 0.3);
    expect(nro.kind).toBe('NRO');
    expect(nro.rate).toBeCloseTo(0.049, 10);
    expect(nro.taxRate).toBe(0.3);
    expect(rateAfterTax(0.07, null, 0.3)).toEqual({ rate: 0.07, kind: 'unknown', taxRate: null });
  });
});

describe('depositHeadline', () => {
  const base = { today: TODAY, deposit: FD, accountKind: 'NRE', nroTaxRate: 0.3, cover: null };

  it('takes the engine’s current value as the one figure, and every other figure follows from it', () => {
    const terms = depositOn(contractOfStored(FD), TODAY).held;
    const h = depositHeadline({ ...base, current: terms });
    expect(h.state).toBe('running');
    expect(h.current).toBe(terms);
    expect(h.invested).toBe(500_000);
    expect(h.profit).toBeCloseTo(terms - 500_000, 6);
    expect(h.profitPct).toBeCloseTo((terms - 500_000) / 500_000, 10);
    // Total interest = Maturity value − Invested; Interest still to come = Maturity value − Current value
    expect(h.totalInterest).toBeCloseTo(h.maturity - 500_000, 6);
    expect(h.interestToCome).toBeCloseTo(h.maturity - terms, 6);
    expect(h.earnedShare).toBeCloseTo(h.profit / h.totalInterest, 10);
    expect(h.daysLeft).toBe(499);
    expect(h.paidOut).toBe(0);
    // quarterly compounding at 7.25% is about 7.45% a year
    expect(h.xirr).toBeCloseTo(0.0745, 3);
    expect(h.afterTax).toEqual({ rate: 0.0725, kind: 'NRE', taxRate: 0 });
    expect(h.insured).toBeNull();
  });

  it('uses the engine value even when it differs from the terms worked out here (one current value everywhere)', () => {
    const h = depositHeadline({ ...base, current: 527_400 });
    expect(h.current).toBe(527_400);
    expect(h.profit).toBe(27_400);
    expect(h.interestToCome).toBeCloseTo(h.maturity - 527_400, 6);
  });

  it('works the value out from its terms when the engine gives none', () => {
    const h = depositHeadline({ ...base, current: null });
    expect(h.current).toBeCloseTo(depositOn(contractOfStored(FD), TODAY).held, 6);
  });

  it('counts the interest earned since 1 April', () => {
    const c = contractOfStored(FD);
    const h = depositHeadline({ ...base, current: null });
    expect(h.fyStart).toBe('2026-04-01');
    expect(h.interestFy).toBeCloseTo(
      depositOn(c, TODAY).earned - depositOn(c, '2026-04-01').earned,
      6,
    );
  });

  it('NRO interest after the tax in Settings; insured within the limit at this bank and name', () => {
    const h = depositHeadline({
      ...base,
      current: null,
      accountKind: 'NRO',
      nroTaxRate: 0.312,
      cover: { limit: 500_000, total: 480_000 },
    });
    expect(h.afterTax.rate).toBeCloseTo(0.0725 * (1 - 0.312), 10);
    expect(h.insured).toEqual({ yes: true, limit: 500_000, total: 480_000 });
    const over = depositHeadline({ ...base, current: null, cover: { limit: 500_000, total: 9e5 } });
    expect(over.insured?.yes).toBe(false);
  });

  it('a payout deposit keeps paid-out interest as booked profit and counts it in its XIRR', () => {
    const d = { ...FD, payout: 'quarterly' };
    const h = depositHeadline({ ...base, deposit: d, current: null });
    expect(h.payout).toBe('quarterly');
    expect(h.paidOut).toBeGreaterThan(0);
    expect(h.current).toBeLessThan(500_000 * (1 + 0.0725 / 4));
    expect(h.xirr).toBeCloseTo(0.0745, 2);
    expect(h.totalInterest).toBeGreaterThan(h.maturity - 500_000);
  });

  it('a matured deposit has nothing still to come', () => {
    const h = depositHeadline({
      ...base,
      deposit: { ...FD, maturity_on: '2026-03-12' },
      current: null,
    });
    expect(h.state).toBe('matured');
    expect(h.interestToCome).toBe(0);
    expect(h.daysLeft).toBeLessThan(0);
  });
});

describe('savingsHeadline', () => {
  const account = {
    assetId: 's1',
    currency: 'INR',
    rate: 0.07,
    tdsRate: 0,
    balances: [
      { date: '2026-03-31', amount: 400_000 },
      { date: '2026-10-15', amount: 410_000 },
    ],
  };
  const detail = {
    baseline: { date: '2026-10-15', amount: 410_000 },
    moved: 0,
    credited: 0,
    accrued: 1_179,
  };

  it('the engine’s value, the bank’s last balance and the interest not yet credited', () => {
    const h = savingsHeadline({
      today: TODAY,
      current: 411_179,
      detail,
      account,
      accountKind: 'NRE',
      nroTaxRate: 0.3,
      depositRate: 0.0769,
    });
    expect(h.current).toBe(411_179);
    expect(h.balance).toEqual({ amount: 410_000, date: '2026-10-15' });
    expect(h.uncredited).toBe(1_179);
    expect(h.estimated).toBe(true);
    expect(h.rate).toBe(0.07);
    expect(h.afterTax.kind).toBe('NRE');
    // one day's interest on the last balance, the rule Accounts uses for today's change
    expect(h.todayChange).toBeCloseTo((410_000 * 0.07) / 365, 0);
    // interest since 1 April from the balances on file
    expect(h.interestFy).toBeCloseTo(
      savingsPeriod([account], spanBetween('2026-04-01', TODAY)).profit,
      6,
    );
    expect(h.interestFy).toBeGreaterThan(0);
    expect(h.vsDeposits?.perYear).toBeCloseTo(411_179 * (0.07 - 0.0769), 6);
  });

  it('without the engine’s breakdown, the last balance on file; without a deposit rate, no comparison', () => {
    const h = savingsHeadline({
      today: TODAY,
      current: null,
      detail: null,
      account,
      accountKind: 'NRO',
      nroTaxRate: 0.3,
      depositRate: null,
    });
    expect(h.current).toBe(410_000);
    expect(h.balance).toEqual({ amount: 410_000, date: '2026-10-15' });
    expect(h.estimated).toBe(false);
    expect(h.afterTax.rate).toBeCloseTo(0.049, 10);
    expect(h.vsDeposits).toBeNull();
  });
});

describe('sipStatus', () => {
  it('Running, Paused until a date, Stopped or None', () => {
    expect(sipStatus({ monthly: 10_000, stopped: false })).toEqual({
      status: 'running',
      until: null,
      monthly: 10_000,
    });
    expect(sipStatus({ monthly: 10_000, stopped: true }).status).toBe('stopped');
    expect(sipStatus({ monthly: null, stopped: false }).status).toBe('none');
    expect(
      sipStatus({
        monthly: 10_000,
        stopped: false,
        plan: { now: 0, next: { on: '2027-04-01', monthly: 10_000 } },
      }),
    ).toEqual({ status: 'paused', until: '2027-04-01', monthly: 10_000 });
    expect(
      sipStatus({ monthly: 5_000, stopped: false, plan: { now: 8_000, next: null } }).monthly,
    ).toBe(8_000);
  });
});

describe('pointsAhead', () => {
  it('your XIRR less the benchmark’s on the same money, in points', () => {
    expect(pointsAhead(0.137, 0.112)).toBe(2.5);
    expect(pointsAhead(0.09, 0.112)).toBe(-2.2);
    expect(pointsAhead(null, 0.1)).toBeNull();
  });
});

describe('the "?" of the deposit and savings headlines', () => {
  const links = { edit: '/asset/x?edit=x', settings: '/settings', cover: '/deposits?tab=cover' };
  it('every figure of a deposit’s headline has its explainer, with the numbers plugged in', () => {
    const h = depositHeadline({
      today: TODAY,
      deposit: FD,
      current: 527_400,
      accountKind: 'NRO',
      nroTaxRate: 0.3,
      cover: { limit: 500_000, total: 527_400 },
    });
    const set = buildDepositPageExplain({
      h,
      valueNote: null,
      bankMaturityAmount: null,
      bank: 'Sample Bank',
      links,
    });
    expect(missingFigures('fd', set)).toEqual([]);
    expect(set['fd.value'].how).toContain('₹5,27,400');
    expect(set['fd.afterTax'].how).toContain('30.0% tax on NRO interest');
    expect(set['fd.insured'].how).toContain('over the ₹5,00,000 limit');
    expect(depositInterestWords(h)).toBe('interest added quarterly');
    expect(depositInterestWords({ payout: 'monthly', compounding: 'quarterly' })).toBe(
      'interest paid out monthly',
    );
    expect(afterTaxWords(h.afterTax)).toBe('NRO: after 30.0% tax (Settings)');
  });

  it('every figure of a savings headline has its explainer', () => {
    const h = savingsHeadline({
      today: TODAY,
      current: 412_350,
      detail: {
        baseline: { date: '2026-10-15', amount: 410_000 },
        moved: 0,
        credited: 0,
        accrued: 2_350,
      },
      account: { assetId: 's', currency: 'INR', rate: 0.07, tdsRate: 0, balances: [] },
      accountKind: 'NRE',
      nroTaxRate: 0.3,
      depositRate: null,
    });
    const set = buildSavingsPageExplain({
      h,
      rateNote: 'your own rate',
      rateAssumed: false,
      tdsRate: 0,
      balances: 3,
      links: { update: '/monthly', rates: '/rates', settings: '/settings' },
    });
    expect(missingFigures('savings', set)).toEqual([]);
    expect(set['savings.value'].how).toContain('₹2,350 interest not yet credited = ₹4,12,350');
    expect(set['savings.vsDeposits'].completeness.level).toBe('missing');
  });
});
