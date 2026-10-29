import { describe, expect, it } from 'vitest';
import { balanceChanges } from '../src/balance-changes';

const obs = (
  asset_id: string,
  as_of: string,
  amount: number,
  extra: Partial<{ created_at: string; superseded_by: string | null; currency: string }> = {},
) => ({
  asset_id,
  as_of,
  amount,
  currency: extra.currency ?? 'INR',
  created_at: extra.created_at ?? `${as_of}T10:00:00Z`,
  superseded_by: extra.superseded_by ?? null,
});

describe('balanceChanges', () => {
  it('gives the latest and previous reading on different days, the change and the days since', () => {
    const r = balanceChanges(
      [
        obs('a', '2026-08-31', 100_000),
        obs('a', '2026-09-30', 120_000),
        obs('a', '2026-09-30', 125_000, { created_at: '2026-10-02T09:00:00Z' }),
        obs('a', '2026-07-31', 999, { superseded_by: 'x' }),
        obs('b', '2026-10-20', 500, { currency: 'SGD' }),
        obs('z', '2026-10-01', 1),
      ],
      ['a', 'b'],
      '2026-10-29',
    );
    const a = r.find((x) => x.assetId === 'a')!;
    expect(a.latest).toEqual({ date: '2026-09-30', amount: 125_000 });
    expect(a.previous).toEqual({ date: '2026-08-31', amount: 100_000 });
    expect(a.change).toBe(25_000);
    expect(a.days).toBe(29);
    const b = r.find((x) => x.assetId === 'b')!;
    expect(b.previous).toBeNull();
    expect(b.change).toBeNull();
    expect(b.currency).toBe('SGD');
    expect(r.some((x) => x.assetId === 'z')).toBe(false);
  });

  it('ignores superseded readings even when newest', () => {
    const r = balanceChanges(
      [obs('a', '2026-09-30', 10), obs('a', '2026-10-15', 99, { superseded_by: 'y' })],
      ['a'],
      '2026-10-29',
    );
    expect(r[0]!.latest.amount).toBe(10);
    expect(r[0]!.previous).toBeNull();
  });
});
