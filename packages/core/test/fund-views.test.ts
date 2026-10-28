import { describe, expect, it } from 'vitest';
import { plannedInstalments, sipAmountOn } from '../src/estimate';
import { fundViews } from '../src/fund-views';
import { posFundFrom } from '../src/position-build';
import type { PositionAsset, PositionConfig, PositionInput } from '../src/position';

const TODAY = '2026-10-28';
const cfg: PositionConfig = {
  today: TODAY,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
};
const navs = [
  { date: '2026-08-05', nav: 100 },
  { date: '2026-09-05', nav: 104 },
  { date: '2026-10-05', nav: 108 },
  { date: '2026-10-27', nav: 110 },
];
const sip = { monthly: 10_000, startedOn: '2026-08-05', stopped: false };
const line = (date: string, amount: number, nav: number, source: string) => ({
  date,
  kind: 'sip',
  units: amount / nav,
  amount,
  nav,
  balance: null,
  source,
  description: source === 'estimate' ? 'Estimated SIP instalment, not yet on a statement' : 'SIP',
});
const fundAsset = (lines: ReturnType<typeof line>[], navList = navs): PositionAsset => ({
  assetId: 'f',
  ownerId: 'r',
  type: 'mutual_fund',
  status: 'active',
  name: 'Axis Large Cap',
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: [],
  fd: null,
  fund: posFundFrom({
    lines,
    navs: navList,
    units: null,
    snapshots: [],
    plan: null,
    sip,
    today: TODAY,
    unitTolerance: 0.001,
  }),
});
const input = (a: PositionAsset): PositionInput => ({ assets: [a], config: cfg });

describe('fundViews (acceptance tests 5 and 8)', () => {
  // two instalments on the statement (CAS), the October one projected from the SIP plan
  const a = fundAsset([
    line('2026-08-05', 10_000, 100, 'cas'),
    line('2026-09-05', 10_000, 104, 'cas'),
    line('2026-10-05', 10_000, 108, 'estimate'),
  ]);
  const v = fundViews(input(a), { navStaleDays: 4, upcomingDays: 60 });

  it('values confirmed units at the latest official NAV, and keeps projected units apart', () => {
    const confirmedUnits = 100 + 10_000 / 104;
    expect(v.confirmed).toBeCloseTo(confirmedUnits * 110, 6);
    expect(v.projected.value).toBeCloseTo((10_000 / 108) * 110, 6);
    expect(v.projected.invested).toBe(10_000);
    expect(v.projected.count).toBe(1);
    expect(v.estimated).toBeCloseTo(v.confirmed + v.projected.value, 6);
  });

  it('shows the NAV date and flags it as stale only when it is older than Settings allow', () => {
    expect(v.rows[0]!.nav).toEqual({ date: '2026-10-27', nav: 110 });
    expect(v.rows[0]!.navAgeDays).toBe(1);
    expect(v.staleCount).toBe(0);
    // the latest price is 23 days old (more than the gap prices are looked up over): still the latest official one, used and flagged
    const old = fundViews(
      input(fundAsset([line('2026-08-05', 10_000, 100, 'cas')], navs.slice(0, 3))),
      {
        navStaleDays: 4,
        upcomingDays: 30,
      },
    );
    expect(old.rows[0]!.nav!.date).toBe('2026-10-05');
    expect(old.rows[0]!.value).toBeCloseTo(100 * 108, 6);
    expect(old.rows[0]!.stale).toBe(true);
    expect(old.staleCount).toBe(1);
  });

  it('lists the next instalments with the amount in force, and no invented NAV or units', () => {
    expect(v.upcoming).toEqual([
      { assetId: 'f', name: 'Axis Large Cap', date: '2026-11-05', amount: 10_000 },
      { assetId: 'f', name: 'Axis Large Cap', date: '2026-12-05', amount: 10_000 },
    ]);
  });
});

describe('SIP changes and stopping (acceptance test 6)', () => {
  const plan = {
    monthly: 10_000,
    startedOn: '2025-01-05',
    stopped: false,
    changes: [
      { from: '2026-03-01', monthly: 15_000 },
      { from: '2026-09-01', monthly: 0 },
    ],
  };
  it('keeps the past amounts, changes the future only from the effective date, and ends at a stop', () => {
    expect(sipAmountOn(plan, '2026-02-05')).toBe(10_000);
    expect(sipAmountOn(plan, '2026-03-05')).toBe(15_000);
    const lines = plannedInstalments(
      plan,
      new Date('2025-12-31T00:00:00Z'),
      new Date('2026-12-31T00:00:00Z'),
    );
    expect(lines.map((l) => l.amount)).toEqual([
      10_000, 10_000, 15_000, 15_000, 15_000, 15_000, 15_000, 15_000,
    ]);
    expect(lines[lines.length - 1]!.date).toBe('2026-08-05');
  });
  it('a plan with no stop keeps projecting: a missing statement line is not a stop', () => {
    const running = { monthly: 5_000, startedOn: '2026-01-10', stopped: false };
    expect(
      plannedInstalments(
        running,
        new Date('2026-09-30T00:00:00Z'),
        new Date('2026-12-31T00:00:00Z'),
      ),
    ).toHaveLength(3);
  });
});
