import { describe, expect, it } from 'vitest';
import { estimateSavings } from '../src/estimate';
import { fdValueOn } from '../src/fd';
import { bucketOf } from '../src/period-pl';
import { periodAnchor } from '../src/return-profile';
import {
  depositPeriod,
  fundPeriod,
  fundValueOnDay,
  fyStartOn,
  monthStartOn,
  periodDates,
  periodGains,
  periodWindows,
  quarterStartOn,
  recentWindow,
  savingsPeriod,
  spanBetween,
  valueDays,
  type DepositTerms,
  type FundHolding,
  type PeriodWindow,
  type SavingsAccount,
} from '../src/period-gains';

const TODAY = '2026-10-26';
const win = (
  key: PeriodWindow['key'],
  today = TODAY,
  days = 30,
  since: string | null = null,
): PeriodWindow => periodWindows(today, days, since).find((w) => w.key === key)!;
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const fd = (
  o: Partial<DepositTerms> & Pick<DepositTerms, 'bookedOn' | 'maturityOn'>,
): DepositTerms => ({
  assetId: 'fd',
  principal: 100_000,
  rate: 0.07,
  compounding: 'quarterly',
  held: true,
  ...o,
});
const value = (t: DepositTerms, on: string) =>
  fdValueOn({
    principal: t.principal,
    annualRate: t.rate,
    bookedOn: d(t.bookedOn),
    asOf: d(on),
    maturityOn: d(t.maturityOn),
    compounding: t.compounding,
  });

describe('the periods', () => {
  it('are calendar facts, with the length of the first from Settings', () => {
    const ws = periodWindows(TODAY, 30, '2025-09-10');
    expect(ws.map((w) => w.key)).toEqual(['recent', 'month', 'quarter', 'fy', 'lastFy', 'start']);
    expect(ws.map((w) => w.label)).toEqual([
      'Last 30 days',
      'This month',
      'This quarter',
      'This financial year',
      'Last financial year',
      'Since the start',
    ]);
    expect(ws.map((w) => [w.from, w.to, w.through])).toEqual([
      ['2026-09-26', TODAY, TODAY],
      ['2026-10-01', TODAY, TODAY],
      ['2026-10-01', TODAY, TODAY],
      ['2026-04-01', TODAY, TODAY],
      ['2025-04-01', '2026-04-01', '2026-03-31'],
      ['2025-09-10', TODAY, TODAY],
    ]);
    expect(periodWindows(TODAY, 45, null)[0]).toMatchObject({ label: 'Last 45 days', days: 45 });
    expect(periodWindows(TODAY, 1, null)[0]!.label).toBe('Last 1 day');
    expect(recentWindow(TODAY, 1)).toMatchObject({ from: '2026-10-25', to: TODAY, days: 1 });
  });

  it('start the quarter on 1 April, 1 July, 1 October and 1 January', () => {
    expect(quarterStartOn('2027-02-15')).toBe('2027-01-01');
    expect(quarterStartOn('2026-05-09')).toBe('2026-04-01');
    expect(quarterStartOn('2026-09-30')).toBe('2026-07-01');
    expect(quarterStartOn('2026-12-31')).toBe('2026-10-01');
    expect(monthStartOn('2026-02-28')).toBe('2026-02-01');
  });

  it('put the financial year boundary on 1 April, on either side of it', () => {
    expect(fyStartOn('2027-03-31')).toBe('2026-04-01');
    expect(fyStartOn('2027-04-01')).toBe('2027-04-01');
    expect(win('fy', '2027-03-31')).toMatchObject({ from: '2026-04-01', days: 364 });
    expect(win('fy', '2027-04-01')).toMatchObject({ from: '2027-04-01', days: 0 });
    expect(win('lastFy', '2027-04-01')).toMatchObject({
      from: '2026-04-01',
      to: '2027-04-01',
      through: '2027-03-31',
      days: 365,
    });
    // in January the year began the April before
    expect(win('fy', '2027-01-10').from).toBe('2026-04-01');
    expect(win('lastFy', '2027-01-10').from).toBe('2025-04-01');
  });

  it('count a leap day in the year it falls in', () => {
    expect(win('lastFy', '2024-10-15').days).toBe(366);
    expect(win('lastFy', '2025-10-15').days).toBe(365);
    expect(win('start', '2024-03-01', 30, '2024-02-01')).toMatchObject({
      from: '2024-02-01',
      days: 29,
    });
  });

  it('give a day-long month on the first and an empty period before anything is held', () => {
    expect(win('month', '2026-11-01')).toMatchObject({ from: '2026-11-01', days: 0 });
    expect(win('start')).toMatchObject({ from: TODAY, days: 0 });
  });

  it('list the days a fund is valued on: the day before each period and its last day', () => {
    expect(valueDays(win('fy'))).toEqual({ open: '2026-03-31', close: TODAY });
    expect(valueDays(win('lastFy'))).toEqual({ open: '2025-03-31', close: '2026-03-31' });
    expect(periodDates(TODAY, 30)).toEqual([
      '2025-03-31',
      '2026-03-31',
      '2026-09-25',
      '2026-09-30',
      TODAY,
    ]);
  });
});

