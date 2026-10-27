import { describe, expect, it } from 'vitest';
import {
  BEFORE_STATEMENT,
  DEFAULT_CONFIG,
  RULES,
  allowanceUsed,
  exitLoadRuleFor,
  fundTaxPanel,
  holdingMonthsFor,
  planHarvest,
  realisedSince,
  takeOutFor,
  type FundTaxInput,
  type HarvestPosition,
  type StatLot,
} from '../src';

const TODAY = '2026-10-26';
const H = DEFAULT_CONFIG.harvest;

const LOTS: StatLot[] = [
  { acquiredOn: '2021-03-05', units: 100, cost: 5000 }, // long-term, load-free
  { acquiredOn: '2025-12-01', units: 50, cost: 4500 }, // short-term, under the 365 day load until 1 Dec 2026
  { acquiredOn: '2026-09-01', units: 10, cost: 1000 }, // short-term, under load, at a loss at 80? no: worth 800 < 1000
];

const input = (over: Partial<FundTaxInput> = {}): FundTaxInput => ({
  assetId: 'a',
  ownerId: 'o',
  taxClass: 'equity',
  classLabel: 'Equity-oriented fund',
  classCertain: true,
  classNote: '',
  lots: LOTS,
  lotsBasis: 'statement',
  nav: 80,
  units: 160,
  value: 12800,
  exitLoad: null,
  lockInMonths: 0,
  firstTxnOn: '2021-03-05',
  ledgerStatus: 'complete',
  ...over,
});

const ctx = (plan: ReturnType<typeof planHarvest> | null = null) => ({
  today: TODAY,
  rules: RULES,
  config: H,
  plan,
  setExitLoadHref: '?edit=a',
});

describe('exit load', () => {
  it('names the units still under the load, their share and the last day it applies (the usual rule from Settings)', () => {
    const p = fundTaxPanel(input(), ctx());
    expect(p.exitLoad.source).toBe('default');
    expect(p.exitLoad.state).toBe('under_load');
    expect(p.totals.unitsUnderLoad).toBe(60);
    expect(p.totals.unitsLoadFree).toBe(100);
    // 365 days from the newest purchase (1 Sep 2026): the load applies up to and including 1 Sep 2027
    expect(p.exitLoad.until).toBe('2027-09-01');
    expect(p.exitLoad.headline).toBe('Exit load applies today to 60 units (1%) until 1 Sep 2027');
    expect(p.exitLoad.loadIfSoldToday).toBeCloseTo(60 * 80 * 0.01, 6);
    expect(p.exitLoad.offerSet).toBe(true);
    expect(p.exitLoad.detail).toContain('Not set for this fund');
  });

  it('the fund’s own rule wins; zero means none', () => {
    const own = fundTaxPanel(input({ exitLoad: { pct: 0.005, days: 30 } }), ctx());
    expect(own.exitLoad.source).toBe('fund');
    expect(own.exitLoad.state).toBe('none_under');
    expect(own.exitLoad.headline).toBe('No exit load on any unit');
    expect(own.totals.unitsUnderLoad).toBe(0);
    const none = fundTaxPanel(input({ exitLoad: { pct: 0, days: 0 } }), ctx());
    expect(none.exitLoad.state).toBe('no_rule');
    expect(none.exitLoad.offerSet).toBe(false);
  });

  it('with no rule anywhere it says the exit load is not set', () => {
    const p = fundTaxPanel(input(), {
      ...ctx(),
      config: { ...H, exitLoadDays: 0, exitLoadPct: 0 },
    });
    expect(p.exitLoad.state).toBe('not_set');
    expect(p.exitLoad.headline).toBe('Exit load not set for this fund');
    expect(p.rows.every((r) => !r.underLoad)).toBe(true);
  });

  it('the rule picks the fund’s own values over the default', () => {
    expect(
      exitLoadRuleFor({ pct: 0.02, days: 90 }, { exitLoadPct: 0.01, exitLoadDays: 365 }),
    ).toEqual({
      rule: { pct: 0.02, days: 90 },
      source: 'fund',
    });
    expect(exitLoadRuleFor(null, { exitLoadPct: 0, exitLoadDays: 365 }).source).toBe('none');
  });
});

