import { describe, expect, it } from 'vitest';
import {
  EMPTY_LEDGER,
  RULES,
  computePosition,
  fyOf,
  isLongTerm,
  rulesFor,
  simulateRedemption,
  suggestHarvest,
  type Lot,
  type TaxRuleSet,
} from '../src/tax';

const lot = (o: Partial<Lot> & { lotId: string }): Lot => ({
  schemeId: 'S',
  ownerId: 'rupash',
  fundClass: 'equity',
  acquiredOn: '2024-01-10',
  units: 100,
  costPerUnit: 100,
  ...o,
});
const SALE = '2026-10-26';
const rule = RULES.find((r) => r.fy === '2026-27')!.equity;

describe('financial year and rules lookup', () => {
  it('maps dates to Indian financial years', () => {
    expect(fyOf('2026-03-31')).toBe('2025-26');
    expect(fyOf('2026-04-01')).toBe('2026-27');
    expect(fyOf('2026-10-26')).toBe('2026-27');
  });
  it('finds rules by date and returns null when none are loaded (never a default)', () => {
    expect(rulesFor('2026-10-26')!.fy).toBe('2026-27');
    expect(rulesFor('2019-10-26')).toBeNull();
  });
  it('flags that the bundled rules are not yet verified against official sources', () => {
    for (const r of RULES) expect(r.verification).not.toBe('primary');
  });
});

describe('holding period', () => {
  it('is long term only when held MORE than 12 months', () => {
    expect(isLongTerm({ acquiredOn: '2025-10-26' }, '2026-10-26', rule)).toBe(false); // exactly 12 months
    expect(isLongTerm({ acquiredOn: '2025-10-26' }, '2026-10-27', rule)).toBe(true);
    expect(isLongTerm({ acquiredOn: '2024-02-29' }, '2025-02-28', rule)).toBe(false);
    expect(isLongTerm({ acquiredOn: '2024-02-29' }, '2025-03-01', rule)).toBe(true);
  });
});

describe('computePosition (one taxpayer, one year)', () => {
  const nocarry = { stcl: 0, ltcl: 0 };
  it('applies the ₹1.25 L allowance to long-term gains only', () => {
    const p = computePosition(0, 300_000, nocarry, rule, 0.04);
    expect(p.exemptionUsed).toBe(125_000);
    expect(p.taxableLtcg).toBe(175_000);
    expect(p.tax).toBeCloseTo(175_000 * 0.125 * 1.04, 6); // 22,750
  });
  it('taxes short-term gains at 20 % with no allowance', () => {
    expect(computePosition(100_000, 0, nocarry, rule, 0.04).tax).toBeCloseTo(
      100_000 * 0.2 * 1.04,
      6,
    );
  });
  it('lets a short-term loss reduce long-term gains, but not the reverse', () => {
    const a = computePosition(-50_000, 200_000, nocarry, rule, 0);
    expect(a.ltcgNet).toBe(150_000);
    const b = computePosition(100_000, -50_000, nocarry, rule, 0);
    expect(b.stcgNet).toBe(100_000); // long-term loss cannot cut short-term gains
    expect(b.lossCarriedOut.ltcl).toBe(50_000);
  });
  it('uses brought-forward losses and reports what is carried out', () => {
    const p = computePosition(10_000, 400_000, { stcl: 30_000, ltcl: 100_000 }, rule, 0);
    expect(p.taxableStcg).toBe(0);
    // STCL: 10k against STCG, 20k against LTCG; LTCL: 100k against LTCG -> 400k-20k-100k = 280k
    expect(p.ltcgNet).toBe(280_000);
    expect(p.taxableLtcg).toBe(155_000);
    expect(p.lossCarriedOut).toEqual({ stcl: 0, ltcl: 0 });
    const c = computePosition(0, 0, { stcl: 30_000, ltcl: 100_000 }, rule, 0);
    expect(c.lossCarriedOut).toEqual({ stcl: 30_000, ltcl: 100_000 });
  });
  it('adds surcharge and cess multiplicatively', () => {
    expect(computePosition(100_000, 0, nocarry, rule, 0.04, 0.1).tax).toBeCloseTo(
      100_000 * 0.2 * 1.1 * 1.04,
      6,
    );
  });
});

