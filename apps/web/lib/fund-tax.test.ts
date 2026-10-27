import { describe, expect, it } from 'vitest';
import { demoView } from './demo-funds';
import { buildFundTax, harvestPositionsOf } from './fund-tax';

const view = demoView(null, 'all');
const funds = view.groups.flatMap((g) => g.funds);
const fund = (id: string) => funds.find((f) => f.assetId === id)!;

describe('the data check on the sample funds', () => {
  it('has a fund of every kind of history the page has to show', () => {
    const status = (id: string) => fund(id).ledger.status;
    expect(status('f1')).toBe('complete'); // a statement from the first instalment
    expect(status('f7')).toBe('complete');
    expect(status('f2')).toBe('starts_midway'); // 300 units held before the first line
    expect(status('f3')).toBe('gap'); // a month of lines is missing
    expect(status('f6')).toBe('no_transactions'); // no statement at all
  });

  it('names the units before the first line and the dates around the gap', () => {
    const mid = fund('f2').ledger;
    expect(mid.openingUnits).toBeCloseTo(300, 3);
    expect(mid.chip.label).toBe('Starts midway: 300 units before first line');
    const gap = fund('f3').ledger;
    expect(gap.breaks).toHaveLength(1);
    expect(gap.breaks[0]!.from < '2024-05-31' && gap.breaks[0]!.to > '2024-05-01').toBe(true);
    expect(gap.chip.label).toMatch(/^Gap: /);
    expect(gap.fix).toContain('DETAILED');
  });

  it('a fund that does not reconcile marks its figures as estimates, and the totals it is part of', () => {
    expect(fund('f2').ledger.figuresEstimated).toBe(true);
    expect(fund('f1').ledger.figuresEstimated).toBe(false);
    const beena = view.groups.find((g) => g.ownerId === 'p2')!;
    expect(beena.totals.xirrEstimated).toBe(true);
    expect(beena.ledger.complete).toBe(1); // only the large cap fund reconciles
    expect(beena.ledger.byStatus.gap).toBe(1);
    expect(beena.ledger.headline).toContain('1 of 4 funds reconciles');
    expect(beena.ledger.need.map((n) => n.name)).toContain('Sample Index Fund');
    const anil = view.groups.find((g) => g.ownerId === 'p1')!;
    expect(anil.ledger.byStatus.starts_midway).toBe(1);
    expect(anil.ledger.earliestTxnOn).toBe('2021-07-12');
  });

  it('a history that starts midway no longer reads as a gain on units whose cost is unknown', () => {
    const mid = fund('f2');
    // the units bought before the first line are counted as put in on that day, so the return is a number and is estimated
    expect(mid.xirr).not.toBeNull();
    expect(mid.xirrEstimated).toBe(true);
  });
});

describe('the exit load and tax panel on the sample funds', () => {
  it('a fund with both short-term and long-term units, some under the usual exit load', () => {
    const p = buildFundTax(view, fund('f1'));
    expect(p.equity).toBe(true);
    expect(p.totals.ltcgUnits).toBeGreaterThan(0);
    expect(p.totals.stcgUnits).toBeGreaterThan(0);
    expect(p.exitLoad.source).toBe('default');
    expect(p.exitLoad.state).toBe('under_load');
    expect(p.exitLoad.headline).toMatch(/^Exit load applies today to [\d.,]+ units \(1%\) until /);
    // the table covers every unit held
    expect(p.totals.units).toBeCloseTo(fund('f1').units!, 1);
    // the allowance is planned for the funds with smaller gains first; this fund says what it could do alone
    expect(p.harvest.state).toBe('nothing');
    expect(p.harvest.alone).not.toBeNull();
    expect(p.harvest.lines.join(' ')).toContain('Used on this fund instead');
  });

  it('a fund the plan picks says how much to take out, oldest units first', () => {
    const p = buildFundTax(view, fund('f8'));
    expect(p.harvest.state).toBe('sell_now');
    expect(p.harvest.pick!.units).toBeGreaterThan(0);
    expect(p.harvest.pick!.lots.length).toBeGreaterThan(0);
    expect(p.harvest.headline).toMatch(/^Take out about ₹/);
    // an ELSS fund is locked for three years from each purchase: nothing sold is still locked
    expect(p.harvest.pick!.lots.every((l) => l.acquiredOn <= '2023-10-26')).toBe(true);
  });

  it('a fund with its own exit load set', () => {
    const p = buildFundTax(view, fund('f2'));
    expect(p.exitLoad.source).toBe('fund');
    expect(p.exitLoad.rule).toEqual({ pct: 0.01, days: 365 });
    // the units from before the first line are listed, with an age that is only a lower bound
    expect(p.rows.some((r) => r.beforeStatement)).toBe(true);
    expect(p.estimated).toBe(true);
  });

  it('a fund bought within the last year is wholly under the exit load, and says when it ends', () => {
    const p = buildFundTax(view, fund('f7'));
    expect(p.totals.unitsLoadFree).toBe(0);
    expect(p.exitLoad.state).toBe('under_load');
    expect(p.harvest.state).toBe('nothing');
    expect(p.harvest.next.length + p.harvest.lines.length).toBeGreaterThan(0);
  });

  it('a gold fund is not harvested, and a fund with no purchases says so', () => {
    const gold = buildFundTax(view, fund('f5'));
    expect(gold.harvest.state).toBe('not_applicable');
    expect(gold.taxClass).toBe('other_long');
    const none = buildFundTax(view, fund('f4'));
    expect(none.rows).toHaveLength(0);
  });

  it('feeds the planner with the same lots the Investments page shows', () => {
    const pos = harvestPositionsOf(funds.filter((f) => f.ownerId === 'p1'));
    expect(pos.map((p) => p.assetId).sort()).toEqual(['f1', 'f2', 'f5', 'f8']);
    const f1 = pos.find((p) => p.assetId === 'f1')!;
    expect(f1.lots!.reduce((a, l) => a + l.units, 0)).toBeCloseTo(fund('f1').units!, 1);
  });
});
