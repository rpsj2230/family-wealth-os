import { describe, expect, it } from 'vitest';
import { bankGrowth, bankPosition, depositRates } from '../src/bank-growth';
import { capitalLedger, wealthMovement } from '../src/capital';
import { attachProceeds } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';

const TODAY = '2026-10-27';
const cfg: PositionConfig = {
  today: TODAY,
  savingsRate: 0.04,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
};
const base = (
  o: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'r',
  status: 'active',
  name: o.assetId,
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: [],
  fd: null,
  fund: null,
  institutionId: 'bank',
  ...o,
});
const rec = (date: string, amount: number) => ({ date, amount, currency: 'INR', fxRate: null });
const deposit = base({
  assetId: 'fd1',
  type: 'fixed_deposit',
  fd: {
    principal: 1_000_000,
    rate: 0.07,
    bookedOn: '2025-04-01',
    maturityOn: '2027-04-01',
    compounding: 'simple',
    bankMaturityAmount: null,
    endedOn: null,
  },
});
const savings = base({
  assetId: 'sb',
  type: 'bank_account',
  records: [rec('2025-04-01', 500_000)],
});
const lent = base({ assetId: 'lent', type: 'receivable', records: [rec('2025-04-01', 200_000)] });
const spouse = base({
  assetId: 'sb2',
  type: 'bank_account',
  ownerId: 'g',
  records: [rec('2025-04-01', 100_000)],
});
const all: PositionInput = {
  assets: attachProceeds([deposit, savings, lent, spouse], cfg),
  config: cfg,
};

describe('bankGrowth', () => {
  it('keeps the bank holdings only, and one person’s when asked', () => {
    expect(bankPosition(all).assets.map((a) => a.assetId)).toEqual(['fd1', 'sb', 'sb2']);
    expect(bankPosition(all, 'r').assets.map((a) => a.assetId)).toEqual(['fd1', 'sb']);
  });

  it('earns the same interest this year as the whole-family ledger, by kind', () => {
    const banks = bankPosition(all);
    const value = (id: string) => (id === 'fd1' ? 1_000_000 * (1 + 0.07 * (574 / 365)) : 0); // not used for the ledger
    const g = bankGrowth({
      position: banks,
      moves: [],
      deposits: [{ principal: 1_000_000, bookedOn: '2025-04-01', value: value('fd1') }],
      fdNow: value('fd1'),
      cashNow: 600_000,
    });
    const family = wealthMovement(capitalLedger({ position: all, moves: [] }), 'fy', TODAY);
    expect(g.fyStart).toBe('2026-04-01');
    expect(g.interestFy!.deposits).toBeCloseTo(family.figures!.earnings.deposits, 6);
    expect(g.interestFy!.savings).toBeCloseTo(family.figures!.earnings.savings, 6);
    expect(g.interestFy!.total).toBeCloseTo(g.interestFy!.deposits + g.interestFy!.savings, 6);
    // the deposits' XIRR is their simple 7% made yearly; savings earn about the 4% assumed
    expect(g.fd!.rate).toBeGreaterThan(0.065);
    expect(g.fd!.rate).toBeLessThan(0.075);
    expect(g.savings!.rate).toBeGreaterThan(0.03);
    expect(g.savings!.rate).toBeLessThan(0.05);
    // the two together, weighted by value, sit between them
    expect(g.banks!.rate).toBeGreaterThan(g.savings!.rate);
    expect(g.banks!.rate).toBeLessThan(g.fd!.rate);
  });
});

describe('depositRates', () => {
  it('weights each rate by principal and takes tax off NRO only', () => {
    const r = depositRates(
      [
        { principal: 300, rate: 0.08, kind: 'NRE' },
        { principal: 100, rate: 0.07, kind: 'NRE' },
        { principal: 100, rate: 0.075, kind: 'NRO' },
        { principal: 0, rate: 0.09, kind: 'NRO' },
      ],
      0.3,
    );
    expect(r.all).toBeCloseTo((24 + 7 + 7.5) / 500, 10);
    expect(r.nre).toEqual({ rate: (24 + 7) / 400, principal: 400, count: 2 });
    expect(r.nro!.count).toBe(1);
    expect(r.nro!.afterTax).toBeCloseTo(0.075 * 0.7, 10);
    expect(depositRates([], 0.3)).toEqual({ all: null, nre: null, nro: null });
  });
});
