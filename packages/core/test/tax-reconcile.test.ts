import { describe, expect, it } from 'vitest';
import { reconcileTax, type ReconcileInput } from '../src/tax-reconcile';

const base = (o: Partial<ReconcileInput> = {}): ReconcileInput => ({
  form26as: null,
  ais: null,
  computed: {
    fdInterestTaxable: 200_000,
    fdInterestNre: 100_000,
    interestTdsExpected: 62_400,
    harvestTds: 15_000,
    fundSaleProceeds: 400_000,
  },
  ...o,
});
const f = (totalTds: number) => ({
  totalTds,
  deductors: [
    {
      name: 'SAMPLE BANK LTD',
      tan: 'MUMS12345A',
      tax: totalTds,
      txns: [{ section: '194A', tax: totalTds }],
    },
  ],
  taxPaid: [{ amount: 5000 }],
});

describe('reconcileTax', () => {
  it('says ok when the tax credited is what was expected', () => {
    const r = reconcileTax(base({ form26as: f(77_400) }));
    expect(r[0]).toMatchObject({ level: 'ok' });
    expect(r.some((x) => /Deductors in Form 26AS/.test(x.text))).toBe(true);
  });
  it('flags tax credited that is less or more than expected', () => {
    expect(reconcileTax(base({ form26as: f(40_000) }))[0]).toMatchObject({
      level: 'check',
      text: expect.stringContaining('less than expected'),
    });
    expect(reconcileTax(base({ form26as: f(120_000) }))[0]).toMatchObject({
      level: 'check',
      text: expect.stringContaining('more than expected'),
    });
  });
  it('compares AIS interest and fund sales', () => {
    const ok = reconcileTax(
      base({ ais: { byCategory: { interest_deposit: 300_000, mf_redemption: 401_000 } } }),
    );
    expect(ok.map((x) => x.level)).toEqual(['ok', 'ok']);
    const low = reconcileTax(
      base({ ais: { byCategory: { interest_deposit: 100_000, mf_redemption: 100_000 } } }),
    );
    expect(low.filter((x) => x.level === 'check')).toHaveLength(2);
  });
  it('mentions dividends and invites an upload when there is nothing', () => {
    expect(
      reconcileTax(base({ ais: { byCategory: { dividend: 800 } } })).some((x) =>
        /dividends/.test(x.text),
      ),
    ).toBe(true);
    expect(reconcileTax(base())[0]!.text).toMatch(/Upload/);
  });
});
