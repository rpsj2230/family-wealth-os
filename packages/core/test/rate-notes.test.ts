import { describe, expect, it } from 'vitest';
import { parseAmount, parseRateNotes } from '../src/rate-notes';
import { savingsRateFor, slabText, tenureText, type RateOffer } from '../src/rates';

const SAMPLE = `1. JanaBank - Saving [2.5%-1Lk, 3.50% - 1Lk to 5Lk, 4.50% - 5Lk to 10 lk, 6.75% - 10lk to 50 lk, 7% - above 50 lk ], NRE FD[8% -2 Yr]
2. Equitas  - Saving [2.5%-3Lk, 5% > 3Lk to 5Lk, 6.00% 5-10lk,6.50% -above 10lk], NRE FD[8.0% -3 Yrs]
3. ESAF     - Saving [2.5%-1Lk, 3.00% - 1Lk to 2Lk, 5% - 2Lk to 5lk,], NRE FD[8% -800 days (2.2 Yrs)]
8. IndusInd - Saving [2.5%-1Lk, 3% > 25Lk], NRE FD[7.00% -2Yr]
9. HDFC     - Saving [3%-50Lk], NRE FD[6.5% - 3Yrs]`;

describe('parseAmount', () => {
  it('reads lakhs, crores and thousands', () => {
    expect(parseAmount('1Lk')).toBe(100_000);
    expect(parseAmount('10 lk')).toBe(1_000_000);
    expect(parseAmount('2.5 lakh')).toBe(250_000);
    expect(parseAmount('1 cr')).toBe(10_000_000);
    expect(parseAmount('50k')).toBe(50_000);
    expect(parseAmount('none')).toBeNull();
  });
});

describe('parseRateNotes', () => {
  const { offers, problems } = parseRateNotes(SAMPLE);
  const jana = offers.filter((o) => o.bank === 'JanaBank');
  it('reads savings slabs of every shape', () => {
    const sav = jana.filter((o) => o.product === 'savings');
    expect(sav.map((o) => [o.rate, o.balanceFrom, o.balanceTo])).toEqual([
      [0.025, null, 100_000],
      [0.035, 100_000, 500_000],
      [0.045, 500_000, 1_000_000],
      [0.0675, 1_000_000, 5_000_000],
      [0.07, 5_000_000, null],
    ]);
  });
  it('reads a deposit in years and in days', () => {
    expect(jana.find((o) => o.product === 'fd')).toMatchObject({
      rate: 0.08,
      accountKind: 'NRE',
      tenureFromMonths: 24,
      tenureDays: null,
    });
    const esaf = offers.find((o) => o.bank === 'ESAF' && o.product === 'fd')!;
    expect(esaf.tenureDays).toBe(800);
    expect(esaf.tenureFromMonths).toBe(26);
    expect(offers.find((o) => o.bank === 'Equitas' && o.product === 'fd')!.tenureFromMonths).toBe(
      36,
    );
  });
  it('handles a bare range, a trailing comma and a single up-to slab', () => {
    const eq = offers.filter((o) => o.bank === 'Equitas' && o.product === 'savings');
    expect(eq[2]).toMatchObject({ rate: 0.06, balanceFrom: 500_000, balanceTo: 1_000_000 });
    expect(offers.filter((o) => o.bank === 'ESAF' && o.product === 'savings')).toHaveLength(3);
    expect(offers.filter((o) => o.bank === 'HDFC' && o.product === 'savings')).toEqual([
      expect.objectContaining({ rate: 0.03, balanceFrom: null, balanceTo: 5_000_000 }),
    ]);
  });
  it('reports what it cannot read instead of guessing', () => {
    expect(problems.some((p) => /Equitas.*5-10lk/.test(p))).toBe(false);
    const bad = parseRateNotes('Foo Bank - Saving [abc], NRE FD[7% -sometime]\nnonsense');
    expect(bad.offers).toEqual([]);
    expect(bad.problems.length).toBeGreaterThanOrEqual(3);
    expect(parseRateNotes('X - FD[40%-1yr]').problems[0]).toMatch(/looks wrong/);
  });
});

const offer = (o: Partial<RateOffer>): RateOffer => ({
  id: 'x',
  bank: 'Jana Small Finance Bank',
  product: 'savings',
  accountKind: 'any',
  tenureFrom: 0,
  tenureTo: 0,
  rate: 0.025,
  conditions: null,
  sourceKind: 'manual',
  checkedOn: '2026-10-20',
  ...o,
});

describe('savingsRateFor', () => {
  const offers = [
    offer({ rate: 0.025, balanceTo: 100_000 }),
    offer({ rate: 0.035, balanceFrom: 100_000, balanceTo: 500_000 }),
    offer({ rate: 0.07, balanceFrom: 5_000_000 }),
  ];
  it('picks the slab the balance falls in, matching the bank by name', () => {
    expect(savingsRateFor(offers, 'Jana Bank', 'NRE', 50_000)!.rate).toBe(0.025);
    expect(savingsRateFor(offers, 'Jana Bank', 'NRE', 100_000)!.rate).toBe(0.025);
    expect(savingsRateFor(offers, 'Jana Bank', 'NRE', 250_000)!.rate).toBe(0.035);
    expect(savingsRateFor(offers, 'Jana Bank', 'NRE', 9_000_000)!.rate).toBe(0.07);
  });
  it('is null when the balance sits in a gap, or the bank has no rate', () => {
    expect(savingsRateFor(offers, 'Jana Bank', 'NRE', 2_000_000)).toBeNull();
    expect(savingsRateFor(offers, 'Other Bank', 'NRE', 10)).toBeNull();
  });
});

describe('labels', () => {
  it('describes slabs and terms', () => {
    expect(slabText({ balanceTo: 100_000 })).toBe('up to ₹1 L');
    expect(slabText({ balanceFrom: 100_000, balanceTo: 500_000 })).toBe('₹1 L to ₹5 L');
    expect(slabText({ balanceFrom: 5_000_000 })).toBe('above ₹50 L');
    expect(slabText({})).toBeNull();
    expect(tenureText({ tenureFrom: 24, tenureTo: 24 })).toBe('2 yr');
    expect(tenureText({ tenureFrom: 30, tenureTo: 30 })).toBe('2.5 yr');
    expect(tenureText({ tenureFrom: 26, tenureTo: 26, tenureDays: 800 })).toBe(
      '800 days (2.2 yrs)',
    );
  });
});
