import { describe, expect, it } from 'vitest';
import { fundTaxClass } from '../src/fund-class';

describe('fundTaxClass from the AMFI category', () => {
  it('treats equity, arbitrage and aggressive hybrid as equity-oriented', () => {
    for (const c of [
      'Equity Scheme - Small Cap Fund',
      'Hybrid Scheme - Arbitrage Fund',
      'Hybrid Scheme - Aggressive Hybrid Fund',
      'Other Scheme - Index Funds',
    ])
      expect(fundTaxClass('X', c)).toMatchObject({
        class: 'equity',
        harvestable: true,
        certain: true,
      });
  });
  it('leaves out debt, international, gold and plain hybrids', () => {
    expect(fundTaxClass('X', 'Debt Scheme - Liquid Fund').class).toBe('debt_slab');
    expect(fundTaxClass('X', 'Other Scheme - FoF Overseas').class).toBe('other_long');
    expect(fundTaxClass('X', 'Other Scheme - Gold ETF').class).toBe('other_long');
    expect(fundTaxClass('X', 'Hybrid Scheme - Conservative Hybrid Fund').class).toBe('debt_slab');
    expect(fundTaxClass('X', 'Hybrid Scheme - Multi Asset Allocation').class).toBe('mixed');
    expect(fundTaxClass('X', 'Debt Scheme - Gilt Fund').harvestable).toBe(false);
  });
});

describe('fundTaxClass from the name alone', () => {
  it('recognises the funds in a typical portfolio, and says it is a guess', () => {
    for (const n of [
      'Quant Small Cap Fund Growth Direct Plan',
      'Axis Bluechip Fund Growth',
      'Kotak Small Cap Growth',
      'UTI Nifty 50 Index Fund',
    ]) {
      const c = fundTaxClass(n);
      expect(c.class).toBe('equity');
      expect(c.certain).toBe(false);
    }
  });
  it('does not mistake arbitrage for debt, or a US fund for equity', () => {
    expect(fundTaxClass('Kotak Equity Arbitrage Fund').class).toBe('equity');
    expect(fundTaxClass('Motilal Oswal Nasdaq 100 FoF').class).toBe('other_long');
    expect(fundTaxClass('HDFC Liquid Fund').class).toBe('debt_slab');
    expect(fundTaxClass('SBI Gold Fund').class).toBe('other_long');
  });
  it('marks ELSS with its lock-in', () => {
    expect(fundTaxClass('Axis Long Term Equity Fund ELSS').lockInMonths).toBe(36);
    expect(fundTaxClass('Quant Small Cap Fund').lockInMonths).toBe(0);
  });
  it('says so when it cannot tell', () => {
    expect(fundTaxClass('Mystery Scheme')).toMatchObject({ class: 'unknown', harvestable: false });
  });
});
