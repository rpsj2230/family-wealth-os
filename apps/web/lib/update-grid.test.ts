import { describe, expect, it } from 'vitest';
import { buildGridChanges, type GridRowInfo } from './update-grid';

const cash: GridRowInfo = {
  id: 'c1',
  kind: 'cash',
  currency: 'INR',
  notes: 'AMB - 10K',
  status: 'active',
  fd: null,
};
const sgd: GridRowInfo = {
  id: 's1',
  kind: 'cash',
  currency: 'SGD',
  notes: '',
  status: 'active',
  fd: null,
};
const fd: GridRowInfo = {
  id: 'f1',
  kind: 'fd',
  currency: 'INR',
  notes: '',
  status: 'active',
  fd: { ratePct: '8', maturityAmount: 634_399 },
};
const T = '2026-10-26';

describe('buildGridChanges', () => {
  it('saves a typed balance with the chosen date', () => {
    const r = buildGridChanges([cash], { c1: { amount: '₹1,25,000.50' } }, '2026-10-25', T, {});
    expect(r.errors).toEqual({});
    expect(r.changes).toEqual([{ assetId: 'c1', amount: 125000.5, asOf: '2026-10-25' }]);
  });
  it('ignores rows that were not touched and notes that did not change', () => {
    const r = buildGridChanges(
      [cash, fd],
      { c1: { notes: 'AMB - 10K' }, f1: { status: 'active' } },
      T,
      T,
      {},
    );
    expect(r.changes).toEqual([]);
  });
  it('saves a changed note and a deposit status', () => {
    const r = buildGridChanges(
      [cash, fd],
      { c1: { notes: 'AMB - 25K, no debit card' }, f1: { status: 'closed' } },
      T,
      T,
      {},
    );
    expect(r.changes).toEqual([
      { assetId: 'c1', notes: 'AMB - 25K, no debit card' },
      { assetId: 'f1', status: 'closed' },
    ]);
  });
  it('rejects a bad number and a future date, per row', () => {
    expect(buildGridChanges([cash], { c1: { amount: '12abc' } }, T, T, {}).errors.c1).toContain(
      'plain number',
    );
    expect(
      buildGridChanges([cash], { c1: { amount: '5' } }, '2026-11-01', T, {}).errors.c1,
    ).toContain('future');
  });
  it('needs a rate for a foreign balance, and uses the latest market rate when there is one', () => {
    expect(buildGridChanges([sgd], { s1: { amount: '1000' } }, T, T, {}).errors.s1).toContain(
      'SGD',
    );
    expect(
      buildGridChanges([sgd], { s1: { amount: '1000' } }, T, T, { SGD: 74.26 }).changes[0],
    ).toMatchObject({ fxRate: 74.26 });
    expect(
      buildGridChanges([sgd], { s1: { amount: '1000', fx: '73' } }, T, T, { SGD: 74.26 })
        .changes[0],
    ).toMatchObject({ fxRate: 73 });
  });
  it('corrects a deposit’s rate and maturity amount only when they differ from what is stored', () => {
    const same = buildGridChanges(
      [fd],
      { f1: { fdRate: '8', fdMaturityAmount: '634399' } },
      T,
      T,
      {},
    );
    expect(same.changes).toEqual([]);
    const diff = buildGridChanges(
      [fd],
      { f1: { fdRate: '8.25', fdMaturityAmount: '640000' } },
      T,
      T,
      {},
    );
    expect(diff.changes).toEqual([{ assetId: 'f1', fdRate: 0.0825, fdMaturityAmount: 640000 }]);
    expect(buildGridChanges([fd], { f1: { fdRate: '45' } }, T, T, {}).errors.f1).toContain(
      'between 0 and 30',
    );
  });
});
