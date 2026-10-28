import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, configFromJson } from '../src/config';
import {
  allocationOf,
  attentionItems,
  bestAndWeakest,
  changeSinceDate,
  depositInterest,
  foldByKind,
  fyStartOf,
  growthSplit,
  largestShare,
  moversBetween,
  netWorthChanges,
  parseHomeRange,
  raisableWithin,
  rangeView,
  valueTrust,
  type AttentionInput,
} from '../src/home';
import { aggregateNetWorth, isCounted, type AssetType, type ValuedAsset } from '../src/networth';
import type { RaiseSource } from '../src/liquidity';

const TODAY = '2026-10-26';

describe('changeSinceDate', () => {
  const pts = [
    { date: '2026-01-10', value: 100 },
    { date: '2026-09-20', value: 150 },
    { date: '2026-10-26', value: 180 },
  ];
  it('measures from the last value on or before the start', () => {
    const c = changeSinceDate(pts, '2026-10-01')!;
    expect(c.from).toBe('2026-09-20');
    expect(c.amount).toBe(30);
    expect(c.pct).toBeCloseTo(0.2, 10);
    expect(c.partial).toBe(false);
  });
  it('falls back to the first value on record and says so', () => {
    const c = changeSinceDate(pts, '2025-12-31')!;
    expect(c.from).toBe('2026-01-10');
    expect(c.partial).toBe(true);
    expect(c.amount).toBe(80);
  });
  it('is null with one value, or when the base is the latest value itself', () => {
    expect(changeSinceDate([pts[0]!], '2026-01-01')).toBeNull();
    expect(changeSinceDate(pts, '2026-10-26')).toBeNull();
    expect(
      changeSinceDate(
        [
          { date: '2026-10-26', value: 1 },
          { date: '2026-10-26', value: 2 },
        ],
        '2026-10-26',
      ),
    ).toBeNull();
  });
  it('has no percentage when the base was not above zero', () => {
    const c = changeSinceDate(
      [
        { date: '2026-01-01', value: 0 },
        { date: '2026-02-01', value: 5 },
      ],
      '2026-01-15',
    )!;
    expect(c.pct).toBeNull();
    expect(c.amount).toBe(5);
  });
});

describe('financial year change', () => {
  it('starts on 1 April and compares with the close of the year before', () => {
    expect(fyStartOf('2026-10-26')).toBe('2026-04-01');
    expect(fyStartOf('2027-02-01')).toBe('2026-04-01');
    const trend = [
      { date: '2026-03-31', value: 1000 },
      { date: '2026-04-02', value: 1010 },
      { date: '2026-09-26', value: 1100 },
      { date: '2026-10-26', value: 1200 },
    ];
    const c = netWorthChanges(trend, TODAY, 30);
    expect(c.fy!.from).toBe('2026-03-31');
    expect(c.fy!.amount).toBe(200);
    expect(c.fy!.partial).toBe(false);
    expect(c.month!.from).toBe('2026-09-26');
    expect(c.month!.amount).toBe(100);
  });
  it('uses the first value when the history starts inside the year', () => {
    const c = netWorthChanges(
      [
        { date: '2026-06-01', value: 100 },
        { date: '2026-10-26', value: 130 },
      ],
      TODAY,
      30,
    );
    expect(c.fy).toMatchObject({ from: '2026-06-01', partial: true, amount: 30 });
  });
});

describe('rangeView', () => {
  const trend = Array.from({ length: 25 }, (_, i) => {
    const d = new Date(Date.UTC(2024, 9 + i, 26));
    return { date: d.toISOString().slice(0, 10), value: 100 + i * 10 };
  });
  it('slices the history and compares with the equal stretch before', () => {
    const v = rangeView(trend, '1Y', TODAY);
    expect(v.points[0]!.date).toBe('2025-10-26');
    expect(v.change!.amount).toBe(120);
    expect(v.before!.amount).toBe(120);
    expect(v.short).toBe(false);
  });
  it('compares nothing for All, and marks a history that is too short', () => {
    expect(rangeView(trend, 'ALL', TODAY).before).toBeNull();
    const short = rangeView(trend.slice(-3), '1Y', TODAY);
    expect(short.short).toBe(true);
    expect(short.before).toBeNull();
  });
  it('parses the address parameter with a default', () => {
    expect(parseHomeRange('3m')).toBe('3M');
    expect(parseHomeRange('all')).toBe('ALL');
    expect(parseHomeRange('nonsense')).toBe('1Y');
    expect(parseHomeRange(undefined)).toBe('1Y');
  });
});