describe('short-term, long-term and loss units', () => {
  const p = fundTaxPanel(input(), ctx());

  it('splits the units by term today, with the dates each clock runs out', () => {
    expect(p.rows).toHaveLength(3);
    const [a, b, c] = p.rows;
    expect(a).toMatchObject({ term: 'LTCG', underLoad: false, longTermOn: '2022-03-06' });
    expect(b).toMatchObject({ term: 'STCG', underLoad: true, loadFreeOn: '2026-12-02' });
    expect(b!.longTermOn).toBe('2026-12-02');
    expect(c).toMatchObject({ term: 'STCG', underLoad: true });
    expect(p.totals.ltcgUnits).toBe(100);
    expect(p.totals.ltcgGain).toBeCloseTo(8000 - 5000, 6);
    expect(p.totals.stcgUnits).toBe(60);
    expect(p.totals.stcgGain).toBeCloseTo(4000 - 4500 + (800 - 1000), 6);
  });

  it('counts the units at a loss and the money lost', () => {
    expect(p.totals.lossUnits).toBe(60);
    expect(p.totals.lossAmount).toBeCloseTo(-700, 6);
    expect(p.rows[1]!.chips.map((c) => c.label)).toEqual(
      expect.arrayContaining(['Exit load', 'STCG', 'Loss']),
    );
  });

  it('a sale on the anniversary is still short-term; the next day is long-term', () => {
    const lots: StatLot[] = [{ acquiredOn: '2025-10-26', units: 10, cost: 500 }];
    const on = fundTaxPanel(input({ lots }), { ...ctx(), today: '2026-10-26' });
    expect(on.rows[0]!.term).toBe('STCG');
    expect(on.rows[0]!.longTermOn).toBe('2026-10-27');
    const next = fundTaxPanel(input({ lots }), { ...ctx(), today: '2026-10-27' });
    expect(next.rows[0]!.term).toBe('LTCG');
  });

  it('units from before the first line are at least as old as that line', () => {
    const lots: StatLot[] = [
      { acquiredOn: BEFORE_STATEMENT, units: 50, cost: null },
      { acquiredOn: '2026-09-01', units: 10, cost: 800 },
    ];
    const old = fundTaxPanel(input({ lots, firstTxnOn: '2021-03-05' }), ctx());
    expect(old.rows[0]).toMatchObject({
      beforeStatement: true,
      acquiredOn: null,
      term: 'LTCG',
      gain: null,
    });
    expect(old.rows[0]!.chips.map((c) => c.label)).toContain('LTCG (at least)');
    expect(old.totals.unknownCostUnits).toBe(50);
    // when the first line is recent the age cannot be told
    const recent = fundTaxPanel(input({ lots, firstTxnOn: '2026-05-01' }), ctx());
    expect(recent.rows[0]!.term).toBe('older');
  });

  it('other kinds of fund: debt is at the slab rate, gold uses its own holding period from Settings', () => {
    const debt = fundTaxPanel(input({ taxClass: 'debt_slab', classLabel: 'Debt fund' }), ctx());
    expect(debt.rows.every((r) => r.term === 'slab')).toBe(true);
    expect(debt.harvest.state).toBe('not_applicable');
    const gold = fundTaxPanel(input({ taxClass: 'other_long' }), ctx());
    // 24 months from Settings: the March 2021 lot is long-term, the 2025 lot is not
    expect(gold.rows[0]!.term).toBe('LTCG');
    expect(gold.rows[1]!.term).toBe('STCG');
    expect(holdingMonthsFor('other_long', 12, H.otherLongMonths)).toBe(H.otherLongMonths);
    expect(holdingMonthsFor('debt_slab', 12, 24)).toBeNull();
    expect(gold.harvest.state).toBe('not_applicable');
  });
});

describe('harvest advice', () => {
  const pos = (over: Partial<HarvestPosition> = {}): HarvestPosition => ({
    assetId: 'a',
    ownerId: 'o',
    fund: 'Sample Equity Fund',
    value: 12800,
    invested: 10500,
    startedOn: '2021-03-05',
    sipActive: false,
    lots: LOTS,
    taxClass: 'equity',
    classCertain: true,
    nav: 80,
    ...over,
  });

  it('says how much to sell now, from the oldest load-free long-term units, and what it costs', () => {
    const plan = planHarvest([pos()], TODAY);
    const p = fundTaxPanel(input(), ctx(plan));
    expect(p.harvest.state).toBe('sell_now');
    expect(p.harvest.pick).not.toBeNull();
    // only the first lot is ready (long-term and past the load): 100 units, gain 3000, inside the 1.25 lakh allowance
    expect(p.harvest.pick!.units).toBeCloseTo(100, 3);
    expect(p.harvest.pick!.estimatedGain).toBe(3000);
    expect(p.harvest.pick!.exitLoadCost).toBe(0);
    expect(p.harvest.headline).toContain('Take out about');
    expect(p.harvest.allowance).toMatchObject({ exemption: 125_000, used: 0, room: 125_000 });
    expect(p.harvest.lines.join(' ')).toContain('oldest units first');
    // the next date when more units become harvestable: the December 2025 lot, a year and a day on plus the margin in Settings
    expect(p.harvest.next[0]!.on).toBe('2027-01-02');
  });

  it('says nothing to do when no unit is ready, with the dates to come', () => {
    const plan = planHarvest([pos({ lots: LOTS.slice(1) })], TODAY);
    const p = fundTaxPanel(input({ lots: LOTS.slice(1) }), ctx(plan));
    expect(p.harvest.state).toBe('nothing');
    expect(p.harvest.headline).toBe('Nothing to do now');
    expect(p.harvest.next.length).toBeGreaterThan(0);
  });

  it('the allowance already used this year is taken off', () => {
    const plan = planHarvest([pos()], TODAY, { ytdRealised: { o: 124_000 } });
    const p = fundTaxPanel(input(), ctx(plan));
    expect(p.harvest.allowance!.room).toBe(1000);
    expect(p.harvest.pick!.estimatedGain).toBeLessThanOrEqual(1000);
  });

  it('estimated lots are flagged', () => {
    const plan = planHarvest([pos({ lots: LOTS.map((l) => ({ ...l, estimated: true })) })], TODAY);
    const p = fundTaxPanel(
      input({ lots: LOTS.map((l) => ({ ...l, estimated: true })), lotsBasis: 'estimated' }),
      ctx(plan),
    );
    expect(p.estimated).toBe(true);
    expect(p.harvest.estimated).toBe(true);
    expect(p.harvest.caution).toContain('estimated');
  });
});

