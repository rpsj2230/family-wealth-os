import { describe, expect, it } from 'vitest';
import { sipPlanView } from './sip-plan';

const base = {
  assetId: 'f',
  startedOn: '2025-01-05',
  sipMonthly: 8000,
  sipStopped: true,
  payFrom: null,
  accounts: [],
  today: '2026-10-29',
};

describe('sipPlanView', () => {
  it('a running pause: not running now, was ₹8,000, and starts again on its date', () => {
    const v = sipPlanView({
      ...base,
      changes: [
        { on: '2025-01-05', monthly: 5000 },
        { on: '2026-04-05', monthly: 8000 },
        { on: '2026-10-01', monthly: 0 },
        { on: '2027-01-01', monthly: 8000 },
      ],
    });
    expect(v.now).toBe(0);
    expect(v.lastAmount).toBe(8000);
    expect(v.next).toEqual({ on: '2027-01-01', monthly: 8000 });
    expect(v.rows.map((r) => r.when)).toEqual(['past', 'past', 'now', 'planned']);
    // the starting amount stays while later changes depend on it
    expect(v.rows.map((r) => r.removable)).toEqual([false, true, true, true]);
  });

  it('with no dated history it reads the fund’s own amount', () => {
    const v = sipPlanView({ ...base, sipStopped: false, changes: [] });
    expect(v.now).toBe(8000);
    expect(v.rows).toEqual([]);
    expect(v.next).toBeNull();
  });
});
