import type { AssetRow, ObservationRow } from '@fwos/core';
import { describe, expect, it } from 'vitest';
import { foreignLines, latestObservations } from './accounts-summary';

const obs = (
  id: string,
  asset: string,
  as_of: string,
  amount: number,
  superseded_by: string | null = null,
) =>
  ({
    id,
    asset_id: asset,
    kind: 'balance',
    amount,
    currency: 'SGD',
    fx_rate: 62,
    as_of,
    confidence: 'manual_confirmed',
    source: 'manual',
    created_at: '2026-01-01T00:00:00Z',
    superseded_by,
  }) as ObservationRow;
const asset = (id: string, currency: string, status = 'active') =>
  ({
    id,
    owner_id: 'p1',
    type: 'bank_account',
    status,
    nickname: `acct ${id}`,
    currency,
    account_kind: null,
    expected_freshness_days: 35,
  }) as AssetRow;

describe('foreign-currency accounts', () => {
  const rows = [
    obs('1', 'a', '2026-08-01', 1000),
    obs('2', 'a', '2026-10-01', 1200),
    obs('3', 'a', '2026-10-10', 9999, 'x'),
  ];
  it('keeps the latest value that was not replaced', () => {
    expect(latestObservations(rows).get('a')).toMatchObject({ as_of: '2026-10-01', amount: 1200 });
  });
  it('lists only active non-rupee accounts with the rate and rupee value', () => {
    const lines = foreignLines(
      [asset('a', 'SGD'), asset('b', 'INR'), asset('c', 'SGD', 'closed'), asset('d', 'USD')],
      rows,
      new Map([['a', 74_400]]),
      { SGD: { rate: 63.5, date: '2026-10-25' } },
    );
    expect(lines.map((l) => l.assetId)).toEqual(['a', 'd']);
    expect(lines[0]).toMatchObject({
      amount: 1200,
      asOf: '2026-10-01',
      rate: 63.5,
      rateDate: '2026-10-25',
      inr: 74_400,
    });
    expect(lines[1]).toMatchObject({ amount: null, rate: null, inr: null });
  });
});