describe('fixed deposits', () => {
  it('earn, in a period, the value at the end less the value at the start on their own terms', () => {
    const t = fd({ bookedOn: '2025-12-01', maturityOn: '2027-12-01' });
    const p = depositPeriod([t], win('fy'), TODAY);
    expect(p.profit).toBeCloseTo(value(t, TODAY) - value(t, '2026-04-01'), 6);
    expect(p.startValue).toBeCloseTo(value(t, '2026-04-01'), 6);
    // nothing moved, so the per cent is exactly the profit over the value at the start
    expect(p.putIn).toBe(0);
    expect(p.takenOut).toBe(0);
    expect(p.pct).toBeCloseTo(p.profit / p.startValue, 10);
    expect(p.estimated).toBe(false);
  });

  it('start a deposit booked inside the period at its principal, and do not count the new money as profit', () => {
    const t = fd({ bookedOn: '2026-10-06', maturityOn: '2027-10-06', principal: 500_000 });
    const p = depositPeriod([t], win('recent'), TODAY);
    expect(p.startValue).toBe(0);
    expect(p.putIn).toBe(500_000);
    expect(p.profit).toBeCloseTo(value(t, TODAY) - 500_000, 6);
    expect(p.profit).toBeGreaterThan(0);
    expect(p.profit).toBeLessThan(2_500);
    // the money was at work for 20 of the 30 days: the per cent is of that, not of nothing
    expect(p.base).toBeCloseTo((500_000 * 20) / 30, 6);
    expect(p.pct).toBeCloseTo(p.profit / p.base, 10);
  });

  it('count a deposit booked on the first day as put in during the period, and one booked the day before as held', () => {
    const on = fd({ bookedOn: '2026-10-01', maturityOn: '2027-10-01' });
    const p = depositPeriod([on], win('month'), TODAY);
    expect(p.putIn).toBe(100_000);
    expect(p.startValue).toBe(0);
    expect(p.profit).toBeCloseTo(value(on, TODAY) - 100_000, 6);
    expect(p.base).toBeCloseTo(100_000, 6);
    const before = fd({ bookedOn: '2026-09-30', maturityOn: '2027-09-30' });
    const q = depositPeriod([before], win('month'), TODAY);
    expect(q.putIn).toBe(0);
    expect(q.startValue).toBeCloseTo(value(before, '2026-10-01'), 6);
  });

  it('count the interest of a deposit that matured inside the period, and not its payout', () => {
    const t = fd({
      bookedOn: '2025-10-10',
      maturityOn: '2026-10-10',
      held: false,
      endedOn: '2026-10-10',
    });
    const p = depositPeriod([t], win('recent'), TODAY);
    const payout = value(t, '2026-10-10');
    expect(p.takenOut).toBeCloseTo(payout, 6);
    expect(p.endValue).toBe(0);
    expect(p.profit).toBeCloseTo(payout - value(t, '2026-09-26'), 6);
    // earlier periods are not touched by the payout, and later ones see nothing of it
    const before = depositPeriod([t], spanBetween('2026-01-01', '2026-02-01'), TODAY);
    expect(before.profit).toBeCloseTo(value(t, '2026-02-01') - value(t, '2026-01-01'), 6);
    const after = depositPeriod([t], spanBetween('2026-10-11', TODAY, TODAY), TODAY);
    expect(after.empty).toBe(true);
    expect(after.profit).toBe(0);
    // paid out on the first day of a period: it was held at the start, so the day's interest is the period's
    const onFirst = depositPeriod([t], spanBetween('2026-10-10', TODAY, TODAY), TODAY);
    expect(onFirst.startValue).toBeCloseTo(payout, 6);
    expect(onFirst.takenOut).toBeCloseTo(payout, 6);
    expect(onFirst.profit).toBeCloseTo(0, 6);
  });

  it('treat a renewal as a new deposit: the payout and the new booking cancel, only interest is profit', () => {
    const old = fd({
      assetId: 'old',
      bookedOn: '2025-10-10',
      maturityOn: '2026-10-10',
      held: false,
      endedOn: '2026-10-10',
    });
    const payout = value(old, '2026-10-10');
    const renewed = fd({
      assetId: 'new',
      bookedOn: '2026-10-10',
      maturityOn: '2027-10-10',
      principal: payout,
    });
    const p = depositPeriod([old, renewed], win('recent'), TODAY);
    expect(p.putIn).toBeCloseTo(payout, 6);
    expect(p.takenOut).toBeCloseTo(payout, 6);
    expect(p.profit).toBeCloseTo(
      value(renewed, TODAY) - payout + (payout - value(old, '2026-09-26')),
      6,
    );
  });

  it('stop earning at the maturity date even while the deposit waits to be confirmed', () => {
    const t = fd({ bookedOn: '2025-10-05', maturityOn: '2026-10-05' });
    const p = depositPeriod([t], win('recent'), TODAY);
    expect(p.profit).toBeCloseTo(value(t, '2026-10-05') - value(t, '2026-09-26'), 6);
    // nothing is added after the date
    expect(depositPeriod([t], spanBetween('2026-10-06', TODAY, TODAY), TODAY).profit).toBeCloseTo(
      0,
      8,
    );
  });

  it('assume the maturity date for a deposit that is no longer held and has no recorded end', () => {
    const t = fd({ bookedOn: '2025-02-01', maturityOn: '2026-02-01', held: false });
    const p = depositPeriod([t], win('lastFy'), TODAY);
    expect(p.takenOut).toBeCloseTo(value(t, '2026-02-01'), 6);
    // one that is closed before it matures and has an end date uses it
    const early = fd({
      bookedOn: '2025-02-01',
      maturityOn: '2027-02-01',
      held: false,
      endedOn: '2026-02-01',
    });
    expect(depositPeriod([early], win('lastFy'), TODAY).takenOut).toBeCloseTo(
      value(early, '2026-02-01'),
      6,
    );
    // an end date in the future is cut at today
    const future = fd({
      bookedOn: '2026-01-01',
      maturityOn: '2027-12-31',
      held: false,
      endedOn: '2027-01-01',
    });
    const all = depositPeriod([future], win('start', TODAY, 30, '2026-01-01'), TODAY);
    expect(all.takenOut).toBeCloseTo(value(future, TODAY), 6);
    expect(all.profit).toBeCloseTo(value(future, TODAY) - future.principal, 6);
  });

  it('count a leap day and cross the financial year boundary', () => {
    const t = fd({
      bookedOn: '2023-04-01',
      maturityOn: '2027-04-01',
      compounding: 'simple',
      rate: 0.1,
    });
    const today = '2024-10-15';
    const last = depositPeriod([t], win('lastFy', today), today);
    // 2023-04-01 to 2024-04-01 is 366 days of simple interest on a 365-day year; booked on the first day, so put in during the year
    expect(last.profit).toBeCloseTo((100_000 * 0.1 * 366) / 365, 6);
    expect(last.putIn).toBe(100_000);
    const here = depositPeriod([t], win('fy', today), today);
    expect(here.profit).toBeCloseTo((100_000 * 0.1 * 197) / 365, 6);
    // the two years join up without a gap or an overlap
    const both = depositPeriod([t], spanBetween('2023-04-01', today, today), today);
    expect(last.profit + here.profit).toBeCloseTo(both.profit, 6);
  });

  it('add up: the profit of consecutive periods is the profit of the whole', () => {
    const ds = [
      fd({ assetId: 'a', bookedOn: '2025-05-01', maturityOn: '2027-05-01' }),
      fd({ assetId: 'b', bookedOn: '2026-05-20', maturityOn: '2027-05-20', principal: 250_000 }),
      fd({
        assetId: 'c',
        bookedOn: '2025-08-01',
        maturityOn: '2026-08-01',
        held: false,
        endedOn: '2026-08-01',
      }),
    ];
    const parts = [
      spanBetween('2025-04-01', '2026-04-01'),
      spanBetween('2026-04-01', '2026-09-26'),
      spanBetween('2026-09-26', TODAY, TODAY),
    ].map((w) => depositPeriod(ds, w, TODAY).profit);
    const whole = depositPeriod(ds, spanBetween('2025-04-01', TODAY, TODAY), TODAY).profit;
    expect(parts.reduce((a, b) => a + b, 0)).toBeCloseTo(whole, 6);
  });

  it('show nothing for no deposits, and nothing before the first was booked', () => {
    expect(depositPeriod([], win('fy'), TODAY)).toMatchObject({
      empty: true,
      profit: 0,
      pct: null,
    });
    const t = fd({ bookedOn: '2026-10-20', maturityOn: '2027-10-20' });
    expect(depositPeriod([t], win('lastFy'), TODAY).empty).toBe(true);
  });

  it('ignore a deposit with no principal and one that left before it was booked', () => {
    const none = fd({ bookedOn: '2026-01-01', maturityOn: '2027-01-01', principal: 0 });
    const odd = fd({
      bookedOn: '2026-05-01',
      maturityOn: '2027-05-01',
      held: false,
      endedOn: '2026-04-01',
    });
    expect(depositPeriod([none, odd], win('fy'), TODAY).empty).toBe(true);
  });
});