describe('simulateRedemption', () => {
  it('long-term gain inside the allowance: no tax due, but a non-resident has TDS deducted and expects a refund', () => {
    const r = simulateRedemption({
      lots: [lot({ lotId: 'A' })],
      units: 100,
      nav: 150,
      saleDate: SALE,
      tdsApplies: true,
    });
    expect(r.status).toBe('ok');
    expect(r.ltcg).toBe(5000);
    expect(r.incrementalTax).toBe(0);
    expect(r.tdsEstimate).toBeCloseTo(5000 * 0.125 * 1.04, 6); // 650
    expect(r.refundExpected).toBeCloseTo(650, 6);
    expect(r.netProceeds).toBeCloseTo(15_000 - 650, 6);
    expect(r.unitsLeft).toBe(0);
  });

  it('short-term gain is taxed at 20% plus cess', () => {
    const r = simulateRedemption({
      lots: [lot({ lotId: 'B', acquiredOn: '2026-06-01' })],
      units: 100,
      nav: 150,
      saleDate: SALE,
    });
    expect(r.slices[0]!.term).toBe('short');
    expect(r.incrementalTax).toBeCloseTo(5000 * 0.2 * 1.04, 6);
  });

  it('redeems oldest lots first, splitting a lot when needed', () => {
    const lots = [
      lot({ lotId: 'new', acquiredOn: '2026-01-05', units: 50, costPerUnit: 140 }),
      lot({ lotId: 'old', acquiredOn: '2023-01-05', units: 80, costPerUnit: 90 }),
    ];
    const r = simulateRedemption({ lots, units: 100, nav: 150, saleDate: SALE });
    expect(r.slices.map((s) => [s.lotId, s.units, s.term])).toEqual([
      ['old', 80, 'long'],
      ['new', 20, 'short'],
    ]);
    expect(r.ltcg).toBeCloseTo(80 * 60, 6);
    expect(r.stcg).toBeCloseTo(20 * 10, 6);
    expect(r.unitsLeft).toBeCloseTo(30, 9);
  });

  it('charges exit load only on units younger than the load period, lot by lot', () => {
    const lots = [
      lot({ lotId: 'old', acquiredOn: '2025-01-01', units: 50 }),
      lot({ lotId: 'young', acquiredOn: '2026-08-01', units: 50 }),
    ];
    const r = simulateRedemption({
      lots,
      units: 100,
      nav: 100,
      saleDate: SALE,
      exitLoad: { days: 365, rate: 0.01 },
    });
    expect(r.slices.find((s) => s.lotId === 'old')!.exitLoad).toBe(0);
    expect(r.slices.find((s) => s.lotId === 'young')!.exitLoad).toBeCloseTo(50, 6); // 1% of 5,000
    expect(r.exitLoad).toBeCloseTo(50, 6);
    expect(r.slices.find((s) => s.lotId === 'young')!.gain).toBeCloseTo(0 - 50, 6); // exit load reduces the gain
  });

  it('keeps taxpayers apart: each PAN gets its own allowance and losses never cross', () => {
    const big = (owner: string) =>
      simulateRedemption({
        lots: [lot({ lotId: owner, ownerId: owner, units: 1000, costPerUnit: 100 })],
        units: 1000,
        nav: 300,
        saleDate: SALE,
      }); // gain 200,000
    const a = big('rupash');
    const b = big('ragini');
    expect(a.incrementalTax).toBeCloseTo((200_000 - 125_000) * 0.125 * 1.04, 6);
    expect(b.incrementalTax).toBe(a.incrementalTax); // her allowance is not reduced by his sale
    expect(() =>
      simulateRedemption({
        lots: [lot({ lotId: 'x', ownerId: 'rupash' }), lot({ lotId: 'y', ownerId: 'ragini' })],
        units: 10,
        nav: 100,
        saleDate: SALE,
      }),
    ).toThrow(/different taxpayers/);
  });

  it('counts gains already realised this year when using the allowance', () => {
    const ledger = { ...EMPTY_LEDGER, ltcgYtd: 100_000 };
    const r = simulateRedemption({
      lots: [lot({ lotId: 'A', units: 1000 })],
      units: 1000,
      nav: 150,
      saleDate: SALE,
      ledger,
    }); // +50,000 -> 150,000 total
    expect(r.after!.taxableLtcg).toBe(25_000);
    expect(r.incrementalTax).toBeCloseTo(25_000 * 0.125 * 1.04, 6);
  });

  it('applies grandfathering to units bought on or before 31 Jan 2018', () => {
    const l = lot({
      lotId: 'G',
      acquiredOn: '2017-06-01',
      costPerUnit: 50,
      fmv20180131PerUnit: 120,
    });
    expect(
      simulateRedemption({ lots: [l], units: 100, nav: 150, saleDate: SALE }).ltcg,
    ).toBeCloseTo(100 * (150 - 120), 6);
    expect(
      simulateRedemption({ lots: [l], units: 100, nav: 100, saleDate: SALE }).ltcg,
    ).toBeCloseTo(100 * (100 - 100), 6); // capped at sale value
  });

  it('refuses rather than guesses: missing year, too many units, debt funds, bad input', () => {
    expect(
      simulateRedemption({
        lots: [lot({ lotId: 'A' })],
        units: 1,
        nav: 100,
        saleDate: '2019-10-26',
      }).status,
    ).toBe('rules_missing');
    expect(
      simulateRedemption({ lots: [lot({ lotId: 'A' })], units: 101, nav: 100, saleDate: SALE })
        .status,
    ).toBe('insufficient_units');
    expect(
      simulateRedemption({
        lots: [lot({ lotId: 'A', fundClass: 'debt_specified' })],
        units: 1,
        nav: 100,
        saleDate: SALE,
      }).status,
    ).toBe('not_modelled');
    expect(
      simulateRedemption({ lots: [lot({ lotId: 'A' })], units: 1, nav: 0, saleDate: SALE }).status,
    ).toBe('invalid_input');
    expect(
      simulateRedemption({ lots: [lot({ lotId: 'A' })], nav: 10, saleDate: SALE }).status,
    ).toBe('invalid_input');
  });

  it('supports redeeming by amount', () => {
    const r = simulateRedemption({
      lots: [lot({ lotId: 'A' })],
      amount: 7500,
      nav: 150,
      saleDate: SALE,
    });
    expect(r.units).toBeCloseTo(50, 9);
  });

  it('uses the rules you pass (rates are data, not code)', () => {
    const custom: TaxRuleSet[] = [{ ...RULES[1]!, equity: { ...RULES[1]!.equity, stcgRate: 0.3 } }];
    const r = simulateRedemption({
      lots: [lot({ lotId: 'B', acquiredOn: '2026-06-01' })],
      units: 100,
      nav: 150,
      saleDate: SALE,
      rules: custom,
    });
    expect(r.incrementalTax).toBeCloseTo(5000 * 0.3 * 1.04, 6);
  });
});

