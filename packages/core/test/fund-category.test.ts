import { describe, expect, it } from 'vitest';
import { amcLabel, fundCategory } from '../src/fund-category';

describe('fundCategory', () => {
  it('reads the official category first', () => {
    const k = (n: string, c: string) => fundCategory(n, c);
    expect(k('X', 'Equity Scheme - Large Cap Fund')).toMatchObject({ key: 'large', certain: true });
    expect(k('X', 'Equity Scheme - Large & Mid Cap Fund').key).toBe('mid');
    expect(k('X', 'Equity Scheme - Small Cap Fund').key).toBe('small');
    expect(k('X', 'Equity Scheme - Flexi Cap Fund').key).toBe('flexi');
    expect(k('X', 'Equity Scheme - Focused Fund').key).toBe('flexi');
    expect(k('X', 'Equity Scheme - ELSS').key).toBe('elss');
    expect(k('X', 'Equity Scheme - Sectoral/Thematic').key).toBe('sector');
    expect(k('X', 'Equity Scheme - Value Fund').key).toBe('other_equity');
    expect(k('X', 'Other Scheme - Index Funds').key).toBe('index');
    expect(k('X', 'Other Scheme - Gold ETF').key).toBe('gold');
    expect(k('X', 'Other Scheme - FoF Overseas').key).toBe('international');
    expect(k('X', 'Debt Scheme - Liquid Fund').key).toBe('debt');
    expect(k('X', 'Hybrid Scheme - Balanced Advantage Fund').key).toBe('hybrid');
    expect(k('X', 'Hybrid Scheme - Arbitrage Fund').key).toBe('hybrid');
    expect(k('X', 'Hybrid Scheme - Conservative Hybrid Fund').key).toBe('debt');
  });

  it('guesses from the name and says it is a guess', () => {
    expect(fundCategory('Sample Small Cap Fund Direct Growth')).toMatchObject({
      key: 'small',
      certain: false,
    });
    expect(fundCategory('Sample Nifty 50 Index Fund').key).toBe('index');
    expect(fundCategory('Sample Liquid Fund').key).toBe('debt');
    expect(fundCategory('Sample Gold Fund').key).toBe('gold');
    expect(fundCategory('Mystery Scheme').key).toBe('unknown');
  });
});

describe('amcLabel', () => {
  it('drops the legal words', () => {
    expect(amcLabel('SBI Mutual Fund')).toBe('SBI');
    expect(amcLabel('Sample Asset Management Company Limited')).toBe('Sample');
    expect(amcLabel(null)).toBeNull();
    expect(amcLabel('')).toBeNull();
  });
});
