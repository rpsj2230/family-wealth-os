import { describe, expect, it } from 'vitest';
import { bankSummary, topRateHistory, type BoardOffer, type RateEventRow } from '../src/rate-board';

const offer = (o: Partial<BoardOffer>): BoardOffer => ({
  id: 'x',
  bank: 'Jana Small Finance Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  rate: 0.08,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: '2026-10-20',
  ...o,
});
const ev = (o: Partial<RateEventRow>): RateEventRow => ({
  at: '2026-10-01T10:00:00Z',
  bank: 'Jana Bank',
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  balanceFrom: null,
  balanceTo: null,
  kind: 'added',
  oldRate: null,
  newRate: 0.08,
  source: 'ai',
  reason: null,
  ...o,
});

describe('bankSummary', () => {
  const offers = [
    offer({ id: 'a' }),
    offer({ id: 'b', tenureFrom: 12, tenureTo: 12, rate: 0.075, checkedOn: '2026-10-25' }),
    offer({ id: 'n', accountKind: 'NRO', rate: 0.09 }),
    offer({
      id: 's1',
      product: 'savings',
      accountKind: 'any',
      tenureFrom: 0,
      tenureTo: 0,
      rate: 0.025,
      balanceTo: 100_000,
    }),
    offer({
      id: 's2',
      product: 'savings',
      accountKind: 'any',
      tenureFrom: 0,
      tenureTo: 0,
      rate: 0.07,
      balanceFrom: 5_000_000,
      pageRate: 0.065,
    }),
    offer({ id: 'o', bank: 'Other Bank', rate: 0.12 }),
  ];
  const s = bankSummary(
    offers,
    [ev({ kind: 'changed', oldRate: 0.0775, newRate: 0.08, at: '2026-10-10T00:00:00Z' })],
    'Jana Bank',
  );
  it('finds the best NRE deposit (NRO ignored) and the best savings slab for the bank only', () => {
    expect(s.bestFd!.id).toBe('a');
    expect(s.bestSaving!.id).toBe('s2');
    expect(s.savings.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(s.deposits).toHaveLength(3);
  });
  it('reports the newest check, differences and the last move', () => {
    expect(s.checkedOn).toBe('2026-10-25');
    expect(s.differs).toBe(1);
    expect(s.lastMove).toMatchObject({ product: 'fd', from: 0.0775, to: 0.08 });
  });
});

describe('topRateHistory', () => {
  it('replays the log into the best rate over time and drops repeats', () => {
    const h = topRateHistory(
      [
        ev({ at: '2026-09-01T00:00:00Z', newRate: 0.075 }),
        ev({ at: '2026-09-01T01:00:00Z', tenureFrom: 12, tenureTo: 12, newRate: 0.07 }),
        ev({ at: '2026-10-01T00:00:00Z', kind: 'changed', oldRate: 0.075, newRate: 0.08 }),
        ev({
          at: '2026-10-02T00:00:00Z',
          product: 'savings',
          accountKind: 'any',
          tenureFrom: 0,
          tenureTo: 0,
          newRate: 0.07,
          balanceFrom: 5_000_000,
        }),
        ev({ at: '2026-10-03T00:00:00Z', kind: 'removed', oldRate: 0.08, newRate: null }),
      ],
      'Jana Small Finance Bank',
    );
    expect(h).toEqual([
      { date: '2026-09-01', fd: 0.075, savings: null },
      { date: '2026-10-01', fd: 0.08, savings: null },
      { date: '2026-10-02', fd: 0.08, savings: 0.07 },
      { date: '2026-10-03', fd: 0.07, savings: 0.07 },
    ]);
  });
});