describe('suggestHarvest', () => {
  const lots = [
    lot({ lotId: 'L1', acquiredOn: '2023-01-01', units: 1000, costPerUnit: 100 }),
    lot({ lotId: 'L2', acquiredOn: '2026-08-01', units: 500, costPerUnit: 140 }),
  ];

  it('finds the largest long-term sale that fits inside the allowance and never touches short-term units', () => {
    const h = suggestHarvest({ lots, nav: 200, saleDate: SALE });
    expect(h.status).toBe('ok');
    // gain per unit 100 -> 1,250 units would be needed, but only 1,000 long-term units exist => all 1,000 (gain 100,000 < 125,000)
    expect(h.units).toBeCloseTo(1000, 6);
    expect(h.result!.slices.every((s) => s.term === 'long')).toBe(true);
    expect(h.result!.incrementalTax).toBe(0);
    expect(h.exemptionLeft).toBeCloseTo(25_000, 4);
  });

  it('stops at the allowance when the gain is larger than it', () => {
    const h = suggestHarvest({ lots, nav: 300, saleDate: SALE }); // gain 200 per unit => 125,000 / 200 = 625 units
    expect(h.units).toBeCloseTo(625, 3);
    expect(h.gainRealised).toBeCloseTo(125_000, 1);
    expect(h.futureTaxMayBeAvoided).toBeCloseTo(125_000 * 0.125 * 1.04, 0);
    expect(h.tradeOffs.length).toBeGreaterThan(3);
  });

  it('shrinks the suggestion by the allowance already used this year', () => {
    const h = suggestHarvest({
      lots,
      nav: 300,
      saleDate: SALE,
      ledger: { ...EMPTY_LEDGER, ltcgYtd: 100_000 },
    });
    expect(h.gainRealised).toBeCloseTo(25_000, 1);
  });

  it('says there is nothing to harvest when there are no long-term units or the allowance is gone', () => {
    expect(suggestHarvest({ lots: [lots[1]!], nav: 300, saleDate: SALE }).status).toBe(
      'nothing_to_harvest',
    );
    expect(
      suggestHarvest({
        lots,
        nav: 300,
        saleDate: SALE,
        ledger: { ...EMPTY_LEDGER, ltcgYtd: 125_000 },
      }).status,
    ).toBe('nothing_to_harvest');
    expect(
      suggestHarvest({
        lots: [lot({ lotId: 'loss', units: 100, costPerUnit: 200 })],
        nav: 100,
        saleDate: SALE,
      }).status,
    ).toBe('nothing_to_harvest');
  });

  it('reports the cost of acting for a non-resident (TDS held until a refund)', () => {
    const h = suggestHarvest({ lots, nav: 300, saleDate: SALE, tdsApplies: true });
    expect(h.costOfActing.tdsTiedUpUntilRefund).toBeCloseTo(125_000 * 0.125 * 1.04, 0);
    expect(h.tradeOffs.join(' ')).toMatch(/file a return/);
  });
});
