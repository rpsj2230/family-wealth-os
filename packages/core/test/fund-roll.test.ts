/**
 * Funds with no transaction ledger. The live pattern: the monthly sheet is all there is for a dozen funds, and the value of each
 * stepped from one sheet record to the next, which "last 30 days" counted as a 16% gain. A fund is worth units times the price of the
 * day; with no ledger the units are rebuilt from the plan the household gave (start date, amount invested, SIP amount and its
 * changes), and the sheet's value is the last resort only. Invented numbers.
 */
import { describe, expect, it } from 'vitest';
import {
  fundsOf,
  fundPeriod,
  fundValueFrom,
  navOnOrAfter,
  planLedger,
  positionAsOf,
  positionGains,
  spanBetween,
  valueOn,
  valuationHistory,
  type PosFund,
  type PositionAsset,
  type PositionConfig,
  type PositionInput,
} from '../src';

const TODAY = '2026-10-28';
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const days = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};
const isWeekend = (d: string) => [0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay());

// one price on each weekday, rising a little each day, with a real fall on 12 Oct
const navs = days('2026-02-20', TODAY)
  .filter((d) => !isWeekend(d))
  .map((date) => {
    const k = (Date.parse(date) - Date.parse('2026-02-20')) / 86_400_000;
    return { date, nav: 100 * Math.pow(1.0004, k) * (date >= '2026-10-12' ? 0.97 : 1) };
  });
const N = (d: string) => {
  const n = [...navs].reverse().find((x) => x.date <= d);
  return n!.nav;
};
/** the price the fund house deals at for money in on a day: that day's, or the next day priced */
const dealt = (d: string) => navs.find((x) => x.date >= d)!.nav;

const SIP = 10_000;
const PLAN = { monthly: SIP, startedOn: '2026-03-05', stopped: false };
const instalmentDates = ['03', '04', '05', '06', '07', '08', '09', '10'].map((m) => `2026-${m}-05`);
const unitsAt = (d: string) =>
  instalmentDates.filter((x) => x <= d).reduce((a, x) => a + SIP / dealt(x), 0);
const planValue = (d: string) => unitsAt(d) * N(d);

const cfg = (over: Partial<PositionConfig> = {}): PositionConfig => ({
  today: TODAY,
  savingsRate: 0.03,
  tdsRate: 0,
  navGapDays: 10,
  rateGap: 0.02,
  growth: { property: 0, retirement: 0, other: 0 },
  fx: {},
  ...over,
});
const fundOf = (over: Partial<PosFund> = {}): PosFund => ({
  txns: [],
  navs,
  units: null,
  snapshots: [],
  flows: [],
  hasStatement: false,
  estimatedSince: '0000-01-01',
  sip: PLAN,
  // seven instalments (March to September) were recorded as invested on the day of the last sheet value
  plan: { invested: 7 * SIP, startedOn: '2026-03-05' },
  ...over,
});
/** the sheet values: they do NOT agree with the plan and the prices (₹45,000 more at the end of September) */
const SHEET = [
  { date: '2026-08-31', amount: planValue('2026-08-31') + 3_000 },
  { date: '2026-09-30', amount: planValue('2026-09-30') + 45_000 },
];
const asset = (over: Partial<PositionAsset> = {}): PositionAsset => ({
  assetId: 'f1',
  ownerId: 'o1',
  type: 'mutual_fund',
  status: 'active',
  name: 'Invented Equity Fund',
  currency: 'INR',
  rate: { own: null, listed: null, tds: null },
  records: SHEET.map((r) => ({ ...r, currency: 'INR', fxRate: null, sheet: true })),
  fd: null,
  fund: fundOf(),
  ...over,
});
const input = (
  assets: PositionAsset[],
  c: PositionConfig = cfg(),
  current?: PositionInput['current'],
): PositionInput => ({ assets, config: c, ...(current ? { current } : {}) });