describe('mutual funds', () => {
  const fund = (o: Partial<FundHolding> = {}): FundHolding => ({
    assetId: 'f',
    name: 'Fund',
    value: 1_210,
    points: [
      { date: '2026-03-31', value: 1_000 },
      { date: '2026-09-25', value: 1_100 },
      { date: '2026-09-30', value: 1_120 },
      { date: TODAY, value: 1_210 },
    ],
    flows: [{ date: '2026-01-10', amount: 900 }],
    hasStatement: true,
    estimatedSince: null,
    ...o,
  });

  it('read the value on a day: the last one on or before it, nothing before the first, today as Investments shows it', () => {
    const f = fund();
    expect(fundValueOnDay(f, '2026-04-01', TODAY)).toBe(1_000);
    expect(fundValueOnDay(f, '2026-09-27', TODAY)).toBe(1_100);
    expect(fundValueOnDay(f, '2026-03-30', TODAY)).toBe(0);
    expect(fundValueOnDay({ ...f, value: 1_300 }, TODAY, TODAY)).toBe(1_300);
  });

  it('profit is the change in value less the money put in', () => {
    const p = fundPeriod([fund()], win('recent'), TODAY);
    expect(p.startValue).toBe(1_100);
    expect(p.endValue).toBe(1_210);
    expect(p.profit).toBe(110);
    expect(p.pct).toBeCloseTo(0.1, 10);
    expect(p.putIn).toBe(0);
    expect(p.estimated).toBe(false);
  });

  it('does not count money put in during the period as profit', () => {
    const f = fund({
      value: 2_420,
      flows: [
        { date: '2026-01-10', amount: 900 },
        { date: '2026-10-05', amount: 1_150 },
      ],
    });
    const p = fundPeriod([f], win('recent'), TODAY);
    expect(p.putIn).toBe(1_150);
    expect(p.profit).toBe(2_420 - 1_100 - 1_150);
    expect(p.base).toBeCloseTo(1_100 + (1_150 * 21) / 30, 6);
  });

  it('counts money moved on the first day of the period, and not on the day before it', () => {
    const f = fund({
      flows: [
        { date: '2026-09-25', amount: 50 },
        { date: '2026-09-26', amount: 70 },
      ],
    });
    expect(fundPeriod([f], win('recent'), TODAY).putIn).toBe(70);
  });

  it('counts a fund bought and then sold inside the period, realised gain included', () => {
    const f = fund({
      value: 0,
      points: [
        { date: '2026-10-05', value: 1_100 },
        { date: '2026-10-23', value: 0 },
      ],
      flows: [
        { date: '2026-10-01', amount: 1_100 },
        { date: '2026-10-23', amount: -1_200 },
      ],
    });
    const p = fundPeriod([f], win('recent'), TODAY);
    expect(p.startValue).toBe(0);
    expect(p.endValue).toBe(0);
    expect(p.putIn).toBe(1_100);
    expect(p.takenOut).toBe(1_200);
    expect(p.profit).toBe(100);
    // a fund that was sold before the period began adds nothing to it
    expect(fundPeriod([f], spanBetween('2026-10-24', TODAY, TODAY), TODAY).empty).toBe(true);
  });

  it('counts a sale of part of the holding: the gain on what was sold is profit of that period', () => {
    const f = fund({ value: 605, flows: [{ date: '2026-10-23', amount: -600 }] });
    const p = fundPeriod([f], win('recent'), TODAY);
    // 1,100 at the start; 605 left plus 600 received = 1,205
    expect(p.profit).toBe(605 + 600 - 1_100);
    expect(p.takenOut).toBe(600);
  });

  it('adds up: consecutive periods give the period as a whole', () => {
    const f = fund({
      value: 1_815,
      points: [
        { date: '2026-03-31', value: 1_000 },
        { date: '2026-09-25', value: 1_100 },
        { date: '2026-10-22', value: 1_650 },
        { date: TODAY, value: 1_815 },
      ],
      flows: [
        { date: '2026-01-10', amount: 900 },
        { date: '2026-09-28', amount: 500 },
      ],
    });
    const a = fundPeriod([f], spanBetween('2026-04-01', '2026-09-26'), TODAY).profit;
    const b = fundPeriod([f], spanBetween('2026-09-26', '2026-10-23'), TODAY).profit;
    const c = fundPeriod([f], spanBetween('2026-10-23', TODAY, TODAY), TODAY).profit;
    expect(a + b + c).toBeCloseTo(
      fundPeriod([f], spanBetween('2026-04-01', TODAY, TODAY), TODAY).profit,
      8,
    );
  });

  it('marks a figure estimated from the day the estimate starts to matter, and only when the fund is in the period', () => {
    const assumed = fund({ estimatedSince: '2026-10-05' });
    expect(fundPeriod([assumed], win('recent'), TODAY).estimated).toBe(true);
    // a period that ended before the first assumed instalment is exact
    expect(fundPeriod([assumed], win('lastFy'), TODAY).estimated).toBe(false);
    // a fund with no statement is estimated from its first day
    const plan = fund({ hasStatement: false, estimatedSince: '2026-01-10' });
    expect(fundPeriod([plan], win('fy'), TODAY).estimated).toBe(true);
    expect(fundPeriod([], win('recent'), TODAY).estimated).toBe(false);
    // not held in the period: nothing to estimate
    const gone = fund({ estimatedSince: '2026-01-10', value: 0, points: [], flows: [] });
    expect(fundPeriod([gone], win('fy'), TODAY).estimated).toBe(false);
  });

  it('shows nothing for no funds and for money only just put in', () => {
    expect(fundPeriod([], win('fy'), TODAY)).toMatchObject({ empty: true, profit: 0 });
    const f = fund({ value: 1_000, points: [], flows: [{ date: TODAY, amount: 1_000 }] });
    const p = fundPeriod([f], win('recent'), TODAY);
    expect(p.putIn).toBe(1_000);
    expect(p.profit).toBe(0);
  });
});

