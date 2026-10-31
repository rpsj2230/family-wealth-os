import { describe, expect, it } from 'vitest';
import {
  buildGridChanges,
  carryForward,
  changeHint,
  feedHint,
  spreadPaste,
  type GridRowInfo,
} from './update-grid';

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

describe('carryForward ("nothing changed")', () => {
  const rows = [
    { id: 'a', kind: 'cash' as const, status: 'active', recorded: 1000.5 },
    { id: 'b', kind: 'cash' as const, status: 'active', recorded: null },
    { id: 'c', kind: 'cash' as const, status: 'closed', recorded: 5 },
    { id: 'd', kind: 'fd' as const, status: 'active', recorded: 7 },
    { id: 'e', kind: 'held' as const, status: 'active', recorded: 20 },
  ];
  it('fills only lines that take a typed value and have an earlier balance', () => {
    const r = carryForward(rows, {});
    expect(r.filled).toBe(2);
    expect(r.edits).toEqual({ a: { amount: '1000.5' }, e: { amount: '20' } });
  });
  it('keeps what was already typed and can be limited to one bank', () => {
    const r = carryForward(rows, { a: { amount: '999' } }, new Set(['a', 'e']));
    expect(r.edits.a!.amount).toBe('999');
    expect(r.edits.e!.amount).toBe('20');
    expect(r.filled).toBe(1);
    expect(carryForward(rows, {}, new Set(['e'])).edits.a).toBeUndefined();
  });
  it('turns into changes dated by the chosen date', () => {
    const r = carryForward(rows, {});
    const info: GridRowInfo = { ...cash, id: 'a' };
    const out = buildGridChanges([info], r.edits, '2026-10-20', '2026-10-26', {});
    expect(out.changes).toEqual([{ assetId: 'a', amount: 1000.5, asOf: '2026-10-20' }]);
  });
});

describe('spreadPaste (a column from Excel)', () => {
  const boxes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  it('drops one value per box from the box pasted into', () => {
    expect(spreadPaste('10\n20\n', boxes, 'b', {})).toEqual({
      b: { amount: '10' },
      c: { amount: '20' },
    });
  });
  it('uses the first column and skips a blank line in the middle', () => {
    expect(spreadPaste('1,000\tx\n\n3', boxes, 'a', {})).toEqual({
      a: { amount: '1,000' },
      c: { amount: '3' },
    });
  });
  it('leaves a single value to paste normally and ignores overflow', () => {
    expect(spreadPaste('5', boxes, 'a', {})).toBeNull();
    expect(spreadPaste('1\n2\n3\n4', boxes, 'c', {})).toEqual({ c: { amount: '1' } });
    expect(spreadPaste('1\n2', boxes, 'zzz', {})).toBeNull();
  });
});

describe('changeHint', () => {
  it('says how far a typed balance is from the last one', () => {
    expect(changeHint(10000, '10000')).toEqual({ text: 'Same as last', warn: false });
    expect(changeHint(10000, '10,320')).toEqual({
      text: '+\u20b9320 (3.2%) since last',
      warn: false,
    });
    expect(changeHint(10000, '8000')).toEqual({
      text: '\u2212\u20b92,000 (20%) since last',
      warn: false,
    });
  });
  it('flags a likely typing slip', () => {
    expect(changeHint(10000, '1000000')?.warn).toBe(true);
    expect(changeHint(10000, '500')?.warn).toBe(true);
  });
  it('stays quiet without a number or an earlier balance', () => {
    expect(changeHint(null, '5')).toBeNull();
    expect(changeHint(100, '')).toBeNull();
    expect(changeHint(100, 'abc')).toBeNull();
    expect(changeHint(0, '5')).toBeNull();
  });
  it('names a foreign currency', () => {
    expect(changeHint(1000, '1100', 'SGD')?.text).toBe('+SGD 100 (10%) since last');
  });
});

describe('a typed balance against the bank lines', () => {
  const check = { reach: 1_37_912, on: '2026-09-30', ask: [] };
  it('says when it follows from the lines', () => {
    expect(feedHint(check, '1,37,912')).toEqual({
      text: 'Matches the bank lines (to 30 Sept)',
      warn: false,
    });
  });
  it('flags the difference at once, and which way the money went', () => {
    const h = feedHint(check, '1,32,912');
    expect(h?.warn).toBe(true);
    expect(h?.text).toMatch(/less than the bank lines reach/);
    expect(h?.text).toMatch(/money out not on file/);
  });
  it('says nothing without lines or without a number', () => {
    expect(feedHint(undefined, '100')).toBeNull();
    expect(feedHint({ reach: null, on: null, ask: [] }, '100')).toBeNull();
    expect(feedHint(check, '')).toBeNull();
  });
});