describe('allocationOf', () => {
  it('folds asset types into the kinds Home shows, in a fixed order, without empty kinds', () => {
    const a = allocationOf({
      fixed_deposit: 300,
      bank_account: 100,
      mutual_fund: 400,
      nps: 30,
      ulip: 20,
      third_party_held: 10,
      other: 40,
      property: 0,
      stock: -5,
    });
    expect(a.map((x) => x.key)).toEqual(['cash', 'fd', 'funds', 'retirement', 'other']);
    expect(a.find((x) => x.key === 'retirement')!.amount).toBe(50);
    expect(a.find((x) => x.key === 'other')!.amount).toBe(50);
    expect(a.reduce((s, x) => s + x.share, 0)).toBeCloseTo(1, 10);
  });
  it('is empty when nothing is positive', () => {
    expect(allocationOf({ bank_account: 0 })).toEqual([]);
  });
  it('folds a snapshot split the same way', () => {
    expect(foldByKind({ nps: 5, ulip: 7, bank_account: 1 })).toEqual({ retirement: 12, cash: 1 });
  });
});

function valued(id: string, type: AssetType, amount: number, status = 'active'): ValuedAsset {
  return {
    assetId: id,
    ownerId: 'o1',
    type,
    status,
    name: id,
    estimate: {
      anchorAmount: amount,
      estimatedAmount: amount,
      components: [],
      basis: 'calculated',
    } as unknown as ValuedAsset['estimate'],
  };
}

describe('valueTrust', () => {
  const assets = [
    valued('a', 'bank_account', 100),
    valued('b', 'fixed_deposit', 200),
    valued('c', 'mutual_fund', 300),
    valued('d', 'bank_account', 400),
    valued('e', 'bank_account', 50, 'closed'),
    valued('p', 'policy', 999),
  ];
  const lines = {
    a: { freshness: 'current' as const },
    b: { freshness: 'calculated' as const },
    c: { freshness: 'stale' as const },
    d: { freshness: 'imported_unverified' as const },
  };
  it('splits today’s value by how it is known and adds up to net worth', () => {
    const t = valueTrust(assets, lines);
    expect(t.confirmed).toBe(100);
    expect(t.calculated).toBe(200);
    expect(t.unconfirmed).toBe(700);
    expect(t.total).toBe(aggregateNetWorth(assets).total);
    expect(t.verifiedShare).toBeCloseTo(0.3, 10);
    expect(t.counts).toEqual({ confirmed: 1, calculated: 1, unconfirmed: 2 });
  });
  it('treats a holding with no status line as not confirmed, and counts only what net worth counts', () => {
    expect(isCounted(assets[4]!)).toBe(false);
    expect(isCounted(assets[5]!)).toBe(false);
    expect(valueTrust([valued('x', 'stock', 10)], {}).unconfirmed).toBe(10);
  });
  it('reads as fully verified when there is nothing to value', () => {
    expect(valueTrust([], {}).verifiedShare).toBe(1);
  });
});

describe('growthSplit', () => {
  it('separates the money put in from what it has grown by', () => {
    const g = growthSplit([
      { key: 'banks', label: 'Banks', invested: 1000, current: 1100 },
      { key: 'funds', label: 'Funds', invested: 500, current: 700, approximate: true },
    ]);
    expect(g.invested).toBe(1500);
    expect(g.current).toBe(1800);
    expect(g.growth).toBe(300);
    expect(g.growthPct).toBeCloseTo(0.2, 10);
    expect(g.investedShare).toBeCloseTo(1500 / 1800, 10);
    expect(g.approximate).toBe(true);
    expect(g.parts.map((p) => p.growth)).toEqual([100, 200]);
  });
  it('has no percentage when nothing was put in', () => {
    expect(growthSplit([]).growthPct).toBeNull();
  });
});

describe('moversBetween', () => {
  it('lists the largest moves first, drops the small ones and names the keys', () => {
    const m = moversBetween(
      { funds: 100, fd: 500, cash: 50 },
      { funds: 180, fd: 400, cash: 50, property: 5 },
      (k) => k.toUpperCase(),
      2,
      10,
    );
    expect(m).toEqual(
      [
        { key: 'funds', label: 'FUNDS', change: 80 },
        { key: 'fd', label: 'FD', change: -100 },
      ].sort((a, b) => Math.abs(b.change) - Math.abs(a.change)),
    );
  });
});