describe('how much to take out', () => {
  const p = fundTaxPanel(input(), ctx());
  const rates = p.rates!;

  it('lists the units to sell, oldest first, with the exit load and the tax', () => {
    const r = takeOutFor({
      rows: p.rows,
      amount: 9000,
      exitLoad: { pct: 0.01, days: 365 },
      rates,
      room: 125_000,
    })!;
    // the first lot is worth 8000; the remaining 1000 comes from the second lot (under load)
    expect(r.pieces).toHaveLength(2);
    expect(r.pieces[0]!.units).toBeCloseTo(100, 6);
    expect(r.pieces[1]!.units).toBeCloseTo(12.5, 6);
    expect(r.proceeds).toBeCloseTo(9000, 6);
    expect(r.exitLoad).toBeCloseTo(1000 * 0.01, 6);
    expect(r.includesLoadUnits).toBe(true);
    expect(r.ltcgGain).toBeCloseTo(3000, 6);
    expect(r.tax).toBe(0); // inside the allowance; the short-term piece is a loss
    expect(r.allOfIt).toBe(false);
  });

  it('long-term gain above the allowance left is taxed at the long-term rate with the cess', () => {
    const r = takeOutFor({ rows: p.rows, amount: 8000, exitLoad: null, rates, room: 1000 })!;
    expect(r.tax).toBe(Math.ceil((3000 - 1000) * 0.125 * 1.04));
  });

  it('an amount above the holding lists everything, and nothing for a non-amount', () => {
    expect(takeOutFor({ rows: p.rows, amount: 1e9, exitLoad: null, rates, room: 0 })!.allOfIt).toBe(
      true,
    );
    expect(takeOutFor({ rows: p.rows, amount: 0, exitLoad: null, rates, room: 0 })).toBeNull();
  });
});

describe('gains already booked this year', () => {
  it('a sale on the first anniversary is short-term, the day after is long-term', () => {
    const sold = (soldOn: string) => [
      { soldOn, acquiredOn: '2025-04-15', proceeds: 1500, cost: 1000 },
    ];
    const fyStart = '2026-04-01';
    expect(realisedSince({ sold: sold('2026-04-15'), fyStart, holdingMonths: 12 })).toEqual({
      stcg: 500,
      ltcg: 0,
    });
    expect(realisedSince({ sold: sold('2026-04-16'), fyStart, holdingMonths: 12 })).toEqual({
      stcg: 0,
      ltcg: 500,
    });
  });

  it('leaves out earlier years and sales of units with no known cost', () => {
    const r = realisedSince({
      sold: [
        { soldOn: '2026-03-31', acquiredOn: '2020-01-01', proceeds: 900, cost: 100 },
        { soldOn: '2026-05-01', acquiredOn: '1900-01-01', proceeds: 900, cost: null },
        { soldOn: '2026-05-01', acquiredOn: '2020-01-01', proceeds: 900, cost: 400 },
      ],
      fyStart: '2026-04-01',
      holdingMonths: 12,
    });
    expect(r).toEqual({ stcg: 0, ltcg: 500 });
  });

  it('a short-term loss is set off against long-term gain before the allowance is used', () => {
    expect(allowanceUsed({ stcg: -200, ltcg: 500 })).toBe(300);
    expect(allowanceUsed({ stcg: 300, ltcg: 500 })).toBe(500);
    expect(allowanceUsed({ stcg: -900, ltcg: 500 })).toBe(0);
    expect(allowanceUsed({ stcg: 0, ltcg: -50 })).toBe(0);
  });
});
