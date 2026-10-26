import { describe, expect, it } from 'vitest';
import { capacityKeyFor, capacityLabel, dicgcPosition, partnerMissing } from '../src/dicgc';

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

describe('cover by ownership name, as written', () => {
  const dep = (id: string, key: string, amt = 500_000) => ({
    id,
    bankId: 'esaf',
    capacityKey: key,
    amountIncludingInterest: amt,
  });
  const R = 'rupash';
  const G = 'ragini';
  it('insures Rupash, Ragini, Rupash & Ragini and Ragini & Rupash separately: 4 × the limit', () => {
    const keys = [
      capacityKeyFor({ ownerId: R, isJoint: false }),
      capacityKeyFor({ ownerId: G, isJoint: false }),
      capacityKeyFor({ ownerId: R, isJoint: true, jointHolderId: G }),
      capacityKeyFor({ ownerId: G, isJoint: true, jointHolderId: R }),
    ];
    expect(new Set(keys).size).toBe(4);
    const r = dicgcPosition(
      keys.map((k, i) => dep(String(i), k, 800_000)),
      500_000,
    );
    expect(r.insured).toBe(2_000_000);
    expect(r.uninsured).toBe(1_200_000);
    expect(r.rows).toHaveLength(4);
  });
  it('does not merge A & B with B & A, but does merge two deposits both in A & B', () => {
    const ab = capacityKeyFor({ ownerId: R, isJoint: true, jointHolderId: G });
    const ba = capacityKeyFor({ ownerId: G, isJoint: true, jointHolderId: R });
    const split = dicgcPosition([dep('1', ab), dep('2', ba)], 500_000);
    expect(split.insured).toBe(1_000_000);
    const same = dicgcPosition([dep('1', ab), dep('2', ab)], 500_000);
    expect(same.rows).toHaveLength(1);
    expect(same.insured).toBe(500_000);
    expect(same.uninsured).toBe(500_000);
  });
  it('is not joint when the flag is off, even if a partner is recorded', () => {
    expect(capacityKeyFor({ ownerId: R, isJoint: false, jointHolderId: G })).toBe('single:rupash');
  });
  it('labels names as written and marks a missing partner', () => {
    const names = { rupash: 'Rupash', ragini: 'Ragini' };
    expect(capacityLabel('single:rupash', names)).toBe('Rupash');
    expect(capacityLabel('joint:ragini+rupash', names)).toBe('Ragini & Rupash');
    expect(capacityLabel('joint:rupash+?', names)).toBe('Rupash & (partner not set)');
    expect(partnerMissing('joint:rupash+?')).toBe(true);
    expect(partnerMissing('joint:rupash+ragini')).toBe(false);
  });
});
