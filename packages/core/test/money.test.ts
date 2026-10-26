import { describe, expect, it } from 'vitest';
import { formatInr, formatInrCompact, round2, sumExact } from '../src/money';

describe('money', () => {
  it('sums without floating-point drift', () => {
    expect(0.1 + 0.2).not.toBe(0.3);
    expect(sumExact([0.1, 0.2])).toBe(0.3);
    expect(sumExact(Array(1000).fill(0.01))).toBe(10);
  });
  it('rounds half up to 2 dp', () => {
    expect(round2(1.005)).toBe(1.01);
    expect(round2(-2.345)).toBe(-2.35);
  });
  it('uses Indian digit grouping', () => {
    expect(formatInr(19_179_860)).toBe('₹1,91,79,860');
    expect(formatInr(1234.5, { decimals: 2 })).toBe('₹1,234.50');
    expect(formatInr(-4_654_533)).toBe('₹-46,54,533');
  });
  it('compacts to lakh and crore', () => {
    expect(formatInrCompact(19_179_860)).toBe('₹1.92 Cr');
    expect(formatInrCompact(465_453)).toBe('₹4.65 L');
    expect(formatInrCompact(9_999)).toBe('₹9,999');
    expect(formatInrCompact(-250_000)).toBe('-₹2.50 L');
  });
});
