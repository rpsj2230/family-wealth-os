import { describe, expect, it } from 'vitest';
import { insuranceRoom, type RateHolding } from '../src/rates';

const h = (o: Partial<RateHolding> & { assetId: string; current: number }): RateHolding => ({
  ownerId: 'rupash',
  ownerName: 'Rupash',
  bank: 'Equitas',
  product: 'savings',
  kind: 'NRE',
  joint: false,
  rate: 0.03,
  maturityOn: null,
  needsConfirmation: false,
  ...o,
});

describe('insuranceRoom', () => {
  it('adds savings and fixed deposits of one bank and name together', () => {
    const r = insuranceRoom(
      [
        h({ assetId: 's', current: 106 }),
        h({ assetId: 'f1', product: 'fd', current: 300_000 }),
        h({ assetId: 'f2', product: 'fd', current: 250_000 }),
      ],
      500_000,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({
      total: 550_106,
      insured: 500_000,
      uninsured: 50_106,
      room: 0,
    });
    expect(r.rows[0]!.parts.map((p) => p.product).sort()).toEqual(['fd', 'fd', 'savings']);
  });

  it('counts A & B and B & A as separate names, and a joint name apart from the single one', () => {
    const r = insuranceRoom(
      [
        h({ assetId: 'a', current: 400_000 }),
        h({ assetId: 'ab', joint: true, jointHolderId: 'ragini', current: 400_000 }),
        h({
          assetId: 'ba',
          ownerId: 'ragini',
          joint: true,
          jointHolderId: 'rupash',
          current: 400_000,
        }),
      ],
      500_000,
    );
    expect(r.rows.map((x) => x.capacityKey).sort()).toEqual([
      'joint:ragini+rupash',
      'joint:rupash+ragini',
      'single:rupash',
    ]);
    expect(r.rows.every((x) => x.uninsured === 0 && x.room === 100_000)).toBe(true);
  });

  it('adds branches under the same bank name and leaves out a bank outside the scheme', () => {
    const r = insuranceRoom(
      [
        h({ assetId: 'x1', bank: 'Jana Small Finance Bank', current: 300_000 }),
        h({ assetId: 'x2', bank: 'Jana', current: 300_000 }),
        h({ assetId: 'u', bank: 'Foreign Bank', insured: false, current: 9_000_000 }),
      ],
      500_000,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]!.total).toBe(600_000);
    expect(r.outside).toEqual([{ bank: 'Foreign Bank', total: 9_000_000 }]);
  });

  it('ignores a deposit that still has to be confirmed', () => {
    const r = insuranceRoom(
      [h({ assetId: 'm', product: 'fd', current: 700_000, needsConfirmation: true })],
      500_000,
    );
    expect(r.rows).toEqual([]);
  });
});
