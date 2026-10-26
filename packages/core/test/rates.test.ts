import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import {
  afterTaxRate,
  compareHoldings,
  exposureByBank,
  placeNewMoney,
  rankOffers,
  sameBank,
  type RateHolding,
  type RateOffer,
} from '../src/rates';

const prefs = { ...DEFAULT_CONFIG.rates, minAnnualGain: 1000 };
const T = '2026-10-26';
const offer = (o: Partial<RateOffer> & { id: string; bank: string }): RateOffer => ({
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 12,
  tenureTo: 24,
  rate: 0.07,
  conditions: null,
  sourceKind: 'manual',
  checkedOn: '2026-10-20',
  ...o,
});
const hold = (o: Partial<RateHolding> & { assetId: string }): RateHolding => ({
  ownerId: 'r',
  ownerName: 'Rupash',
  bank: 'Alpha Bank',
  product: 'fd',
  kind: 'NRE',
  joint: false,
  current: 1_000_000,
  rate: 0.065,
  maturityOn: '2026-12-01',
  needsConfirmation: false,
  ...o,
});

describe('afterTaxRate and rankOffers', () => {
  it('taxes NRO interest and leaves NRE alone', () => {
    expect(afterTaxRate(0.08, 'NRE', 0.3)).toBe(0.08);
    expect(afterTaxRate(0.08, 'NRO', 0.3)).toBeCloseTo(0.056, 6);
  });
  it('ranks by after-tax rate, so a lower NRE rate can beat a higher NRO rate', () => {
    const offers = [
      offer({ id: '1', bank: 'A', accountKind: 'NRO', rate: 0.08 }),
      offer({ id: '2', bank: 'B', accountKind: 'NRO', rate: 0.07 }),
    ];
    expect(
      rankOffers(offers, { product: 'fd', kind: 'NRO', tenureMonths: 12 }, prefs).map(
        (o) => o.bank,
      ),
    ).toEqual(['A', 'B']);
    const mixed = [
      offer({ id: '3', bank: 'C', accountKind: 'NRE', rate: 0.06 }),
      offer({ id: '4', bank: 'D', accountKind: 'any', rate: 0.058 }),
    ];
    expect(
      rankOffers(mixed, { product: 'fd', kind: 'NRE', tenureMonths: 12 }, prefs)[0]!.bank,
    ).toBe('C');
  });
  it('keeps one offer per bank, the best, and respects the tenure band and the account kind', () => {
    const offers = [
      offer({ id: '1', bank: 'A', rate: 0.07 }),
      offer({ id: '2', bank: 'A', tenureFrom: 12, tenureTo: 24, rate: 0.075 }),
      offer({ id: '3', bank: 'B', tenureFrom: 36, tenureTo: 60, rate: 0.09 }),
      offer({ id: '4', bank: 'C', accountKind: 'NRO', rate: 0.1 }),
    ];
    const r = rankOffers(offers, { product: 'fd', kind: 'NRE', tenureMonths: 12 }, prefs);
    expect(r.map((o) => `${o.bank}:${o.rate}`)).toEqual(['A:0.075']);
  });
  it('recognises the same bank under different spellings', () => {
    expect(sameBank('Jana Small Finance Bank', 'Jana')).toBe(true);
    expect(sameBank('Equitas', 'ESAF')).toBe(false);
  });
});

