import { describe, expect, it } from 'vitest';
import { attachProceeds } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';
import { statementInterest, statementInterestMoves } from '../src/statement-interest';
import type { Classified, StmtLine } from '../src/statement-classify';

const cfg: PositionConfig = {
  today: '2026-10-28',
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
};
const acct: PositionAsset = {
  assetId: 'a',
  ownerId: 'r',
  type: 'bank_account',
  status: 'active',
  name: 'Sample savings',
  currency: 'INR',
  rate: { own: 0.04, listed: null, tds: 0 },
  records: [{ date: '2024-03-31', amount: 1_000_000, currency: 'INR', fxRate: null }],
  fd: null,
  fund: null,
};
const position: PositionInput = { assets: attachProceeds([acct], cfg), config: cfg };
// four quarterly credits that add up to 45,000 where about 40,000 was estimated (4% of 10 lakh)
const lines: StmtLine[] = ['2024-06-30', '2024-09-30', '2024-12-31', '2025-03-31'].map((d, i) => ({
  id: `i${i}`,
  assetId: 'a',
  ownerId: 'r',
  date: d,
  amount: 11_250,
  narration: 'INT.PD',
}));
const classified: Classified[] = lines.map((l) => ({
  id: l.id,
  cls: 'interest',
  counterpart: null,
  reason: '',
}));

describe('statement interest against the estimate', () => {
  it('compares a year the statements cover in full and records the difference as earnings', () => {
    const rows = statementInterest({
      lines,
      classified,
      coverage: [{ assetId: 'a', from: '2024-04-03', to: '2025-03-31' }],
      position,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fy).toBe('2024-25');
    expect(rows[0]!.actual).toBe(45_000);
    expect(rows[0]!.estimated).toBeGreaterThan(38_000);
    expect(rows[0]!.estimated).toBeLessThan(42_000);
    const [m] = statementInterestMoves(rows);
    expect(m).toMatchObject({
      idemKey: 'stmt:a:int:2024-25',
      movedOn: '2025-03-31',
      kind: 'income',
      fromAssetId: null,
      toAssetId: 'a',
    });
    expect(m!.amount).toBeCloseTo(45_000 - rows[0]!.estimated, 2);
  });

  it('leaves a year the statements cover only in part', () => {
    expect(
      statementInterest({
        lines,
        classified,
        coverage: [{ assetId: 'a', from: '2024-09-01', to: '2025-03-31' }],
        position,
      }),
    ).toEqual([]);
  });

  it('joins two uploads that meet', () => {
    expect(
      statementInterest({
        lines,
        classified,
        coverage: [
          { assetId: 'a', from: '2024-04-01', to: '2024-09-30' },
          { assetId: 'a', from: '2024-10-01', to: '2025-03-31' },
        ],
        position,
      }),
    ).toHaveLength(1);
  });
});