describe('raisableWithin', () => {
  const src = (
    assetId: string,
    kind: RaiseSource['kind'],
    max: number,
    availableOn: string,
  ): RaiseSource =>
    ({
      assetId,
      kind,
      name: assetId,
      bank: 'B',
      code: 'c',
      creditTo: null,
      ownerId: 'o1',
      joint: false,
      max,
      availableOn,
      divisible: true,
      fixedCostRate: 0,
      steps: [],
      notes: [],
    }) satisfies RaiseSource;
  const sources = [
    src('cash1', 'cash', 100, '2026-10-26'),
    src('fd1', 'fd_maturing', 500, '2027-01-10'),
    src('fd1', 'fd_break', 480, '2026-10-27'),
    src('mf1', 'mf', 300, '2026-10-29'),
    src('prop', 'property', 9000, '2027-03-01'),
  ];
  it('counts a holding once, at the most it can give by each date', () => {
    const r = raisableWithin(sources, TODAY, [0, 3, 120]);
    expect(r.map((x) => x.amount)).toEqual([100, 100 + 480 + 300, 100 + 500 + 300]);
    expect(r.map((x) => x.holdings)).toEqual([1, 3, 3]);
    expect(r[1]!.date).toBe('2026-10-29');
  });
  it('leaves out kinds the household has removed from its order', () => {
    const r = raisableWithin(sources, TODAY, [3], ['cash', 'fd_maturing']);
    expect(r[0]!.amount).toBe(100);
  });
  it('can count only the ways that cost nothing', () => {
    const costly = [
      ...sources,
      {
        ...src('mf2', 'mf', 50, '2026-10-26'),
        sale: { gainRatio: 0.3, long: true, estimated: false, exitLoad: 0 },
      },
      { ...src('prop2', 'property', 70, '2026-10-26'), fixedCostRate: 0.02 },
    ];
    const r = raisableWithin(costly, TODAY, [0], undefined, true);
    expect(r[0]!.amount).toBe(100);
    expect(raisableWithin(costly, TODAY, [0])[0]!.amount).toBe(100 + 50 + 70);
  });
  it('sorts and de-duplicates the day list', () => {
    expect(raisableWithin(sources, TODAY, [3, 0, 3]).map((x) => x.days)).toEqual([0, 3]);
  });
});

describe('depositInterest', () => {
  const fd = {
    principal: 1_000_000,
    rate: 0.07,
    bookedOn: '2026-01-01',
    maturityOn: '2027-01-01',
    compounding: 'yearly' as const,
  };
  it('counts only the interest added since the start of the financial year', () => {
    const i = depositInterest([fd], TODAY);
    // 1 Apr 2026 to 26 Oct 2026 = 208 days at 7% a year, compounded yearly
    const expected = 1_000_000 * (Math.pow(1.07, 298 / 365) - Math.pow(1.07, 90 / 365));
    expect(i.fy).toBe('2026-27');
    expect(i.fyStart).toBe('2026-04-01');
    expect(i.fyEnd).toBe('2027-03-31');
    expect(i.thisYear).toBeCloseTo(expected, 0);
  });
  it('limits the next twelve months to the time left on the deposit', () => {
    const i = depositInterest([fd], TODAY, 365);
    const expected = 1_000_000 * (1.07 - Math.pow(1.07, 298 / 365));
    expect(i.ahead).toBeCloseTo(expected, 0);
  });
  it('starts a new deposit from the day it was booked', () => {
    const i = depositInterest([{ ...fd, bookedOn: '2026-10-16', maturityOn: '2027-10-16' }], TODAY);
    expect(i.thisYear).toBeCloseTo(1_000_000 * (Math.pow(1.07, 10 / 365) - 1), 0);
  });
  it('is zero without deposits', () => {
    expect(depositInterest([], TODAY)).toMatchObject({ thisYear: 0, ahead: 0, deposits: 0 });
  });
});

describe('bestAndWeakest', () => {
  const f = (name: string, xirr: number | null) => ({
    assetId: name,
    name,
    xirr,
    estimated: false,
  });
  it('needs two funds with a return', () => {
    expect(bestAndWeakest([f('A', 0.1)])).toBeNull();
    expect(bestAndWeakest([f('A', 0.1), f('B', null)])).toBeNull();
  });
  it('picks the highest and lowest annual return', () => {
    const r = bestAndWeakest([f('A', 0.1), f('B', 0.22), f('C', -0.02), f('D', null)])!;
    expect(r.best.name).toBe('B');
    expect(r.weakest.name).toBe('C');
  });
});

describe('largestShare', () => {
  it('returns the biggest and its share', () => {
    const r = largestShare([{ amount: 30 }, { amount: 70 }])!;
    expect(r.row.amount).toBe(70);
    expect(r.share).toBeCloseTo(0.7, 10);
    expect(largestShare([])).toBeNull();
  });
});