describe('savings and cash', () => {
  const acct = (o: Partial<SavingsAccount> = {}): SavingsAccount => ({
    assetId: 'a',
    currency: 'INR',
    rate: 0.04,
    tdsRate: 0.1,
    balances: [{ date: '2026-08-01', amount: 100_000 }],
    ...o,
  });

  it('earn the balance at the rate after tax at source, day by day', () => {
    const p = savingsPeriod([acct()], win('recent'));
    expect(p.profit).toBeCloseTo((100_000 * 0.04 * 0.9 * 30) / 365, 8);
    expect(p.estimated).toBe(true);
    expect(p.putIn).toBe(0);
    expect(p.pct).toBeCloseTo(p.profit / 100_000, 10);
  });

  it('end the period at the same value the portfolio gives for today', () => {
    const p = savingsPeriod([acct()], win('recent'));
    const est = estimateSavings({
      balance: 100_000,
      balanceAsOf: d('2026-08-01'),
      today: d(TODAY),
      annualRate: 0.04,
      tdsRate: 0.1,
    });
    expect(p.endValue).toBeCloseTo(est.estimatedAmount, 8);
  });

  it('carry the last recorded balance forward, and start again from a new record', () => {
    const a = acct({
      balances: [
        { date: '2026-08-01', amount: 100_000 },
        { date: '2026-10-11', amount: 400_000 },
      ],
    });
    const p = savingsPeriod([a], win('recent'));
    const net = 0.04 * 0.9;
    // 15 days on 1 lakh (26 Sep to 11 Oct), then 15 days on 4 lakh
    expect(p.profit).toBeCloseTo((100_000 * net * 15 + 400_000 * net * 15) / 365, 8);
    // the 3 lakh paid in is not profit: the average balance is the money at work
    expect(p.base).toBeCloseTo((100_000 * 15 + 400_000 * 15) / 30, 6);
  });

  it('does not treat a withdrawal as a loss', () => {
    const a = acct({
      balances: [
        { date: '2026-08-01', amount: 400_000 },
        { date: '2026-10-11', amount: 100_000 },
      ],
    });
    expect(savingsPeriod([a], win('recent')).profit).toBeGreaterThan(0);
  });

  it('earn nothing before the first record and from the day of it onward', () => {
    const a = acct({ balances: [{ date: '2026-10-16', amount: 200_000 }] });
    const p = savingsPeriod([a], win('recent'));
    expect(p.profit).toBeCloseTo((200_000 * 0.04 * 0.9 * 10) / 365, 8);
    expect(p.startValue).toBe(0);
    expect(savingsPeriod([a], win('lastFy')).empty).toBe(true);
    expect(savingsPeriod([acct({ balances: [] })], win('fy')).empty).toBe(true);
  });

  it('count a day of two records once and the later one wins', () => {
    const a = acct({
      balances: [
        { date: '2026-10-01', amount: 50_000 },
        { date: '2026-10-01', amount: 100_000 },
      ],
    });
    expect(savingsPeriod([a], win('month')).profit).toBeCloseTo(
      (100_000 * 0.04 * 0.9 * 25) / 365,
      8,
    );
  });

  it('gives a foreign-currency balance no gain: an exchange rate is not interest', () => {
    const usd = acct({ currency: 'USD', balances: [{ date: '2026-01-01', amount: 9_000_000 }] });
    const p = savingsPeriod([usd], win('fy'));
    expect(p.profit).toBe(0);
    expect(p.empty).toBe(true);
    const both = savingsPeriod([acct(), usd], win('recent'));
    expect(both.profit).toBeCloseTo((100_000 * 0.04 * 0.9 * 30) / 365, 8);
  });

  it('adds up: consecutive periods give the period as a whole', () => {
    const a = acct({
      balances: [
        { date: '2026-04-20', amount: 80_000 },
        { date: '2026-07-02', amount: 120_000 },
        { date: '2026-10-11', amount: 90_000 },
      ],
    });
    const cut = ['2026-04-01', '2026-07-01', '2026-10-01', TODAY];
    let sum = 0;
    for (let k = 1; k < cut.length; k++)
      sum += savingsPeriod([a], spanBetween(cut[k - 1]!, cut[k]!)).profit;
    expect(sum).toBeCloseTo(savingsPeriod([a], spanBetween(cut[0]!, TODAY, TODAY)).profit, 8);
  });
});

