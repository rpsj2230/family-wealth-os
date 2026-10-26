import { describe, expect, it } from 'vitest';
import { dicgcPosition } from '../src/dicgc';

describe('dicgcPosition', () => {
  it('aggregates single-name deposits across NRE and NRO at the same bank', () => {
    const r = dicgcPosition(
      [
        {
          id: 'nre',
          bankId: 'esaf',
          capacityKey: 'single:rupash',
          amountIncludingInterest: 1_000_000,
        },
        {
          id: 'nro',
          bankId: 'esaf',
          capacityKey: 'single:rupash',
          amountIncludingInterest: 500_000,
        },
      ],
      500_000,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.insured).toBe(500_000);
    expect(r.uninsured).toBe(1_000_000);
  });

  it('treats joint accounts as a separate capacity', () => {
    const r = dicgcPosition(
      [
        { id: 'a', bankId: 'esaf', capacityKey: 'single:rupash', amountIncludingInterest: 500_000 },
        {
          id: 'b',
          bankId: 'esaf',
          capacityKey: 'joint:rupash+ragini',
          amountIncludingInterest: 500_000,
        },
      ],
      500_000,
    );
    expect(r.insured).toBe(1_000_000);
    expect(r.uninsured).toBe(0);
  });

  it('does not combine different banks', () => {
    const r = dicgcPosition(
      [
        { id: 'a', bankId: 'yes', capacityKey: 'single:rupash', amountIncludingInterest: 500_000 },
        { id: 'b', bankId: 'rbl', capacityKey: 'single:rupash', amountIncludingInterest: 500_000 },
      ],
      500_000,
    );
    expect(r.uninsured).toBe(0);
  });

  it('counts accrued interest: a ₹5 L principal deposit is partly uninsured once interest accrues', () => {
    const r = dicgcPosition(
      [
        {
          id: 'a',
          bankId: 'equitas',
          capacityKey: 'single:viraj',
          amountIncludingInterest: 520_000,
        },
      ],
      500_000,
    );
    expect(r.uninsured).toBe(20_000);
    expect(r.byBank.equitas).toEqual({ total: 520_000, uninsured: 20_000 });
  });

  it('uses the limit as a parameter and validates input', () => {
    expect(
      dicgcPosition(
        [{ id: 'a', bankId: 'x', capacityKey: 'k', amountIncludingInterest: 800_000 }],
        1_000_000,
      ).uninsured,
    ).toBe(0);
    expect(() => dicgcPosition([], 0)).toThrow();
    expect(() =>
      dicgcPosition(
        [{ id: 'a', bankId: 'x', capacityKey: 'k', amountIncludingInterest: -1 }],
        500_000,
      ),
    ).toThrow();
  });
});