describe('the plan rebuilt as purchases', () => {
  it('buys each instalment at the price of its day, or of the next day priced', () => {
    const pl = planLedger(
      { startedOn: '2026-03-05', invested: 7 * SIP, investedAsOf: '2026-09-30', sip: PLAN },
      navs,
      TODAY,
      { gapDays: 10, tolerance: 0.02 },
    )!;
    expect(pl.lines.map((l) => l.date)).toEqual(instalmentDates);
    expect(pl.adjusted).toBe('none');
    expect(pl.moneyIn).toBe(8 * SIP);
    // 5 Sep 2026 is a Saturday: the price is Monday's
    const sep = pl.lines.find((l) => l.date === '2026-09-05')!;
    expect(sep.navDate).toBe('2026-09-07');
    expect(sep.units).toBeCloseTo(SIP / N('2026-09-07'), 9);
    expect(navOnOrAfter(navs, '2026-09-05', 10)?.date).toBe('2026-09-07');
    expect(navOnOrAfter(navs, '2026-09-05', 1)).toBeNull();
  });

  it('adds an opening purchase when the money invested is more than the plan explains', () => {
    const pl = planLedger(
      {
        startedOn: '2026-03-05',
        invested: 7 * SIP + 50_000,
        investedAsOf: '2026-09-30',
        sip: PLAN,
      },
      navs,
      TODAY,
      { gapDays: 10, tolerance: 0.02 },
    )!;
    expect(pl.adjusted).toBe('opening');
    expect(pl.lines[0]).toMatchObject({ kind: 'opening', date: '2026-03-05', amount: 50_000 });
    expect(pl.gap).toBeCloseTo(50_000, 6);
  });

  it('scales the instalments down when the plan puts in more than was invested, never inventing units', () => {
    const pl = planLedger(
      { startedOn: '2026-03-05', invested: 35_000, investedAsOf: '2026-09-30', sip: PLAN },
      navs,
      TODAY,
      { gapDays: 10, tolerance: 0.02 },
    )!;
    expect(pl.adjusted).toBe('scaled');
    expect(pl.lines.slice(0, 7).reduce((a, l) => a + l.amount, 0)).toBeCloseTo(35_000, 6);
  });

  it('leaves out an instalment that has no price yet, and says how many', () => {
    const late = navs.filter((n) => n.date >= '2026-05-20');
    const pl = planLedger(
      { startedOn: '2026-03-05', invested: 0, investedAsOf: null, sip: PLAN },
      late,
      TODAY,
      { gapDays: 10, tolerance: 0.02 },
    )!;
    expect(pl.skipped).toBe(3);
    expect(pl.lines[0]!.date).toBe('2026-06-05');
  });

  it('has nothing to build from without a start date, prices, or any money', () => {
    const spec = { startedOn: null, invested: 1000, investedAsOf: null, sip: null };
    expect(planLedger(spec, navs, TODAY, { gapDays: 10, tolerance: 0.02 })).toBeNull();
    expect(
      planLedger({ ...spec, startedOn: '2026-03-05' }, [], TODAY, { gapDays: 10, tolerance: 0.02 }),
    ).toBeNull();
    expect(
      planLedger({ ...spec, startedOn: '2026-03-05', invested: 0 }, navs, TODAY, {
        gapDays: 10,
        tolerance: 0.02,
      }),
    ).toBeNull();
  });
});

describe('a fund with only monthly values: units from the plan times the price of the day', () => {
  const pos = input([asset()]);
  const v = (d: string) => valueOn(pos.assets[0]!, d, pos.config).value!;

  it('is worth the units its plan bought times the price, whatever the sheet says', () => {
    for (const d of ['2026-03-05', '2026-06-18', '2026-09-27', '2026-09-30', '2026-10-15', TODAY])
      expect(v(d)).toBeCloseTo(planValue(d), 6);
    expect(valueOn(pos.assets[0]!, '2026-09-27', pos.config)).toMatchObject({
      basis: 'units_nav',
      estimated: true,
    });
    expect(valueOn(pos.assets[0]!, '2026-09-27', pos.config).note).toContain('SIP plan');
    expect(fundValueFrom(pos.assets[0]!, pos.config)).toBe('plan');
  });

  it('is not held before its plan begins', () => {
    expect(valueOn(pos.assets[0]!, '2026-03-04', pos.config).state).toBe('not_yet');
  });

  it('has no step on a sheet date and none on 15 Oct: it moves with the price, and by an instalment on its day', () => {
    for (const d of days('2026-09-08', TODAY).filter((x) => !isWeekend(x))) {
      const was = [...navs].reverse().find((x) => x.date < d)!.date;
      const move = v(d) - (v(was) * N(d)) / N(was);
      if (d === '2026-10-05') expect(move).toBeCloseTo((SIP / dealt(d)) * N(d), 6);
      else expect(Math.abs(move)).toBeLessThan(1e-6);
    }
    expect(positionAsOf(pos, '2026-10-15').noData).toBe(0);
  });

  it('adds an instalment on its due day, even a weekend, at the next price', () => {
    // Sat 5 Sep: units bought; the value on Sat 5 Sep is the Friday price times the new units
    const fri = v('2026-09-04');
    const sat = v('2026-09-05');
    expect(sat - (fri * N('2026-09-05')) / N('2026-09-04')).toBeCloseTo(
      (SIP / dealt('2026-09-05')) * N('2026-09-05'),
      6,
    );
  });
});