describe('periodGains', () => {
  const input = () => ({
    today: TODAY,
    recentDays: 30,
    deposits: [
      fd({ assetId: 'a', bookedOn: '2025-05-01', maturityOn: '2027-05-01' }),
      fd({
        assetId: 'z',
        bookedOn: '2025-09-01',
        maturityOn: '2026-09-01',
        held: false,
        endedOn: '2026-09-01',
      }),
    ],
    funds: [
      {
        assetId: 'f',
        name: 'Fund',
        value: 1_210,
        points: [
          { date: '2026-03-31', value: 1_000 },
          { date: '2026-09-25', value: 1_100 },
          { date: TODAY, value: 1_210 },
        ],
        flows: [{ date: '2026-01-10', amount: 900 }],
        hasStatement: true,
        estimatedSince: null,
      },
      {
        assetId: 'g',
        name: 'No statement',
        value: 500,
        points: [
          { date: '2026-03-31', value: 420 },
          { date: '2026-09-25', value: 480 },
          { date: TODAY, value: 500 },
        ],
        flows: [{ date: '2026-02-01', amount: 400 }],
        hasStatement: false,
        estimatedSince: '2026-02-01',
      },
    ],
    accounts: [
      {
        assetId: 's',
        currency: 'INR',
        rate: 0.04,
        tdsRate: 0.1,
        balances: [{ date: '2026-08-01', amount: 100_000 }],
      },
      { assetId: 'u', currency: 'USD', rate: 0, tdsRate: 0, balances: [] },
      { assetId: 'n', currency: 'INR', rate: 0.04, tdsRate: 0.1, balances: [] },
    ],
    othersValue: 8_000_000,
  });

  it('puts every kind of holding and the total in every period', () => {
    const g = periodGains(input());
    expect(g.rows.map((r) => r.key)).toEqual(['fd', 'funds', 'cash', 'others']);
    for (const w of g.windows) {
      const sum = g.rows.reduce((a, r) => a + r.cells[w.key].profit, 0);
      expect(g.total.cells[w.key].profit).toBeCloseTo(sum, 8);
      const put = g.rows.reduce((a, r) => a + r.cells[w.key].putIn, 0);
      expect(g.total.cells[w.key].putIn).toBeCloseTo(put, 8);
    }
    expect(g.since).toBe('2025-05-01');
    expect(g.windows.find((w) => w.key === 'start')!.from).toBe('2025-05-01');
  });

  it('begins "since the start" on the day each kind was first held, against all the money put in', () => {
    const g = periodGains(input());
    expect(g.rows.map((r) => r.since)).toEqual(['2025-05-01', '2026-01-10', '2026-08-01', null]);
    const fdRow = g.rows[0]!.cells.start;
    expect(fdRow.pct).toBeCloseTo(fdRow.profit / fdRow.putIn, 10);
    const [a, z] = input().deposits as [DepositTerms, DepositTerms];
    expect(fdRow.profit).toBeCloseTo(
      value(a, TODAY) - a.principal + (value(z, '2026-09-01') - z.principal),
      6,
    );
  });

  it('shows no profit for the rest of the holdings, only that they are there', () => {
    const g = periodGains(input());
    const others = g.rows.find((r) => r.key === 'others')!;
    for (const w of g.windows) expect(others.cells[w.key].profit).toBe(0);
    expect(others.cells.fy.empty).toBe(false);
    expect(others.cells.fy.pct).toBeNull();
    expect(periodGains({ ...input(), othersValue: 0 }).rows[3]!.cells.fy.empty).toBe(true);
  });

  it('counts what the est. marks rest on', () => {
    const g = periodGains(input());
    expect(g.basis).toEqual({
      fundsFromPlan: 1,
      fundsWithAssumed: 0,
      foreignAccounts: 1,
      accountsWithoutBalance: 1,
      depositsEnded: 1,
      depositsEndedGuessed: 0,
    });
    expect(g.rows.find((r) => r.key === 'fd')!.cells.fy.estimated).toBe(false);
    expect(g.rows.find((r) => r.key === 'funds')!.cells.fy.estimated).toBe(true);
    expect(g.rows.find((r) => r.key === 'cash')!.cells.recent.estimated).toBe(true);
    expect(g.total.cells.fy.estimated).toBe(true);
  });

  it('copes with a household that holds nothing at all', () => {
    const g = periodGains({
      today: TODAY,
      recentDays: 30,
      deposits: [],
      funds: [],
      accounts: [],
      othersValue: 0,
    });
    expect(g.since).toBeNull();
    for (const r of [...g.rows, g.total])
      for (const w of g.windows) {
        expect(r.cells[w.key].empty).toBe(true);
        expect(r.cells[w.key].profit).toBe(0);
        expect(r.cells[w.key].pct).toBeNull();
      }
  });
});

describe('one calendar for every page', () => {
  it('the profit-and-loss buckets and the return anchors start where the shared periods start', () => {
    for (const day of ['2026-04-01', '2026-06-30', '2026-10-26', '2027-01-01', '2027-03-31']) {
      expect(bucketOf(day, 'quarter').start).toBe(quarterStartOn(day));
      expect(bucketOf(day, 'month').start).toBe(monthStartOn(day));
      expect(bucketOf(day, 'fy').start).toBe(fyStartOn(day));
      // the return tables open the year on the close of the day before it, the day a fund is valued on to start it
      expect(periodAnchor('fy', day)).toBe(valueDays(win('fy', day)).open);
    }
  });
});
