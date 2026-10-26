import { describe, expect, it } from 'vitest';
import { parseTaskLines } from './task-lines';

describe('parseTaskLines', () => {
  it('reads ISO, day-month-year and numeric dates with several separators', () => {
    const r = parseTaskLines(
      '2026-10-27 | Sell the folios\n27 Nov 2026 - Renew the deposit\n05/12/2026: Call the bank\n\n',
    );
    expect(r.errors).toEqual([]);
    expect(r.tasks).toEqual([
      { title: 'Sell the folios', dueOn: '2026-10-27' },
      { title: 'Renew the deposit', dueOn: '2026-11-27' },
      { title: 'Call the bank', dueOn: '2026-12-05' },
    ]);
  });
  it('reports lines it cannot read instead of guessing, with the line number', () => {
    const r = parseTaskLines(
      '2026-02-30 | Impossible date\nBuy milk\n2026-10-27 |\n2026-10-28 | Fine',
    );
    expect(r.tasks).toEqual([{ title: 'Fine', dueOn: '2026-10-28' }]);
    expect(r.errors.map((e) => e.slice(0, 7))).toEqual(['Line 1:', 'Line 2:', 'Line 3:']);
  });
});
