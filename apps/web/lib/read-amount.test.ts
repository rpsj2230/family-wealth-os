import { describe, expect, it } from 'vitest';
import { readAmount } from './read-amount';

describe('readAmount', () => {
  it('reads plain numbers, grouped numbers and lakh or crore words', () => {
    expect(readAmount('2500000')).toBe(2_500_000);
    expect(readAmount('₹25,00,000')).toBe(2_500_000);
    expect(readAmount('25 lakh')).toBe(2_500_000);
    expect(readAmount('1.5 cr')).toBe(15_000_000);
  });
  it('treats nothing, zero and nonsense as no amount', () => {
    expect(readAmount('')).toBe(0);
    expect(readAmount(undefined)).toBe(0);
    expect(readAmount('0')).toBe(0);
    expect(readAmount('abc')).toBe(0);
    expect(readAmount('-5')).toBe(0);
  });
});
