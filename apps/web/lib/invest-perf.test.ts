import { describe, expect, it } from 'vitest';
import {
  buildLedger,
  groupLines,
  heroModel,
  parsePlKind,
  statBlock,
  type PersonStyle,
} from '@fwos/core';
import { DEMO_HOLDING_MONTHS, DEMO_TODAY, demoBenchmark, demoView } from './demo-funds';
import { householdLedger } from './invest-ledger';
import { fundLines, investPerformance, xirrOfIds } from './invest-perf';
import { buildPl, parseCompareMode } from './invest-pl';

const view = demoView(null, 'all');
const styles: Record<string, PersonStyle> = {
  p1: { id: 'p1', name: 'Anil', colour: '#0a66c2', initial: 'A' },
  p2: { id: 'p2', name: 'Beena', colour: '#c2410c', initial: 'B' },
};

describe('the performance of the sample portfolio', () => {
  const perf = investPerformance(view);
  it('has an index, years of calendar and financial returns, a month grid and a benchmark comparison', () => {
    expect(perf.index.length).toBeGreaterThan(60);
    expect(perf.profile.calendar.length).toBeGreaterThanOrEqual(5);
    expect(perf.profile.financial.length).toBeGreaterThanOrEqual(5);
    expect(perf.profile.heatCalendar[0]!.cells).toHaveLength(12);
    expect(perf.profile.drawdown.max).not.toBeNull();
    expect(perf.profile.risk).not.toBeNull();
    expect(perf.profile.rolling[0]!.windows).toBeGreaterThan(12);
    const y1 = perf.versus.find((v) => v.def.key === '1y')!;
    expect(y1.v.yours).not.toBeNull();
    expect(y1.v.benchmark).not.toBeNull();
    expect(perf.whatIf!.coverage).toBeGreaterThan(0.9);
    // the sample has two funds without a statement, so part of the value is estimated
    expect(perf.estimatedShare).toBeGreaterThan(0);
    expect(perf.estimatedShare).toBeLessThan(0.5);
  });
  it('adds the profit of the months up to the profit of the whole history (money put in is not profit)', () => {
    const total = perf.periods.reduce((a, p) => a + p.gain, 0);
    const value = view.household.value;
    const netIn = perf.periods.reduce((a, p) => a + p.flow, 0);
    expect(total).toBeCloseTo(value - netIn, 0);
  });
});

describe('the profit and loss view', () => {
  const perf = investPerformance(view);
  it('builds each kind of period and keeps the running total', () => {
    for (const k of ['week', 'month', 'quarter', 'fy', 'year'] as const) {
      const v = buildPl(view, perf, styles, k, 'none');
      expect(v.main.length).toBeGreaterThan(1);
      const last = v.main[v.main.length - 1]!;
      expect(last.cumGain).toBeCloseTo(
        v.main.reduce((a, b) => a + b.gain, 0),
        3,
      );
    }
    expect(buildPl(view, perf, styles, 'week', 'none').main.length).toBeLessThanOrEqual(
      view.config.weeksShown,
    );
    expect(buildPl(view, perf, styles, 'month', 'none').main.length).toBeLessThanOrEqual(
      view.config.plRows,
    );
  });
  it('compares this period with the one before, person with person, and fund with fund', () => {
    expect(buildPl(view, perf, styles, 'month', 'prev').prev).not.toBeNull();
    const people = buildPl(view, perf, styles, 'month', 'person');
    expect(people.mode).toBe('person');
    expect(people.series.map((s) => s.label)).toEqual(['Anil', 'Beena']);
    const funds = buildPl(view, perf, styles, 'quarter', 'fund');
    expect(funds.series).toHaveLength(view.config.compareFunds);
    // one person alone cannot be compared with another
    expect(
      buildPl(
        demoView('p1', 'all'),
        investPerformance(demoView('p1', 'all')),
        styles,
        'month',
        'person',
      ).mode,
    ).toBe('none');
  });
  it('reads the choices from the address', () => {
    expect(parsePlKind('quarter')).toBe('quarter');
    expect(parseCompareMode('person')).toBe('person');
    expect(parseCompareMode('x')).toBe('none');
  });
});

describe('the funds table and the household ledger', () => {
  const lines = fundLines(view);
  it('has one line per fund with a return over a year from its prices and shares that add to one', () => {
    expect(lines).toHaveLength(8);
    expect(lines.reduce((a, l) => a + l.share, 0)).toBeCloseTo(1, 6);
    expect(lines.find((l) => l.assetId === 'f1')!.ret1y).not.toBeNull();
    expect(lines.find((l) => l.assetId === 'f4')!.ret1y).toBeNull(); // no live price
    const groups = groupLines(lines, 'goal', xirrOfIds(view), view.goals);
    expect(groups.map((g) => g.label)).toEqual(['Education fund', 'No goal']);
    expect(groups[0]!.totals.funds).toBe(2);
  });
  it('lists every transaction of every fund, with the person and fund, ready to filter', () => {
    const rows = householdLedger(view, styles);
    const txns = view.groups.flatMap((g) => g.funds.flatMap((f) => f.txns));
    expect(rows).toHaveLength(txns.length);
    expect(rows.every((r) => r.fund && r.owner && r.assetId)).toBe(true);
    expect(rows.some((r) => r.group === 'sell' && r.realisedGain !== null)).toBe(true);
  });
  it('the hero adds what is held to what selling booked', () => {
    const s = statBlock(
      view.groups.flatMap((g) => g.funds),
      {
        today: DEMO_TODAY,
        holdingMonths: DEMO_HOLDING_MONTHS,
        config: view.config,
      },
    );
    const h = view.household;
    const hero = heroModel({
      funds: s.funds,
      folios: s.folios,
      invested: s.invested,
      value: s.value,
      dayAmount: h.dayAmount,
      dayPct: h.dayPct,
      xirr: h.xirr,
      xirrEstimated: h.xirrEstimated,
      sipMonthly: h.sipMonthly,
      withStatement: s.withStatement,
      estimated: s.estimated,
      longShare: s.holding.longShare,
      realised: s.realised,
    });
    expect(hero.totalGain).toBeCloseTo(hero.unrealised + hero.realised.total, 6);
    expect(hero.realised.sales).toBeGreaterThan(0);
  });
  it('the sample benchmark covers the whole history of the sample', () => {
    const b = demoBenchmark();
    expect(b.navs[0]!.date <= '2021-06-01').toBe(true);
    expect(b.navs[b.navs.length - 1]!.date).toBe(DEMO_TODAY);
    const led = buildLedger({
      txns: [],
      navs: b.navs,
      navNow: 1,
      today: DEMO_TODAY,
      holdingMonths: 12,
      gapDays: 10,
    });
    expect(led).toEqual([]);
  });
});