describe('compareHoldings', () => {
  const offers = [offer({ id: '1', bank: 'Beta Bank', rate: 0.08 })];

  it('suggests moving a deposit that matures soon to a clearly better rate, with the gain', () => {
    const s = compareHoldings([hold({ assetId: 'a' })], offers, prefs, T, 500_000 * 10);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({
      to: 'Beta Bank',
      when: 'at_maturity',
      on: '2026-12-01',
      amount: 1_000_000,
    });
    expect(s[0]!.annualGain).toBeCloseTo(15_000, 0);
    expect(s[0]!.text).toContain('When it matures on 2026-12-01');
  });
  it('never advises breaking a deposit early: far-off maturities are left alone', () => {
    expect(
      compareHoldings(
        [hold({ assetId: 'a', maturityOn: '2028-01-01' })],
        offers,
        prefs,
        T,
        5_000_000,
      ),
    ).toEqual([]);
  });
  it('is silent when the gap or the gain is too small, or the better rate is at the same bank', () => {
    expect(
      compareHoldings([hold({ assetId: 'a', rate: 0.0795 })], offers, prefs, T, 5_000_000),
    ).toEqual([]);
    expect(
      compareHoldings([hold({ assetId: 'a', bank: 'Beta Bank' })], offers, prefs, T, 5_000_000),
    ).toEqual([]);
    expect(
      compareHoldings([hold({ assetId: 'a', current: 10_000 })], offers, prefs, T, 5_000_000),
    ).toEqual([]);
  });
  it('limits the amount to the insurance room at the target bank, counting what is already there', () => {
    const held = [
      hold({ assetId: 'a', current: 1_000_000 }),
      hold({
        assetId: 'b',
        bank: 'Beta Bank',
        product: 'savings',
        current: 300_000,
        rate: 0.03,
        maturityOn: null,
      }),
    ];
    const s = compareHoldings(held, offers, prefs, T, 500_000);
    // Beta already holds 300,000 for this person, so only 200,000 more fits under a 500,000 limit
    expect(s[0]!.amount).toBe(200_000);
    expect(s[0]!.text).toContain('insurance limit');
  });
  it('treats savings above the buffer as movable and compares NRO after tax', () => {
    const sav = [
      offer({ id: 's', bank: 'Gamma', product: 'savings', accountKind: 'NRE', rate: 0.06 }),
    ];
    const s = compareHoldings(
      [hold({ assetId: 'c', product: 'savings', current: 600_000, rate: 0.03, maturityOn: null })],
      sav,
      prefs,
      T,
      5_000_000,
    );
    expect(s[0]!.amount).toBe(500_000); // 600,000 less the buffer of 100,000
    expect(s[0]!.when).toBe('now');
  });
});

describe('placeNewMoney', () => {
  const offers = [
    offer({ id: '1', bank: 'Beta', rate: 0.082 }),
    offer({ id: '2', bank: 'Gamma', rate: 0.08 }),
    offer({ id: '3', bank: 'Delta', rate: 0.075 }),
    offer({ id: '4', bank: 'Beta', product: 'savings', tenureFrom: 0, tenureTo: 0, rate: 0.05 }),
  ];
  const base = {
    kind: 'NRE' as const,
    ownerId: 'r',
    joint: false,
    tenureMonths: 12,
    keepLiquid: 0,
    holdings: [] as RateHolding[],
    offers,
    prefs,
    limit: 500_000,
    today: T,
    baselineRate: 0.03,
  };

  it('spreads money across banks so each stays inside the insurance limit, best rate first', () => {
    const plan = placeNewMoney({ ...base, amount: 1_200_000 });
    expect(plan.placements.map((p) => [p.bank, p.amount])).toEqual([
      ['Beta', 500_000],
      ['Gamma', 500_000],
      ['Delta', 200_000],
    ]);
    expect(plan.unplaced).toBe(0);
    expect(plan.totalAnnual).toBeCloseTo(500_000 * 0.082 + 500_000 * 0.08 + 200_000 * 0.075, 2);
    expect(plan.uplift).toBeGreaterThan(0);
  });
  it('counts what is already at a bank, and says what does not fit', () => {
    const holdings = [hold({ assetId: 'x', bank: 'Beta', current: 400_000 })];
    const plan = placeNewMoney({ ...base, amount: 1_500_000, holdings });
    expect(plan.placements.find((p) => p.bank === 'Beta')!.amount).toBe(100_000);
    expect(plan.unplaced).toBe(400_000);
    expect(plan.notes.join(' ')).toContain('does not fit inside the insurance limit');
  });
  it('keeps the asked amount liquid in a savings account first', () => {
    const plan = placeNewMoney({ ...base, amount: 600_000, keepLiquid: 100_000 });
    expect(plan.placements[0]).toMatchObject({ product: 'savings', bank: 'Beta', amount: 100_000 });
    expect(plan.placements.slice(1).reduce((s, p) => s + p.amount, 0)).toBe(500_000);
  });
  it('uses a separate allowance for a joint capacity', () => {
    const holdings = [hold({ assetId: 'x', bank: 'Beta', current: 500_000, joint: false })];
    const plan = placeNewMoney({ ...base, amount: 400_000, holdings, joint: true });
    expect(plan.placements[0]).toMatchObject({ bank: 'Beta', amount: 400_000 });
  });
  it('says so when no rates are on file instead of inventing a plan', () => {
    const plan = placeNewMoney({ ...base, amount: 100_000, offers: [] });
    expect(plan.placements).toEqual([]);
    expect(plan.notes.join(' ')).toContain('No rates are on file');
  });
  it('exposure sums deposits and savings per bank, person and capacity, ignoring unconfirmed matured deposits', () => {
    const e = exposureByBank([
      hold({ assetId: 'a', current: 100 }),
      hold({ assetId: 'b', current: 50, product: 'savings' }),
      hold({ assetId: 'c', current: 999, needsConfirmation: true }),
    ]);
    expect([...e.values()]).toEqual([150]);
  });
});
