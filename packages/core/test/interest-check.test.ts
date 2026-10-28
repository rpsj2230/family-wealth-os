import { describe, expect, it } from 'vitest';
import { estimatedInterest, interestCheck, isInterestSection } from '../src/interest-check';
import { attachProceeds } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';

const cfg: PositionConfig = {
  today: '2026-10-28',
  savingsRate: 0.03,
  tdsRate: 0.3, // NRO interest has 30% tax at source: the check compares before it
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  hideMaturedAfterDays: 60,
};
const rec = (date: string, amount: number) => ({ date, amount, currency: 'INR', fxRate: null });
const asset = (
  o: Partial<PositionAsset> & Pick<PositionAsset, 'assetId' | 'type'>,
): PositionAsset => ({
  ownerId: 'r',
  status: 'active',
  name: o.assetId,
  currency: 'INR',
  rate: { own: 0.04, listed: null, tds: 0.3 },
  records: [],
  fd: null,
  fund: null,
  ...o,
});
const nro = asset({
  assetId: 'nro',
  type: 'bank_account',
  records: [rec('2025-03-31', 1_000_000)],
});
const nre = asset({
  assetId: 'nre',
  type: 'bank_account',
  records: [rec('2025-03-31', 5_000_000)],
});
const fd = asset({
  assetId: 'fd',
  type: 'fixed_deposit',
  fd: {
    principal: 1_000_000,
    rate: 0.07,
    bookedOn: '2025-04-01',
    maturityOn: '2027-04-01',
    compounding: 'simple',
    bankMaturityAmount: null,
    endedOn: null,
  },
});
const position: PositionInput = { assets: attachProceeds([nro, nre, fd], cfg), config: cfg };
const taxable = (id: string) => id !== 'nre';

describe('the interest check against AIS and Form 26AS', () => {
  it('estimates only the taxable accounts and deposits, before tax at source', () => {
    const est = estimatedInterest(position, 'r', '2025-26', taxable);
    // about 4% on 10 lakh of savings (credited quarterly) and 7% simple on the 10 lakh deposit: no NRE, no tax taken off
    expect(est).toBeGreaterThan(40_000 + 70_000 - 1_500);
    expect(est).toBeLessThan(40_000 + 70_000 + 1_500);
  });

  it('flags a year whose reported interest differs, and says by how much', () => {
    const [row] = interestCheck({
      position,
      statements: [
        {
          ownerId: 'r',
          fy: '2025-26',
          kind: 'ais',
          lines: [
            { source: 'Sample Bank', amount: 41_000 },
            { source: 'Sample Bank', amount: 95_000 },
          ],
        },
      ],
      taxable,
      tolerance: { rupees: 500, share: 0.01 },
    });
    expect(row!.reported).toBe(136_000);
    expect(row!.bySource).toEqual([{ source: 'Sample Bank', amount: 136_000 }]);
    expect(row!.difference).toBeCloseTo(136_000 - row!.estimated, 6);
    expect(row!.difference).toBeGreaterThan(20_000);
    expect(row!.complete).toBe(true);
    expect(row!.flagged).toBe(true);
  });

  it('prefers AIS over Form 26AS for the same year, and does not flag a year still running', () => {
    const rows = interestCheck({
      position,
      statements: [
        { ownerId: 'r', fy: '2025-26', kind: '26as', lines: [{ source: 'X', amount: 1 }] },
        { ownerId: 'r', fy: '2025-26', kind: 'ais', lines: [{ source: 'X', amount: 110_000 }] },
        { ownerId: 'r', fy: '2026-27', kind: 'ais', lines: [{ source: 'X', amount: 999_999 }] },
      ],
      taxable,
      tolerance: { rupees: 500, share: 0.01 },
    });
    const past = rows.find((r) => r.fy === '2025-26')!;
    expect(past.kind).toBe('ais');
    expect(past.flagged).toBe(false);
    const running = rows.find((r) => r.fy === '2026-27')!;
    expect(running.complete).toBe(false);
    expect(running.flagged).toBe(false);
  });

  it('does not flag a year that starts before the first records', () => {
    const [row] = interestCheck({
      position,
      statements: [
        { ownerId: 'r', fy: '2024-25', kind: 'ais', lines: [{ source: 'X', amount: 50_000 }] },
      ],
      taxable,
      tolerance: { rupees: 500, share: 0.01 },
      coveredFrom: '2025-03-31',
    });
    expect(row!.complete).toBe(true);
    expect(row!.covered).toBe(false);
    expect(row!.flagged).toBe(false);
  });

  it('takes off what bank statements already recorded for the year', () => {
    const [row] = interestCheck({
      position,
      statements: [
        { ownerId: 'r', fy: '2025-26', kind: 'ais', lines: [{ source: 'X', amount: 136_000 }] },
      ],
      taxable,
      tolerance: { rupees: 500, share: 0.01 },
      recorded: () => 136_000 - estimatedInterest(position, 'r', '2025-26', taxable),
    });
    expect(Math.abs(row!.difference)).toBeLessThan(1);
    expect(row!.flagged).toBe(false);
  });

  it('reads the interest sections of Form 26AS', () => {
    expect(isInterestSection('194A')).toBe(true);
    expect(isInterestSection('195')).toBe(true);
    expect(isInterestSection('192')).toBe(false);
  });
});
