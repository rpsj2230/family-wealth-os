import { describe, expect, it } from 'vitest';
import {
  carryForward,
  estimateFd,
  estimateForeign,
  estimateFundByNavRatio,
  estimateFundByUnits,
  estimateFundWithSip,
  sipDates,
  estimateSavings,
  sumEstimates,
} from '../src/estimate';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-25');

describe('estimateFd', () => {
  it('accrues on contract terms and is labelled calculated', () => {
    const e = estimateFd({
      principal: 500_000,
      annualRate: 0.08,
      bookedOn: d('2026-09-14'),
      today,
      maturityOn: d('2029-09-15'),
    });
    expect(e.basis).toBe('calculated');
    expect(e.estimatedAmount).toBeGreaterThan(500_000);
    expect(e.estimatedAmount).toBeLessThan(634_399);
    // 41 days at 8% quarterly ~ 0.8% ahead of principal
    expect(e.estimatedAmount / 500_000 - 1).toBeCloseTo(0.009, 3);
  });
  it('stops at maturity value after maturity', () => {
    const e = estimateFd({
      principal: 1_000_000,
      annualRate: 0.065,
      bookedOn: d('2021-11-01'),
      today: d('2027-06-01'),
      maturityOn: d('2026-11-01'),
    });
    expect(e.estimatedAmount).toBeCloseTo(1_380_664, -2);
  });
});

describe('estimateSavings', () => {
  it('adds interest since the last verified balance', () => {
    const e = estimateSavings({
      balance: 4_654_533,
      balanceAsOf: d('2026-09-25'),
      today,
      annualRate: 0.03,
    });
    expect(e.components[0]!.amount).toBeCloseTo(11_476.93, 0); // 4,654,533 x 3% x 30/365
    expect(e.basis).toBe('estimated');
  });
  it('applies TDS when configured', () => {
    const gross = estimateSavings({
      balance: 100_000,
      balanceAsOf: d('2026-01-01'),
      today: d('2027-01-01'),
      annualRate: 0.04,
    });
    const net = estimateSavings({
      balance: 100_000,
      balanceAsOf: d('2026-01-01'),
      today: d('2027-01-01'),
      annualRate: 0.04,
      tdsRate: 0.3,
    });
    expect(net.components[0]!.amount).toBeCloseTo(gross.components[0]!.amount * 0.7, 6);
  });
  it('adds nothing when the balance is dated today or in the future', () => {
    expect(
      estimateSavings({ balance: 1000, balanceAsOf: today, today, annualRate: 0.05 })
        .estimatedAmount,
    ).toBe(1000);
    expect(
      estimateSavings({ balance: 1000, balanceAsOf: d('2026-12-01'), today, annualRate: 0.05 })
        .estimatedAmount,
    ).toBe(1000);
  });
  it('rejects invalid rates', () => {
    expect(() =>
      estimateSavings({ balance: 1, balanceAsOf: today, today, annualRate: -0.01 }),
    ).toThrow();
    expect(() =>
      estimateSavings({ balance: 1, balanceAsOf: today, today, annualRate: 0.01, tdsRate: 1 }),
    ).toThrow();
  });
});

describe('funds', () => {
  it('units x NAV is exact and labelled calculated', () => {
    const e = estimateFundByUnits({
      units: 1000,
      navToday: 55,
      anchorAmount: 50_000,
      anchorAsOf: d('2026-09-30'),
      today,
    });
    expect(e.estimatedAmount).toBe(55_000);
    expect(e.components[0]!.amount).toBe(5_000);
    expect(e.basis).toBe('calculated');
  });
  it('NAV ratio scales the anchor value', () => {
    const e = estimateFundByNavRatio({
      anchorAmount: 100_000,
      anchorAsOf: d('2026-09-30'),
      navAtAnchor: 50,
      navToday: 55,
      today,
    });
    expect(e.estimatedAmount).toBeCloseTo(110_000, 6);
    expect(e.basis).toBe('estimated');
  });
  it('falls back to carry-forward (never zero) when NAVs are unavailable', () => {
    const e = estimateFundByNavRatio({
      anchorAmount: 100_000,
      anchorAsOf: d('2026-09-30'),
      navAtAnchor: null,
      navToday: 55,
      today,
    });
    expect(e.estimatedAmount).toBe(100_000);
    expect(e.basis).toBe('carried_forward');
  });
});

describe('foreign balances', () => {
  it('separates currency movement from the balance itself', () => {
    const e = estimateForeign({
      nativeAmount: 46_655.19,
      anchorRate: 65,
      anchorAsOf: d('2026-10-01'),
      rateToday: 68,
      today,
    });
    expect(e.anchorAmount).toBeCloseTo(3_032_587.35, 2);
    expect(e.components[0]!.kind).toBe('fx');
    expect(e.components[0]!.amount).toBeCloseTo(46_655.19 * 3, 2);
  });
});

