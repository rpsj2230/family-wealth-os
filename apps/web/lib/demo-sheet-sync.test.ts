import { describe, expect, it } from 'vitest';
import { demoSyncView, DEMO_SYNC_INFO, DEMO_TEST } from './demo-sheet-sync';

describe('the public sample of the Google Sheet sync', () => {
  it('is the real planner over an invented month: changes, a new row, a closed deposit, an unmatched line, one to place by hand', () => {
    const v = demoSyncView();
    expect(v.stage).toBe('preview');
    expect(v.target).toEqual({
      title: 'Oct 2026',
      existed: false,
      copiedFrom: 'Sep 2026',
      position: 'left',
    });
    expect(v.counts).toMatchObject({ added: 1, closed: 1, unmatched: 1 });
    expect(v.counts.updated).toBeGreaterThanOrEqual(5);
    expect(v.placeByHand).toHaveLength(1);
    const cash = v.rows.find((r) => r.label === 'Cash-NRE-1100')!;
    expect(cash.changes).toEqual([
      { cell: 'F4', column: 'Amount', old: '40,000', next: '47,315.42' },
    ]);
    // formulas are kept
    expect(
      v.rows
        .flatMap((r) => r.changes)
        .every((c) => !/^[GI]\d+$/.test(c.cell) || c.column === 'Maturity value'),
    ).toBe(true);
  });

  it('is plain invented data: no real names, e-mail domains or addresses', () => {
    const text = JSON.stringify([demoSyncView(), DEMO_SYNC_INFO, DEMO_TEST]);
    expect(text).not.toMatch(
      /gmail|verzdesign|docs\.google\.com\/spreadsheets\/d\/[A-Za-z0-9_-]{30,}/i,
    );
    expect(DEMO_SYNC_INFO.email).toMatch(/@sample-project\.iam\.gserviceaccount\.com$/);
  });
});
