import { describe, expect, it } from 'vitest';
import { savedByTag } from '../src/saved-by-tag';
import type { Classified } from '../src/statement-classify';

const c = (id: string, cls: Classified['cls'], category?: string, reason = 'rule'): Classified => ({
  id,
  cls,
  counterpart: null,
  reason,
  ...(category ? { category } : {}),
});

describe('savedByTag', () => {
  const lines = [
    { id: 'salary', date: '2026-04-30', amount: 300_000 },
    { id: 'shop', date: '2026-05-02', amount: -4_000 },
    { id: 'shop2', date: '2026-05-09', amount: -6_000 },
    { id: 'own', date: '2026-05-10', amount: -100_000 },
    { id: 'interest', date: '2026-06-30', amount: 2_500 },
    { id: 'ask', date: '2026-07-01', amount: -50_000 },
    { id: 'before', date: '2026-03-31', amount: -9_999 },
    { id: 'after', date: '2026-11-01', amount: -9_999 },
  ];
  const classified = [
    c('salary', 'outside_in', 'salary'),
    c('shop', 'spent', 'shopping'),
    c('shop2', 'spent', 'shopping', 'Best guess: small amount'),
    c('own', 'own_transfer', 'own_transfer'),
    c('interest', 'interest', 'interest'),
    c('ask', 'ask_out'),
    c('before', 'spent', 'shopping'),
    c('after', 'spent', 'shopping'),
  ];
  const r = savedByTag(lines, classified, '2026-04-01', '2026-11-01', 400_000);

  it('groups money in and out of the family by tag, leaving out own moves, earnings and other years', () => {
    expect(r.rows).toEqual([
      { tag: 'salary', into: 300_000, out: 0, net: 300_000, lines: 1 },
      { tag: null, into: 0, out: 50_000, net: -50_000, lines: 1 },
      { tag: 'shopping', into: 0, out: 10_000, net: -10_000, lines: 2 },
    ]);
    expect(r.bestGuess).toBe(1);
  });

  it('carries the difference to the ledger as its own row, so the rows add up to Saved this FY', () => {
    expect(r.onLines).toBe(240_000);
    expect(r.notOnLines).toBe(160_000);
    expect(r.onLines + r.notOnLines).toBe(r.total);
  });
});
