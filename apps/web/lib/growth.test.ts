import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, type RateHolding, type RateOffer } from '@fwos/core';
import { workHoldings, workMoves, type GrowthAsset } from './growth';

const asset = (
  o: Partial<GrowthAsset> & Pick<GrowthAsset, 'id' | 'type' | 'value'>,
): GrowthAsset => ({
  name: o.id,
  ownerId: 'r',
  currency: 'INR',
  accountKind: null,
  bank: 'Bank',
  ownRate: null,
  listedRate: null,
  ...o,
});

const rateHolding = (
  o: Partial<RateHolding> & Pick<RateHolding, 'assetId' | 'product' | 'current' | 'rate'>,
): RateHolding => ({
  ownerId: 'r',
  ownerName: 'Rupash',
  bank: 'HDFC',
  kind: 'NRO',
  joint: false,
  maturityOn: null,
  needsConfirmation: false,
  ...o,
});

describe('workHoldings: the rate each holding earns now', () => {
  const rows = workHoldings({
    assets: [
      asset({
        id: 'nro',
        type: 'bank_account',
        accountKind: 'NRO',
        value: 500_000,
        listedRate: 0.03,
      }),
      asset({ id: 'fd', type: 'fixed_deposit', accountKind: 'NRE', value: 1_000_000 }),
      asset({ id: 'mf', type: 'mutual_fund', value: 800_000 }),
      asset({ id: 'mf2', type: 'mutual_fund', value: 100_000 }),
      asset({ id: 'home', type: 'property', value: 2_500_000 }),
      asset({ id: 'loan', type: 'receivable', value: 200_000 }),
      asset({ id: 'sgd', type: 'bank_account', currency: 'SGD', value: 300_000 }),
    ],
    ownerName: new Map([['r', 'Rupash']]),
    rateHoldings: [
      rateHolding({ assetId: 'fd', product: 'fd', current: 1_000_000, rate: 0.0725, kind: 'NRE' }),
    ],
    funds: new Map([
      ['mf', { xirr: 0.134, monthly: 10_000 }],
      ['mf2', { xirr: null, monthly: 0 }],
    ]),
    config: {
      ...DEFAULT_CONFIG,
      estimates: { ...DEFAULT_CONFIG.estimates, assumedGrowthProperty: 0.05 },
    },
    longRunEquity: 0.1,
  });
  const by = Object.fromEntries(rows.map((r) => [r.id, r]));

  it('savings: the rate list, with NRO tax; deposits: their own rate, NRE tax-free', () => {
    expect(by.nro).toMatchObject({
      rate: 0.03,
      taxRate: DEFAULT_CONFIG.rates.nroTaxRate,
      kind: 'cash',
    });
    expect(by.fd).toMatchObject({ rate: 0.0725, taxRate: 0, kind: 'fd' });
  });
  it('funds: their own return and SIP, else the plan’s long-run return', () => {
    expect(by.mf).toMatchObject({ rate: 0.134, monthly: 10_000 });
    expect(by.mf2!.rate).toBe(0.1);
    expect(by.mf2!.rateBasis).toContain('long-run');
  });
  it('property grows as Settings assume; money lent and foreign cash with no rate earn nothing', () => {
    expect(by.home!.rate).toBe(0.05);
    expect(by.loan).toMatchObject({ rate: 0, type: 'Money lent' });
    expect(by.sgd!.rate).toBe(0);
  });
});

describe('workMoves: savings above the buffer can go into a deposit that pays more', () => {
  const offers: RateOffer[] = [
    {
      bank: 'RBL',
      product: 'fd',
      accountKind: 'NRO',
      tenureFromMonths: 12,
      tenureToMonths: 24,
      rate: 0.075,
      checkedOn: '2026-10-25',
    } as unknown as RateOffer,
  ];
  const moves = workMoves({
    rateHoldings: [
      rateHolding({ assetId: 'nro', product: 'savings', current: 900_000, rate: 0.03 }),
    ],
    offers,
    config: DEFAULT_CONFIG,
    today: '2026-10-29',
  });
  it('keeps the savings buffer and names the deposit, the amount and the yearly gain', () => {
    expect(moves).toHaveLength(1);
    // what is above the buffer, up to the insurance limit at the new bank
    expect(moves[0]!.amount).toBe(
      Math.min(
        900_000 - DEFAULT_CONFIG.rates.savingsBuffer,
        DEFAULT_CONFIG.deposits.insuranceLimit,
      ),
    );
    expect(moves[0]!.text).toContain('to a deposit at RBL');
    expect(moves[0]!.annualGain).toBeGreaterThan(0);
  });
});
