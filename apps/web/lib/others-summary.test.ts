import { describe, expect, it } from 'vitest';
import type { AssetRow, ObservationRow } from '@fwos/core';
import {
  holdingLines,
  loanLines,
  loanTotals,
  parseAmount,
  policyDue,
  policyKindLabel,
} from './others-summary';

const loan = (id: string, lent: number, repaid: number[], expectedOn: string | null) => ({
  assetId: id,
  counterparty: id,
  ownerId: 'p1',
  lent,
  lentOn: '2025-01-01',
  expectedOn,
  repayments: repaid.map((amount) => ({ amount, on: '2026-01-01' })),
});

describe('loans', () => {
  const lines = loanLines(
    [
      loan('settled', 100_000, [100_000], null),
      loan('late', 200_000, [50_000], '2026-09-26'),
      loan('fresh', 500_000, [], '2027-01-01'),
    ],
    '2026-10-26',
  );
  it('shows open loans first, the largest amount owed on top', () => {
    expect(lines.map((l) => l.assetId)).toEqual(['fresh', 'late', 'settled']);
  });
  it('works out what is owed and how late', () => {
    const late = lines.find((l) => l.assetId === 'late')!;
    expect(late.outstanding).toBe(150_000);
    expect(late.status).toBe('overdue');
    expect(late.daysOverdue).toBe(30);
    expect(lines.find((l) => l.assetId === 'fresh')!.daysToExpected).toBe(67);
    expect(lines.find((l) => l.assetId === 'settled')!.daysToExpected).toBeNull();
  });
  it('adds up only the open loans', () => {
    expect(loanTotals(lines)).toEqual({
      openCount: 2,
      owed: 650_000,
      overdueCount: 1,
      overdueAmount: 150_000,
      settledCount: 1,
      giftCount: 0,
      giftAmount: 0,
    });
  });
  it('keeps a gift for the record but never counts or chases it', () => {
    const withGift = loanLines(
      [
        loan('fresh', 500_000, [], '2027-01-01'),
        { ...loan('gift', 300_000, [], '2025-01-01'), gift: true },
      ],
      '2026-10-26',
    );
    const gift = withGift.find((l) => l.assetId === 'gift')!;
    expect(gift.status).toBe('gift'); // not overdue even though its date has passed
    expect(gift.daysOverdue).toBe(0);
    expect(gift.daysToExpected).toBeNull();
    expect(withGift.map((l) => l.assetId)).toEqual(['fresh', 'gift']);
    expect(loanTotals(withGift)).toMatchObject({
      openCount: 1,
      owed: 500_000,
      overdueCount: 0,
      giftCount: 1,
      giftAmount: 300_000,
    });
  });
});

describe('policyDue', () => {
  const today = '2026-10-26';
  it('picks the nearest date still to come and flags it inside the reminder window', () => {
    const d = policyDue({ renewalOn: '2026-12-01', expiresOn: '2026-11-20' }, today, 45);
    expect(d).toEqual({ state: 'soon', on: '2026-11-20', what: 'end', days: 25 });
    expect(policyDue({ renewalOn: '2027-06-01', expiresOn: null }, today, 45).state).toBe('ok');
  });
  it('treats today as still to come', () => {
    expect(policyDue({ renewalOn: today, expiresOn: null }, today, 45).days).toBe(0);
  });
  it('shows a passed date as lapsed, and ignores it while another date is still ahead', () => {
    expect(policyDue({ renewalOn: '2026-09-01', expiresOn: null }, today, 45)).toMatchObject({
      state: 'lapsed',
      days: -55,
    });
    expect(policyDue({ renewalOn: '2026-09-01', expiresOn: '2030-01-01' }, today, 45).state).toBe(
      'ok',
    );
  });
  it('has no state without dates', () => {
    expect(policyDue({ renewalOn: null, expiresOn: null }, today, 45).state).toBe('none');
  });
});

describe('helpers', () => {
  it('reads typed amounts', () => {
    expect(parseAmount('₹ 12,50,000')).toBe(1_250_000);
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('-5')).toBeNull();
  });
  it('names policy kinds', () => {
    expect(policyKindLabel('health_sg')).toBe('Health (Singapore)');
    expect(policyKindLabel('odd_kind')).toBe('odd kind');
  });
});

describe('holdingLines', () => {
  const a = (id: string, type: string, status = 'active') =>
    ({
      id,
      owner_id: 'p1',
      type,
      status,
      nickname: `n-${id}`,
      label: null,
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: null,
      notes: null,
    }) as unknown as AssetRow;
  const o = (asset: string, as_of: string, source: string) =>
    ({
      id: `${asset}${as_of}`,
      asset_id: asset,
      kind: 'valuation',
      amount: 1,
      currency: 'INR',
      fx_rate: null,
      as_of,
      confidence: 'manual_confirmed',
      source,
      created_at: '',
      superseded_by: null,
    }) as ObservationRow;
  it('lists property and retirement holdings, largest first, never counting a missing value as zero', () => {
    const lines = holdingLines(
      [
        a('1', 'property'),
        a('2', 'nps'),
        a('3', 'bank_account'),
        a('4', 'ulip', 'closed'),
        a('5', 'other'),
      ],
      [o('1', '2026-09-01', 'manual'), o('2', '2026-10-01', 'workbook')],
      new Map([
        ['1', 8_500_000],
        ['2', 300_000],
      ]),
    );
    expect(lines.map((l) => l.assetId)).toEqual(['1', '2', '5']);
    expect(lines[0]).toMatchObject({ kind: 'Property', value: 8_500_000, asOf: '2026-09-01' });
    expect(lines[0]!.source.kind).toBe('manual');
    expect(lines[1]!.source.kind).toBe('import');
    expect(lines[2]).toMatchObject({ value: null, asOf: null });
    expect(lines[2]!.source.kind).toBe('none');
  });
});