describe('last 30 days (28 Sep to 28 Oct) on that fund', () => {
  const pos = input([asset()]);
  const g = positionGains({ position: pos, recentDays: 30 });
  const t = g.tiles.find((x) => x.key === 'recent')!;
  const funds = g.periods.rows.find((r) => r.key === 'funds')!.cells.recent;

  it('the profit is the growth of the units held, the instalment is money put in, nothing is set apart', () => {
    const exact = planValue(TODAY) - planValue('2026-09-27') - SIP;
    expect(funds.profit).toBeCloseTo(exact, 4);
    expect(t.amount).toBeCloseTo(exact, 4);
    expect(funds.putIn).toBeCloseTo(SIP, 6);
    expect(funds.takenOut).toBe(0);
    expect(funds.unexplained).toBe(0);
    expect(funds.unexplainedFunds).toBe(0);
    expect(funds.estimated).toBe(true);
    // a few per cent of a month at most, with a real 3% fall in it, not 16%
    expect(Math.abs(funds.pct!)).toBeLessThan(0.05);
  });

  it('does not change when the sheet values change, because they are not used', () => {
    const other = positionGains({
      position: input([
        asset({
          records: SHEET.map((r) => ({
            ...r,
            amount: r.amount * 1.5,
            currency: 'INR',
            fxRate: null,
            sheet: true,
          })),
        }),
      ]),
      recentDays: 30,
    });
    expect(other.periods.rows.find((r) => r.key === 'funds')!.cells.recent.profit).toBeCloseTo(
      funds.profit,
      9,
    );
  });

  it('the change in value is the profit plus the money put in', () => {
    expect(funds.endValue - funds.startValue).toBeCloseTo(funds.profit + funds.putIn, 4);
  });

  it('a window around the sheet date sees only the growth', () => {
    const w = spanBetween('2026-09-29', '2026-10-02');
    const cell = fundPeriod(fundsOf(pos, ['2026-09-28', '2026-10-01']), w, TODAY);
    expect(cell.profit).toBeCloseTo(planValue('2026-10-01') - planValue('2026-09-28'), 4);
    expect(cell.putIn).toBe(0);
  });

  it('the financial year counts every instalment as money in and none of the first value as gain', () => {
    const fy = g.periods.rows.find((r) => r.key === 'funds')!.cells.fy;
    expect(fy.putIn).toBeCloseTo(7 * SIP, 6); // April to October: 5 Mar is before the year began
    expect(fy.profit).toBeCloseTo(planValue(TODAY) - planValue('2026-03-31') - 7 * SIP, 4);
  });

  it('says where the value comes from', () => {
    expect(g.periods.basis).toMatchObject({
      fundsHeld: 1,
      fundsHeldWithoutLedger: 1,
      fundsValuedFromLedger: 0,
      fundsValuedFromPlan: 1,
      fundsValuedFromRecords: 0,
    });
  });
});

describe('today', () => {
  it('is units times the latest price, and a difference from net worth’s figure is reported, not made into profit', () => {
    const base = input([asset()]);
    const rolled = valueOn(base.assets[0]!, TODAY, base.config).value!;
    expect(rolled).toBeCloseTo(planValue(TODAY), 6);
    const same = positionGains({
      position: input([asset()], cfg(), { f1: { value: rolled, counted: true } }),
      recentDays: 30,
    });
    const off = positionGains({
      position: input([asset()], cfg(), { f1: { value: rolled + 12_345, counted: true } }),
      recentDays: 30,
    });
    const a = same.periods.rows.find((r) => r.key === 'funds')!.cells.recent;
    const b = off.periods.rows.find((r) => r.key === 'funds')!.cells.recent;
    expect(a.unexplained).toBe(0);
    expect(b.unexplained).toBeCloseTo(12_345, 4);
    expect(b.profit).toBeCloseTo(a.profit, 4);
    expect(b.endValue).toBeCloseTo(a.endValue + 12_345, 4);
  });
});

