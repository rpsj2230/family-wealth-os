import { describe, expect, it } from 'vitest';
import type { CasTxn } from '@fwos/ingest';
import { fundLedger } from './fund-ledger';

const tx = (
  date: string,
  kind: CasTxn['kind'],
  units: number,
  amount: number,
  balance: number | null,
): CasTxn => ({
  date,
  kind,
  description: '',
  amount,
  units,
  nav: Math.abs(amount / units),
  balance,
});

describe('fundLedger', () => {
  const txns = [
    tx('2024-01-10', 'purchase', 100, 10_000, 100),
    tx('2024-06-10', 'sip', 50, 6_000, 150),
    tx('2025-03-10', 'redeem', -120, -18_000, 30),
  ];
  it('sells the oldest units first and keeps the rest as lots', () => {
    const l = fundLedger({ txns, costValue: null, unitsHeld: 30 });
    expect(l.reconciled).toBe(true);
    expect(l.lots).toHaveLength(1);
    expect(l.lots[0]!.acquiredOn).toBe('2024-06-10');
    expect(l.lots[0]!.units).toBeCloseTo(30, 6);
    expect(l.lots[0]!.cost).toBeCloseTo(3_600, 6);
    expect(l.realised).toHaveLength(2);
    expect(l.realised[0]).toMatchObject({ acquiredOn: '2024-01-10', units: 100, cost: 10_000 });
  });
  it('relies on the lots only when they add up to the units held', () => {
    const noBalance = txns.map((t) => ({ ...t, balance: null }));
    expect(fundLedger({ txns: noBalance, costValue: null, unitsHeld: 500 }).reconciled).toBe(false);
    expect(fundLedger({ txns: noBalance, costValue: null, unitsHeld: 30 }).reconciled).toBe(true);
    // the statement's own closing balance decides when it gives one
    expect(fundLedger({ txns, costValue: null, unitsHeld: 500 }).reconciled).toBe(true);
  });
  it('has nothing without transactions', () => {
    expect(fundLedger({ txns: [], costValue: 1000, unitsHeld: 5 })).toEqual({
      lots: [],
      realised: [],
      reconciled: false,
    });
  });
  it('marks units from before the statement', () => {
    const l = fundLedger({
      txns: [tx('2025-01-10', 'purchase', 10, 1_000, 110)],
      costValue: 11_000,
      unitsHeld: 110,
    });
    expect(l.lots[0]!.acquiredOn).toBe('1900-01-01');
    expect(l.lots[0]!.cost).toBeCloseTo(10_000, 6);
  });
});