describe('attentionItems', () => {
  const none: AttentionInput = {
    today: TODAY,
    toConfirm: { count: 0, amount: 0 },
    overdueLoans: [],
    maturingSoon: { count: 0, amount: 0, days: 30 },
    staleBalances: 0,
    noValue: 0,
    uninsured: { amount: 0, banks: 0, limit: 500_000 },
    inboxReview: 0,
    tasks: [],
    taskDays: 7,
    policies: [],
    policyDays: 45,
  };
  it('is empty when nothing needs a person', () => {
    expect(attentionItems(none)).toEqual([]);
    expect(
      attentionItems({ ...none, toExplain: { balances: 0, unexplained: 0, funding: 0 } }),
    ).toEqual([]);
  });
  it('sends balances that moved more than expected and deposits with no source to Explain movements', () => {
    const [item] = attentionItems({
      ...none,
      toExplain: { balances: 2, unexplained: 1_250_000, funding: 1 },
    });
    expect(item).toMatchObject({ key: 'explain', tone: 'warn', count: 3, href: '/reconcile' });
    expect(item!.text).toBe(
      '2 balances changed more than expected (₹12.50 L not yet explained, kept out of profit); 1 new deposit with no recorded source: say what they were.',
    );
  });
  it('orders what is late before what is coming before housekeeping', () => {
    const items = attentionItems({
      ...none,
      toConfirm: { count: 2, amount: 1_500_000 },
      overdueLoans: [{ name: 'A. Relative', outstanding: 200_000, daysOverdue: 12 }],
      maturingSoon: { count: 1, amount: 700_000, days: 30 },
      staleBalances: 3,
      noValue: 1,
      uninsured: { amount: 250_000, banks: 2, limit: 500_000 },
      inboxReview: 4,
      tasks: [
        { title: 'late', dueOn: '2026-10-20' },
        { title: 'soon', dueOn: '2026-10-30' },
        { title: 'far', dueOn: '2027-03-01' },
      ],
      policies: [
        { insurer: 'Sample Life', kind: 'renewal', on: '2026-10-01' },
        { insurer: 'Sample Health', kind: 'ends', on: '2026-11-10' },
      ],
    });
    const tones = items.map((x) => x.tone);
    expect(tones).toEqual(
      [...tones].sort(
        (a, b) => ['bad', 'warn', 'info'].indexOf(a) - ['bad', 'warn', 'info'].indexOf(b),
      ),
    );
    expect(items.map((x) => x.key)).toEqual([
      'confirm',
      'loan-A. Relative',
      'tasks-late',
      'policy-late',
      'maturing',
      'tasks-soon',
      'policy-soon',
      'cover',
      'inbox',
      'stale',
      'novalue',
    ]);
    expect(items[0]!.text).toContain('2 matured deposits');
    expect(items.find((x) => x.key === 'tasks-soon')!.count).toBe(1);
    expect(items.find((x) => x.key === 'policy-soon')!.text).toContain(
      'Sample Health policy ends in 15 days',
    );
    expect(items.find((x) => x.key === 'cover')!.href).toBe('/deposits?tab=cover');
  });
  it('says how many funds have no price source and where to match them, after the inbox and before the housekeeping', () => {
    const items = attentionItems({ ...none, inboxReview: 1, fundsNoPrice: 3, staleBalances: 2 });
    expect(items.map((x) => x.key)).toEqual(['inbox', 'noprice', 'stale']);
    expect(items[1]).toMatchObject({
      tone: 'warn',
      count: 3,
      text: '3 funds have no price source: match them.',
      href: '/investments?tab=match',
    });
    expect(attentionItems({ ...none, fundsNoPrice: 1 })[0]!.text).toBe(
      '1 fund has no price source: match it.',
    );
    expect(attentionItems({ ...none, fundsNoPrice: 0 })).toEqual([]);
  });
});

describe('Home settings', () => {
  it('has built-in numbers and falls back to them for anything out of range', () => {
    expect(DEFAULT_CONFIG.home).toEqual({ changeDays: 30, upcomingDays: 120, bankShareWatch: 0.4 });
    const c = configFromJson({ home: { changeDays: 2, upcomingDays: 90, bankShareWatch: 7 } });
    expect(c.home).toEqual({ changeDays: 30, upcomingDays: 90, bankShareWatch: 0.4 });
    expect(configFromJson({ home: { changeDays: 14, bankShareWatch: 0.25 } }).home).toMatchObject({
      changeDays: 14,
      bankShareWatch: 0.25,
    });
  });
});