describe('Settings and the plan', () => {
  it('without the assumed instalments (Settings) the plan is not used and the value on file is the last resort', () => {
    const pos = input([asset()], cfg({ includeSip: false }));
    expect(fundValueFrom(pos.assets[0]!, pos.config)).toBe('plan'); // an amount invested still builds an opening purchase
    const none = input([asset({ fund: fundOf({ plan: null }) })], cfg({ includeSip: false }));
    expect(fundValueFrom(none.assets[0]!, none.config)).toBe('records');
  });

  it('follows a changed SIP amount without rewriting earlier instalments', () => {
    const changed = asset({
      fund: fundOf({ sip: { ...PLAN, changes: [{ from: '2026-10-01', monthly: 25_000 }] } }),
    });
    const c = positionGains({ position: input([changed]), recentDays: 30 }).periods.rows.find(
      (r) => r.key === 'funds',
    )!.cells.recent;
    expect(c.putIn).toBeCloseTo(25_000, 6);
  });

  it('a stopped plan makes no more instalments', () => {
    const stopped = asset({
      fund: fundOf({
        sip: { ...PLAN, stopped: true, changes: [{ from: '2026-09-01', monthly: 0 }] },
      }),
    });
    const c = positionGains({ position: input([stopped]), recentDays: 30 }).periods.rows.find(
      (r) => r.key === 'funds',
    )!.cells.recent;
    expect(c.putIn).toBe(0);
  });
});

describe('a unit count on file is real', () => {
  it('holds those units from its day, plus the purchases the plan makes after it, and the difference is carried apart', () => {
    const counted = 1_000;
    const withUnits = asset({ fund: fundOf({ units: { units: counted, asOf: '2026-09-30' } }) });
    const pos = input([withUnits]);
    expect(valueOn(withUnits, '2026-09-29', pos.config).value).toBeCloseTo(
      planValue('2026-09-29'),
      6,
    );
    const after = counted * N('2026-10-06') + (SIP / dealt('2026-10-05')) * N('2026-10-06');
    expect(valueOn(withUnits, '2026-10-06', pos.config).value).toBeCloseTo(after, 6);
    const g = positionGains({ position: pos, recentDays: 30 }).periods.rows.find(
      (r) => r.key === 'funds',
    )!.cells.recent;
    expect(g.unexplained).toBeCloseTo((counted - unitsAt('2026-09-30')) * N('2026-09-30'), 4);
    expect(g.unexplainedFunds).toBe(1);
  });
});

describe('the last resort: no plan, so the newest value on file moved with the price', () => {
  const lastResort = asset({ fund: fundOf({ sip: null, plan: null }) });
  const pos = input([lastResort]);

  it('is labelled, moved with the price and re-based to each newer value', () => {
    const x = valueOn(lastResort, '2026-09-27', pos.config);
    expect(x).toMatchObject({ basis: 'sheet', estimated: true, asOf: '2026-08-31' });
    expect(x.note).toContain('last resort');
    expect(x.value).toBeCloseTo((SHEET[0]!.amount * N('2026-09-27')) / N('2026-08-31'), 6);
    expect(valueOn(lastResort, '2026-09-30', pos.config).value).toBeCloseTo(SHEET[1]!.amount, 6);
    expect(fundValueFrom(lastResort, pos.config)).toBe('records');
  });

  it('keeps the sheet’s step out of the profit and reports it apart; the first value is the opening amount', () => {
    const g = positionGains({ position: pos, recentDays: 30 });
    const c = g.periods.rows.find((r) => r.key === 'funds')!.cells.recent;
    const step = SHEET[1]!.amount - (SHEET[0]!.amount * N('2026-09-30')) / N('2026-08-31');
    expect(c.unexplained).toBeCloseTo(step, 4);
    expect(c.unexplainedFunds).toBe(1);
    expect(c.profit).toBeCloseTo(
      (SHEET[1]!.amount * N(TODAY)) / N('2026-09-30') -
        (SHEET[0]!.amount * N('2026-09-27')) / N('2026-08-31') -
        step,
      4,
    );
    expect(g.periods.basis.fundsValuedFromRecords).toBe(1);
  });

  it('a fund first appearing at a record is not held before it, and the appearance is money in, not gain', () => {
    const late = asset({
      assetId: 'f2',
      records: [
        { date: '2026-09-30', amount: 360_000, currency: 'INR', fxRate: null, sheet: true },
      ],
      fund: fundOf({ sip: null, plan: null }),
    });
    const p = input([late]);
    expect(valueOn(late, '2026-09-29', p.config).state).toBe('not_yet');
    expect(valueOn(late, '2026-09-30', p.config)).toMatchObject({ state: 'held', value: 360_000 });
    const g = positionGains({ position: p, recentDays: 30 });
    const c = g.periods.rows.find((r) => r.key === 'funds')!.cells.recent;
    expect(c.startValue).toBe(0);
    expect(c.putIn).toBeCloseTo(360_000, 6);
    expect(c.profit).toBeCloseTo(360_000 * (N(TODAY) / N('2026-09-30') - 1), 4);
    expect(g.dataStarts).toBe('2026-09-30');
  });

  it('without any price the nearest earlier value stands as it is (no price source)', () => {
    const noPrices = asset({ fund: fundOf({ navs: [], sip: null, plan: null }) });
    const q = input([noPrices]);
    expect(valueOn(noPrices, '2026-09-29', q.config).value).toBe(SHEET[0]!.amount);
    expect(valueOn(noPrices, '2026-09-30', q.config).value).toBe(SHEET[1]!.amount);
    expect(fundsOf(q, [])[0]!.steps).toBeUndefined();
  });
});

