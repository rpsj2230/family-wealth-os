import { describe, expect, it } from 'vitest';
import { harvestReportTable, harvestTable } from '../src/harvest-table';
import type { HarvestView, PersonView, SellRow, LossRow } from '../src/harvest-view';

const lot = (
  acquiredOn: string,
  units: number,
  cost: number,
  value: number,
  longTerm: boolean,
) => ({
  acquiredOn,
  units,
  unitsInLot: units,
  partial: false,
  cost,
  value,
  gain: value - cost,
  longTerm,
});

const sell: SellRow = {
  assetId: 'f1',
  fund: 'Flexi Cap',
  units: 400,
  unitsText: '400.000',
  scope: 'The oldest 400.000 of 900.000 units',
  worth: 200_000,
  gain: 100_000,
  checks: [],
  estimated: false,
  working: {
    basisLabel: 'From your fund statement.',
    exact: true,
    lots: [lot('2023-01-05', 400, 100_000, 200_000, true)],
    totals: { cost: 100_000, value: 200_000, gain: 100_000 },
    shortTermGain: 0,
    longTermGain: 100_000,
    buyBack: 199_998,
    costs: { stt: 2, stampDuty: 10, exitLoad: 0 },
    notes: [],
  },
};

const loss: LossRow = {
  assetId: 'f2',
  fund: 'Small Cap',
  units: 100,
  unitsText: '100.000',
  scope: 'Whole holding',
  worth: 40_000,
  loss: 10_000,
  shortLoss: 4_000,
  longLoss: 6_000,
  exitLoad: 400,
  sentence: '',
  estimated: true,
  lots: [lot('2024-01-10', 60, 30_000, 24_000, true), lot('2026-02-10', 40, 20_000, 16_000, false)],
};

const person = (ownerId: string, name: string, extra: Partial<PersonView>): PersonView => ({
  ownerId,
  name,
  headline: '',
  sub: '',
  meter: { allowance: 125_000, used: 0, plan: 100_000, free: 25_000 },
  sell: [],
  notNow: [],
  leftOut: [],
  losses: { rows: [], summary: '', working: [] },
  working: [],
  costs: { stt: 0, stampDuty: 0, exitLoad: 0 },
  ...extra,
});

const view = {
  fy: '2026-27',
  deadline: '2027-03-31',
  deadlineLabel: '31 March 2027',
  daysLeft: 153,
  orderBy: '2027-03-25',
  people: [
    person('r', 'Rupash', { sell: [sell] }),
    person('g', 'Ragini', { losses: { rows: [loss], summary: '', working: [] } }),
  ],
  costs: { stt: 0, stampDuty: 0, exitLoad: 0, total: 0 },
  costsLine: '',
  checklist: [],
} as HarvestView;

describe('harvestTable: the whole family’s harvest as one table', () => {
  const t = harvestTable(view, { today: '2026-10-29' });

  it('one row per fund per person, with whose it is, the units, cost, value and the gain by term', () => {
    expect(t.rows.map((r) => [r.person, r.kind, r.fund, r.unitsText])).toEqual([
      ['Rupash', 'gain', 'Flexi Cap', '400.000'],
      ['Ragini', 'loss', 'Small Cap', '100.000'],
    ]);
    expect(t.rows[0]).toMatchObject({
      cost: 100_000,
      value: 200_000,
      longTerm: 100_000,
      shortTerm: 0,
      price: 500,
    });
    expect(t.rows[1]).toMatchObject({
      cost: 50_000,
      value: 40_000,
      longTerm: -6_000,
      shortTerm: -4_000,
      exitLoad: 400,
    });
  });

  it('dates: sell by the order date, buy back two working days later (weekends skipped), long-term again a year after', () => {
    // 25 Mar 2027 is a Thursday: two working days later is Monday 29 March
    expect(t.sellBy).toBe('2027-03-25');
    expect(t.buyBackOn).toBe('2027-03-29');
    expect(t.rows[0]!.longTermAgainOn).toBe('2028-03-30');
  });

  it('what to buy back and about how many units that buys at today’s price', () => {
    expect(t.rows[0]!.buyBack).toBe(199_998);
    expect(t.rows[0]!.buyBackUnits).toBe(399.996);
    // a loss sale puts back what is left after the exit load
    expect(t.rows[1]!.buyBack).toBe(39_600);
  });

  it('the tax each row saves: later tax on the gain; the tax a loss saves when set off', () => {
    expect(Math.round(t.rows[0]!.taxEffect)).toBe(13_000); // 12.5% + 4% cess on ₹1,00,000
    expect(Math.round(t.rows[1]!.taxEffect)).toBe(Math.round((4_000 * 0.2 + 6_000 * 0.125) * 1.04));
  });

  it('per person totals, and an estimate says so', () => {
    expect(t.people).toEqual([
      {
        ownerId: 'r',
        person: 'Rupash',
        gain: 100_000,
        loss: 0,
        buyBack: 199_998,
        allowanceLeft: 25_000,
      },
      {
        ownerId: 'g',
        person: 'Ragini',
        gain: 0,
        loss: -10_000,
        buyBack: 39_600,
        allowanceLeft: 25_000,
      },
    ]);
    expect(t.rows[1]!.note).toContain('estimated purchases');
  });

  it('after the order date, while the year is open, the sale is for today', () => {
    expect(harvestTable(view, { today: '2027-03-28' }).sellBy).toBe('2027-03-28');
  });

  it('becomes one Excel sheet with every column', () => {
    const r = harvestReportTable(t);
    expect(r.columns.map((c) => c.label)).toContain('Buy-back units (about)');
    expect(r.rows[0]).toMatchObject({
      person: 'Rupash',
      units: '400.000',
      buyBackOn: '2027-03-29',
    });
  });
});