describe('sumEstimates', () => {
  it('splits the total change into interest, market and fx and basis buckets', () => {
    const items = [
      estimateSavings({ balance: 100_000, balanceAsOf: d('2026-09-25'), today, annualRate: 0.03 }),
      estimateFundByUnits({
        units: 100,
        navToday: 12,
        anchorAmount: 1000,
        anchorAsOf: d('2026-09-25'),
        today,
      }),
      carryForward({ amount: 2_500_000, asOf: d('2023-12-15'), today }),
    ];
    const t = sumEstimates(items);
    expect(t.anchorTotal).toBe(100_000 + 1000 + 2_500_000);
    expect(t.market).toBe(200);
    expect(t.interest).toBeGreaterThan(0);
    expect(t.fx).toBe(0);
    expect(t.estimatedTotal).toBeCloseTo(t.anchorTotal + t.interest + t.market + t.fx, 6);
    expect(t.byBasis.carried_forward).toBe(2_500_000);
  });
});

describe('sipDates', () => {
  it('gives one date a month on the debit day, after the anchor and up to today', () => {
    expect(sipDates('2026-01-05', d('2026-08-20'), d('2026-10-26'))).toEqual([
      '2026-09-05',
      '2026-10-05',
    ]);
  });
  it('clamps the 31st to the end of shorter months and starts no earlier than the start date', () => {
    expect(sipDates('2026-01-31', d('2026-01-01'), d('2026-04-30'))).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
    expect(sipDates('2026-10-05', d('2026-01-01'), d('2026-10-26'))).toEqual(['2026-10-05']);
  });
  it('excludes an instalment on the anchor date itself (already in the recorded value)', () => {
    expect(sipDates('2026-01-05', d('2026-10-05'), d('2026-10-26'))).toEqual([]);
  });
  it('returns nothing for an unreadable start date', () => {
    expect(sipDates('not a date', d('2026-01-01'), d('2026-10-26'))).toEqual([]);
  });
});

describe('estimateFundWithSip', () => {
  const navs: Record<string, number> = { '2026-08-31': 100, '2026-09-05': 102, '2026-10-05': 108 };
  const navOn = (date: string) => {
    const k = Object.keys(navs)
      .filter((x) => x <= date)
      .sort()
      .pop();
    return k ? navs[k]! : null;
  };
  const common = {
    anchorAmount: 100_000,
    anchorAsOf: d('2026-08-31'),
    navAtAnchor: 100,
    navToday: 110,
    navOn,
    today: d('2026-10-26'),
  };

  it('adds each instalment since the anchor, valued at today’s NAV, and keeps the parts separate', () => {
    const e = estimateFundWithSip({
      ...common,
      sip: { monthly: 10_000, startedOn: '2024-01-05', stopped: false },
    });
    // anchor 100k grows by 10%; two instalments (5 Sep at 102, 5 Oct at 108) are valued at 110
    const worth = (10_000 * 110) / 102 + (10_000 * 110) / 108;
    expect(e.estimatedAmount).toBeCloseTo(110_000 + worth, 2);
    expect(e.components.map((c) => c.kind)).toEqual(['market', 'contribution', 'market']);
    expect(e.components[1]!.amount).toBe(20_000);
    expect(e.basis).toBe('estimated');
    expect(e.method).toBe('nav_ratio_sip');
  });

  it('matches the plain NAV roll-forward when there is no SIP or it is stopped', () => {
    const plain = estimateFundByNavRatio(common);
    expect(estimateFundWithSip({ ...common, sip: null }).estimatedAmount).toBe(
      plain.estimatedAmount,
    );
    expect(
      estimateFundWithSip({
        ...common,
        sip: { monthly: 10_000, startedOn: '2024-01-05', stopped: true },
      }).estimatedAmount,
    ).toBe(plain.estimatedAmount);
  });

  it('counts an instalment at face value when no NAV is known for its date', () => {
    const e = estimateFundWithSip({
      ...common,
      navOn: () => null,
      sip: { monthly: 10_000, startedOn: '2024-01-05', stopped: false },
    });
    expect(e.estimatedAmount).toBeCloseTo(110_000 + 20_000, 2);
  });

  it('does not invent a value when the NAV data is missing', () => {
    const e = estimateFundWithSip({
      ...common,
      navToday: null,
      sip: { monthly: 10_000, startedOn: '2024-01-05', stopped: false },
    });
    expect(e.basis).toBe('carried_forward');
    expect(e.estimatedAmount).toBe(100_000);
  });
});