describe('a fund with a ledger is unchanged', () => {
  const ledger = asset({
    assetId: 'f3',
    records: [],
    fund: fundOf({
      hasStatement: true,
      estimatedSince: null,
      txns: [
        { date: '2026-08-31', units: 1_500, amount: 150_000, estimated: false },
        { date: '2026-10-05', units: 100, amount: 10_400, estimated: false },
      ],
      flows: [
        { date: '2026-08-31', amount: 150_000 },
        { date: '2026-10-05', amount: 10_400 },
      ],
    }),
  });
  const pos = input([ledger]);

  it('values the units on the day at the price and takes its flows as they are', () => {
    expect(valueOn(ledger, '2026-10-01', pos.config)).toMatchObject({
      value: 1_500 * N('2026-10-01'),
      basis: 'units_nav',
    });
    const h = fundsOf(pos, ['2026-09-27'])[0]!;
    expect(h.flows).toEqual(ledger.fund!.flows);
    expect(h.steps).toBeUndefined();
    expect(h.valueFrom).toBe('ledger');
  });

  it('the gain is the change in value less purchases; today is units times price', () => {
    const today = 1_600 * N(TODAY);
    const g = positionGains({
      position: input([ledger], cfg(), { f3: { value: today, counted: true } }),
      recentDays: 30,
    });
    const c = g.periods.rows.find((r) => r.key === 'funds')!.cells.recent;
    expect(c.endValue).toBeCloseTo(today, 6);
    expect(c.startValue).toBeCloseTo(1_500 * N('2026-09-27'), 6);
    expect(c.putIn).toBe(10_400);
    expect(c.profit).toBeCloseTo(today - 1_500 * N('2026-09-27') - 10_400, 6);
    expect(c.unexplained).toBe(0);
    expect(g.periods.basis).toMatchObject({
      fundsHeldWithoutLedger: 0,
      fundsValuedFromLedger: 1,
      fundsValuedFromPlan: 0,
    });
  });
});

describe('Investments > Value by period and Home read the same funds the same way', () => {
  const pos = input([
    asset(),
    asset({
      assetId: 'f5',
      ownerId: 'o2',
      name: 'Another invented fund',
      fund: fundOf({ sip: null, plan: null }),
    }),
  ]);
  const home = positionGains({ position: pos, recentDays: 30 });
  const table = valuationHistory({
    position: pos,
    granularity: 'month',
    range: { kind: 'all' },
    owner: null,
    recent: 12,
    financialQuarters: true,
  });

  it('October to date is the same figure as Home’s "this month" for the funds', () => {
    const row = table.rows[table.rows.length - 1]!;
    expect(row.period.toDate).toBe(true);
    const cell = home.periods.rows.find((r) => r.key === 'funds')!.cells.month;
    expect(row.gain).toBeCloseTo(cell.profit, 6);
    expect(row.gainPct).toBeCloseTo(cell.pct!, 9);
    expect(row.netIn).toBeCloseTo(cell.putIn - cell.takenOut, 6);
    expect(row.unexplained).toBeCloseTo(cell.unexplained, 6);
    expect(row.unexplainedFunds).toBe(cell.unexplainedFunds);
    expect(row.value).toBeCloseTo(cell.endValue, 6);
  });

  it('the month of the sheet record: the plan fund shows its growth only, the last-resort fund carries its step apart', () => {
    const sep = table.rows.find((r) => r.period.key === '2026-09-01')!;
    expect(sep.unexplainedFunds).toBe(1);
    const step = SHEET[1]!.amount - (SHEET[0]!.amount * N('2026-09-30')) / N('2026-08-31');
    expect(sep.unexplained).toBeCloseTo(step, 4);
  });

  it('one person’s table is that person’s funds from the same function', () => {
    const mine = valuationHistory({
      position: pos,
      granularity: 'month',
      range: { kind: 'all' },
      owner: 'o1',
      recent: 12,
      financialQuarters: true,
    });
    expect(mine.rows[mine.rows.length - 1]!.funds).toBe(1);
    expect(mine.rows[mine.rows.length - 1]!.unexplained).toBe(0);
  });
});
