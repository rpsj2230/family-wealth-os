import { describe, expect, it } from 'vitest';
import type { ClassCard } from '../src/home';
import { changesSince, moneyPosition, type MoneyPositionInput } from '../src/money-position';

const card = (
  key: ClassCard['key'],
  invested: number,
  current: number,
  maturity = current,
): ClassCard => ({
  key,
  label: key,
  count: 1,
  invested,
  current,
  maturity,
  profit: current - invested,
  profitPct: invested > 0 ? current / invested - 1 : null,
  earned: null,
  today: 0,
  share: 0,
  estimated: key === 'fd',
  awaiting: null,
  foreign: [],
});

const base = (over: Partial<MoneyPositionInput> = {}): MoneyPositionInput => ({
  today: '2026-10-29',
  total: 1_000_000,
  byType: {
    bank_account: 300_000,
    fixed_deposit: 420_000,
    mutual_fund: 230_000,
    receivable: 50_000,
  },
  byOwner: { a: 600_000, b: 400_000 },
  ownerName: { a: 'Asha', b: 'Bala' },
  classes: [
    card('fd', 400_000, 420_000, 460_000),
    card('funds', 200_000, 230_000),
    card('cash', 300_000, 300_000),
  ],
  foreign: [
    {
      currency: 'SGD',
      native: 1_000,
      inr: 65_000,
      rate: 65,
      accounts: 1,
      asOf: '2026-10-20',
      rateDate: '2026-10-28',
      rateLive: true,
    },
  ],
  maturities: [
    { daysLeft: 5, amount: 100_000 },
    { daysLeft: 45, amount: 200_000 },
    { daysLeft: -2, amount: 999 },
  ],
  maturityWindows: [90, 7, 30, 60],
  freshness: { stale: 2, missing: 1, total: 20 },
  monthlySpending: 100_000,
  snapshots: [
    {
      date: '2025-10-01',
      total: 800_000,
      byType: { bank_account: 250_000 },
      byOwner: { a: 500_000 },
    },
    {
      date: '2026-09-28',
      total: 950_000,
      byType: { bank_account: 280_000 },
      byOwner: { a: 580_000, b: 370_000 },
    },
  ],
  ...over,
});

const find = (cards: ReturnType<typeof moneyPosition>, key: string) =>
  cards.find((c) => c.key === key)!;

describe('moneyPosition', () => {
  it('splits cash into rupees and each foreign currency, and the total agrees with the cash card', () => {
    const cards = moneyPosition(base());
    expect(find(cards, 'cash-inr').value).toBe(235_000);
    const sgd = find(cards, 'cash-sgd');
    expect(sgd.native).toEqual({ currency: 'SGD', amount: 1_000 });
    expect(sgd.value).toBe(65_000);
    expect(sgd.lines[0]!.note).toBe('₹65 per SGD, the daily rate on file of 28 Oct 2026');
    expect(find(cards, 'cash-all').value).toBe(300_000);
  });

  it('keeps deposit principal and interest apart and buckets maturities, ignoring those already past', () => {
    const fd = find(moneyPosition(base()), 'fd');
    expect(fd.value).toBe(420_000);
    expect(fd.lines.find((l) => l.label === 'Principal')!.value).toBe(400_000);
    expect(fd.lines.find((l) => l.label.startsWith('Interest'))!.value).toBe(20_000);
    expect(fd.lines.find((l) => l.label === 'Maturing in 7 days')!.value).toBe(100_000);
    expect(fd.lines.find((l) => l.label === 'Maturing in 30 days')!.value).toBe(100_000);
    expect(fd.lines.find((l) => l.label === 'Maturing in 60 days')!.value).toBe(300_000);
    expect(fd.status).toBe('estimated');
  });

  it('never adds funds into cash; liquid assets state their parts', () => {
    const cards = moneyPosition(base());
    expect(find(cards, 'cash-all').value).toBe(300_000);
    const liquid = find(cards, 'liquid');
    expect(liquid.value).toBe(950_000);
    expect(liquid.basis).toContain('Not counted');
    expect(find(cards, 'funds').lines[1]!.value).toBe(30_000);
  });

  it('shows each person, biggest first, with changes against the earlier snapshots', () => {
    const cards = moneyPosition(base());
    const people = find(cards, 'people');
    expect(people.lines.map((l) => [l.label, l.value, l.href])).toEqual([
      ['Asha', 600_000, '/accounts?p=a'],
      ['Bala', 400_000, '/accounts?p=b'],
    ]);
    expect(people.lines[0]!.changes!.month).toEqual({
      since: '2026-09-28',
      amount: 20_000,
      pct: 20_000 / 580_000,
    });
    // Bala has no figure in the year-old snapshot: no change rather than a made-up one
    expect(people.lines[1]!.changes!.year).toBeNull();
    const nw = find(cards, 'networth');
    expect(nw.changes!.month).toEqual({
      since: '2026-09-28',
      amount: 50_000,
      pct: 50_000 / 950_000,
    });
    expect(nw.changes!.year!.since).toBe('2025-10-01');
  });

  it('says months of cover cannot be worked out until spending is entered', () => {
    const cover = find(moneyPosition(base({ monthlySpending: 0 })), 'cover');
    expect(cover.status).toBe('unavailable');
    expect(cover.value).toBeNull();
    const withSpending = find(moneyPosition(base()), 'cover');
    expect(withSpending.lines[0]!.note).toBe('3.0 months');
  });

  it('flags out-of-date records as partial and leaves the foreign card out when all cash is in rupees', () => {
    const cards = moneyPosition(base({ foreign: [] }));
    expect(find(cards, 'stale').status).toBe('partial');
    expect(cards.some((c) => c.key === 'cash-sgd')).toBe(false);
    expect(find(cards, 'cash-inr').value).toBe(300_000);
  });
});

describe('changesSince', () => {
  it('returns no change when no snapshot goes back far enough', () => {
    expect(changesSince('2026-10-29', 10, [], (s) => s.total)).toEqual({
      month: null,
      quarter: null,
      year: null,
    });
  });
  it('gives no percentage against a value of zero', () => {
    const c = changesSince(
      '2026-10-29',
      10,
      [{ date: '2026-09-01', total: 0, byType: {}, byOwner: {} }],
      (s) => s.total,
    );
    expect(c!.month).toEqual({ since: '2026-09-01', amount: 10, pct: null });
  });
});
