import { describe, expect, it } from 'vitest';
import { abroadIncomeMoves } from '../src/abroad-income';
import type { PositionInput } from '../src/position';

const position = (records: { date: string; amount: number }[]): PositionInput =>
  ({
    assets: [
      {
        assetId: 'sg',
        ownerId: 'r',
        type: 'bank_account',
        status: 'active',
        name: 'DBS',
        currency: 'SGD',
        rate: { own: 0, listed: null, tds: null },
        records: records.map((r) => ({ ...r, currency: 'SGD', fxRate: 65 })),
        fd: null,
        fund: null,
      },
    ],
    config: { today: '2025-12-31', fx: {} },
  }) as unknown as PositionInput;

describe('abroadIncomeMoves', () => {
  it('a rise the transfers on file do not explain is money from outside, in rupees at the day’s rate', () => {
    const p = position([
      { date: '2025-01-31', amount: 10_000 },
      { date: '2025-02-28', amount: 18_000 }, // salary 12,000 in, 4,000 sent to India by Wise
      { date: '2025-03-31', amount: 17_000 }, // 1,000 spent
    ]);
    const moves = abroadIncomeMoves(p, [
      {
        movedOn: '2025-02-15',
        amount: 260_000,
        currency: 'INR',
        fromAssetId: 'sg',
        toAssetId: 'in',
        status: 'confirmed',
      },
    ]);
    expect(moves).toEqual([
      { date: '2025-02-28', amount: 12_000 * 65, kind: 'external' },
      { date: '2025-03-31', amount: -1_000 * 65, kind: 'external' },
    ]);
  });
  it('rupee accounts are left to their statements', () => {
    const p = position([]);
    (p.assets[0] as { currency: string }).currency = 'INR';
    expect(abroadIncomeMoves(p, [])).toEqual([]);
  });
});
