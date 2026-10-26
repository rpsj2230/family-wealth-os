import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { planOptions } from '../src/placement-options';
import type { RateHolding, RateOffer } from '../src/rates';

const prefs = DEFAULT_CONFIG.rates;
const LIMIT = 500_000;
const today = '2026-10-26';

const fd = (
  bank: string,
  months: number,
  rate: number,
  extra: Partial<RateOffer> = {},
): RateOffer => ({
  id: `${bank}-fd-${months}`,
  bank,
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: months,
  tenureTo: months,
  rate,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: today,
  ...extra,
});
const sv = (bank: string, rate: number): RateOffer => ({
  id: `${bank}-sv`,
  bank,
  product: 'savings',
  accountKind: 'NRE',
  tenureFrom: 0,
  tenureTo: 0,
  rate,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: today,
});

const offers: RateOffer[] = [
  sv('Alpha Bank', 0.035),
  sv('Beta Bank', 0.05),
  fd('Alpha Bank', 12, 0.07),
  fd('Alpha Bank', 24, 0.072),
  fd('Beta Bank', 6, 0.065),
  fd('Beta Bank', 12, 0.0725),
  fd('Gamma Bank', 12, 0.075),
  fd('Gamma Bank', 36, 0.077),
  fd('Delta Bank', 24, 0.0705),
  fd('Delta Bank', 60, 0.079),
  fd('Epsilon Bank', 12, 0.071),
  fd('Epsilon Bank', 36, 0.0735),
];

const run = (amount: number, o: Partial<Parameters<typeof planOptions>[0]> = {}) =>
  planOptions({
    amount,
    kind: 'NRE',
    ownerId: 'p1',
    holdings: [],
    offers,
    prefs,
    limit: LIMIT,
    today,
    baselineRate: 0.03,
    ...o,
  });

const held = (bank: string, current: number, extra: Partial<RateHolding> = {}): RateHolding => ({
  assetId: `${bank}-${current}`,
  ownerId: 'p1',
  ownerName: 'P1',
  bank,
  product: 'fd',
  kind: 'NRE',
  joint: false,
  current,
  rate: 0.07,
  maturityOn: '2027-06-01',
  needsConfirmation: false,
  ...extra,
});

describe('planOptions', () => {
  it('gives five options and recommends one that is not Highest return', () => {
    const r = run(1_000_000);
    expect(r.options.map((o) => o.key)).toEqual([
      'highest',
      'balanced',
      'ladder',
      'safest',
      'flexible',
    ]);
    expect(r.options.filter((o) => o.recommended)).toHaveLength(1);
    expect(r.recommendedKey).not.toBe('highest');
    expect(r.headline).toContain('a year after tax');
    expect(r.reasoning.length).toBeGreaterThan(2);
  });

  it('puts money in deposits, not in 3.5% savings, when deposits pay more', () => {
    const r = run(1_000_000);
    const balanced = r.options.find((o) => o.key === 'balanced')!;
    const savings = balanced.lines
      .filter((l) => l.product === 'savings')
      .reduce((s, l) => s + l.amount, 0);
    expect(savings).toBeLessThanOrEqual(1_000_000 * prefs.liquidShare + 1);
    expect(balanced.blendedNet).toBeGreaterThan(0.065);
    const highest = r.options.find((o) => o.key === 'highest')!;
    expect(highest.totalAnnual).toBeGreaterThanOrEqual(balanced.totalAnnual);
    expect(highest.lines[0]!.net).toBe(Math.max(...highest.lines.map((l) => l.net)));
  });

  it('never goes past the insurance room, counting what is already there and a buffer for interest', () => {
    const r = run(2_000_000, { holdings: [held('Gamma Bank', 300_000)] });
    for (const o of r.options) {
      const at = new Map<string, number>();
      for (const l of o.lines) at.set(l.bank, (at.get(l.bank) ?? 0) + l.amount);
      for (const [bank, amt] of at) {
        const existing = bank === 'Gamma Bank' ? 300_000 : 0;
        expect(amt + existing).toBeLessThanOrEqual(LIMIT * (1 - prefs.insuranceBuffer) + 1);
      }
    }
  });

  it('keeps every bank within its share in the balanced, ladder and safest options', () => {
    const r = run(2_000_000);
    for (const key of ['balanced', 'ladder'] as const) {
      const o = r.options.find((x) => x.key === key)!;
      expect(o.topShare).toBeLessThanOrEqual(prefs.maxBankShare + 1e-9);
    }
    const safest = r.options.find((x) => x.key === 'safest')!;
    expect(safest.topShare).toBeLessThanOrEqual(prefs.safeBankShare + 1e-9);
    expect(safest.banks).toBeGreaterThanOrEqual(4);
  });

  it('ladder uses several terms', () => {
    const r = run(2_000_000);
    const ladder = r.options.find((o) => o.key === 'ladder')!;
    const terms = new Set(ladder.lines.filter((l) => l.product === 'fd').map((l) => l.termMonths));
    expect(terms.size).toBeGreaterThanOrEqual(2);
  });

  it('keeps the flexible option mostly in savings with short deposits', () => {
    const r = run(1_000_000);
    const f = r.options.find((o) => o.key === 'flexible')!;
    expect(f.liquidNow).toBeGreaterThanOrEqual(1_000_000 * prefs.flexibleLiquidShare - 1);
    expect(f.longestTerm ?? 0).toBeLessThanOrEqual(prefs.flexibleTermMonths);
  });

  it('says what is missing when there are no deposit rates, and still places the money', () => {
    const r = run(500_000, { offers: offers.filter((o) => o.product === 'savings') });
    expect(r.gaps.join(' ')).toContain('No NRE fixed-deposit rates are on file');
    expect(r.options.find((o) => o.key === 'balanced')!.placed).toBeGreaterThan(0);
    expect(r.reasoning.join(' ')).toContain('savings-only');
  });

  it('reports what does not fit instead of hiding it', () => {
    const r = run(50_000_000);
    const b = r.options.find((o) => o.key === 'balanced')!;
    expect(b.unplaced).toBeGreaterThan(0);
    expect(b.checks.allPlaced).toBe(false);
    expect(b.cautions.join(' ')).toContain('could not be placed');
  });

  it('leaves out a bank that is outside deposit insurance', () => {
    const r = run(1_000_000, { holdings: [held('Gamma Bank', 100_000, { insured: false })] });
    for (const o of r.options) expect(o.lines.some((l) => l.bank === 'Gamma Bank')).toBe(false);
  });

  it('uses after-tax rates for NRO money', () => {
    const nro = offers.map((o) => ({ ...o, accountKind: 'NRO' as const }));
    const r = run(1_000_000, { kind: 'NRO', offers: nro });
    const l = r.options[0]!.lines[0]!;
    expect(l.net).toBeCloseTo(l.rate * (1 - prefs.nroTaxRate), 8);
  });

  it('flags a stale rate', () => {
    const old = offers.map((o) => ({ ...o, checkedOn: '2026-01-01' }));
    const r = run(1_000_000, { offers: old });
    expect(r.options[1]!.cautions.join(' ')).toContain('checked over');
  });
});
