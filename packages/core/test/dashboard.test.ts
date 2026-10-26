import { describe, expect, it } from 'vitest';
import {
  changeSince,
  freshnessSummary,
  linearPath,
  liquidityLadder,
  toShares,
  upcomingEvents,
} from '../src/dashboard';

describe('toShares', () => {
  it('orders largest first, drops zeros and folds the tail into Other', () => {
    const s = toShares({ a: 50, b: 30, c: 10, d: 5, e: 5, z: 0, neg: -4 }, { a: 'Alpha' }, 3);
    expect(s.map((x) => x.label)).toEqual(['Alpha', 'b', 'c', 'Other']);
    expect(s[3]!.value).toBe(10);
    expect(s.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 10);
  });
  it('is empty when nothing is positive', () => {
    expect(toShares({ a: 0, b: -1 })).toEqual([]);
  });
});

describe('liquidityLadder', () => {
  const today = '2026-10-26';
  const steps = liquidityLadder({
    cashNow: 100,
    today,
    deposits: [
      { name: 'late', maturityOn: '2026-10-01', amount: 10 },
      { name: 'soon', maturityOn: '2026-11-20', amount: 20 },
      { name: 'q', maturityOn: '2027-01-15', amount: 30 },
      { name: 'h', maturityOn: '2027-03-30', amount: 40 },
      { name: 'y', maturityOn: '2027-09-01', amount: 50 },
      { name: 'far', maturityOn: '2029-01-01', amount: 60 },
      { name: 'zero', maturityOn: '2026-11-01', amount: 0 },
    ],
  });
  it('puts overdue deposits with the money available now', () => {
    expect(steps[0]!.amount).toBe(110);
    expect(steps[0]!.items.map((i) => i.name)).toEqual(['late']);
  });
  it('buckets by maturity and accumulates', () => {
    expect(steps.map((s) => s.amount)).toEqual([110, 20, 30, 40, 50, 60]);
    expect(steps.map((s) => s.cumulative)).toEqual([110, 130, 160, 200, 250, 310]);
  });
});

describe('upcomingEvents', () => {
  it('keeps overdue and near items, soonest first, within the limit', () => {
    const ev = upcomingEvents(
      [
        { date: '2026-12-31', kind: 'tax', title: 'Late', href: '/' },
        { date: '2026-10-20', kind: 'task', title: 'Overdue', href: '/' },
        { date: '2026-11-05', kind: 'deposit', title: 'FD', href: '/' },
        { date: '2028-01-01', kind: 'policy', title: 'Far', href: '/' },
      ],
      '2026-10-26',
      90,
      2,
    );
    expect(ev.map((e) => e.title)).toEqual(['Overdue', 'FD']);
    expect(ev[0]!.daysLeft).toBe(-6);
  });
});

describe('freshnessSummary', () => {
  it('counts each state and finds the oldest', () => {
    const s = freshnessSummary([
      { freshness: 'current', ageDays: 3 },
      { freshness: 'calculated', ageDays: null },
      { freshness: 'older_than_expected', ageDays: 40 },
      { freshness: 'stale', ageDays: 120 },
      { freshness: 'missing', ageDays: null },
    ]);
    expect([s.fresh, s.aging, s.stale, s.missing]).toEqual([2, 1, 1, 1]);
    expect(s.freshShare).toBeCloseTo(0.4, 10);
    expect(s.oldestDays).toBe(120);
  });
  it('treats nothing as fully fresh rather than dividing by zero', () => {
    expect(freshnessSummary([]).freshShare).toBe(1);
  });
});

describe('changeSince', () => {
  const pts = [
    { date: '2026-08-31', value: 100 },
    { date: '2026-09-30', value: 110 },
    { date: '2026-10-26', value: 121 },
  ];
  it('compares with the latest point at least `days` old', () => {
    const c = changeSince(pts, 30)!;
    expect(c.from).toBe('2026-08-31'); // 30 days before 26 Oct is 26 Sep; the latest point on or before it
    expect(c.amount).toBe(21);
    expect(c.pct).toBeCloseTo(0.21, 10);
  });
  it('is null when the series is too short for the window', () => {
    expect(changeSince(pts, 365)).toBeNull();
    expect(changeSince([pts[0]!], 30)).toBeNull();
  });
});

describe('linearPath', () => {
  it('continues at the monthly change and never goes below zero', () => {
    const p = linearPath({ date: '2026-10-26', value: 1000 }, 10, 2);
    expect(p.map((x) => x.value)).toEqual([1120, 1240]);
    expect(p[0]!.date).toBe('2027-10-26');
    expect(linearPath({ date: '2026-10-26', value: 100 }, -50, 1)[0]!.value).toBe(0);
  });
});
