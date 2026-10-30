import { describe, expect, it } from 'vitest';
import { fundCategory } from '../src/fund-category';
import type { StatFund } from '../src/fund-stats';
import { fundPlatform, parsePlatformRule } from '../src/fund-platform';
import {
  fundPlanOf,
  groupLines,
  sipSeenOf,
  heroModel,
  lotAgeing,
  parseGroupBy,
  searchLines,
  splitByPlan,
  sortLines,
  totalsOfLines,
  upcomingSips,
  type FundLine,
} from '../src/invest-overview';

const line = (o: Partial<FundLine> & { assetId: string }): FundLine => ({
  ownerId: 'p1',
  ownerName: 'Anil',
  name: o.assetId,
  categoryKey: 'flexi',
  categoryLabel: 'Flexi and multi cap',
  categoryCertain: true,
  amc: 'Alpha',
  plan: 'direct',
  platform: 'App',
  invested: 100,
  value: 150,
  gain: 50,
  gainPct: 0.5,
  dayAmount: 1,
  dayPct: 0.01,
  xirr: 0.1,
  xirrEstimated: false,
  ret1y: 0.1,
  retAll: 0.3,
  share: 0.5,
  sipMonthly: 10,
  sipStopped: false,
  sipSeen: null,
  units: 1,
  nav: 1,
  avgCost: 1,
  hasStatement: true,
  amfiCode: '1',
  goalIds: [],
  startedOn: '2024-01-05',
  navDate: '2026-10-23',
  valueBasis: 'units × live price',
  ledgerStatus: 'complete',
  ledgerChip: { icon: '✓', label: 'Reconciled', tone: 'ok', title: '' },
  figuresEstimated: false,
  ...o,
});
const xirrOf = (ids: string[]) => ({ xirr: ids.length / 100, estimated: false });

describe('heroModel', () => {
  const base = {
    funds: 3,
    folios: 3,
    invested: 1_000,
    value: 1_500,
    dayAmount: 10,
    dayPct: 0.007,
    xirr: 0.12,
    xirrEstimated: false,
    sipMonthly: 100,
    withStatement: 3,
    estimated: 0,
    longShare: 0.8,
    realised: { proceeds: 0, stcg: 20, ltcg: 80, other: 0, unknownCost: 1, sales: 3, byYear: [] },
  };
  it('works out profit or loss on the units held and adds what selling has booked', () => {
    const h = heroModel(base);
    expect(h.unrealised).toBe(500);
    expect(h.unrealisedPct).toBeCloseTo(0.5);
    expect(h.realised.total).toBe(100);
    expect(h.totalGain).toBe(600);
    expect(h.realised.unknown).toBe(1);
    expect(h.split!.cost).toBeCloseTo(2 / 3);
    expect(h.split!.growth).toBeCloseTo(1 / 3);
  });
  it('shows a loss as no growth and has no percentage without a cost', () => {
    const h = heroModel({ ...base, value: 800 });
    expect(h.unrealised).toBe(-200);
    expect(h.split).toEqual({ cost: 1, growth: 0 });
    expect(heroModel({ ...base, invested: 0 }).unrealisedPct).toBeNull();
    expect(heroModel({ ...base, invested: 0 }).split).toBeNull();
  });
});

describe('the funds table', () => {
  const lines = [
    line({
      assetId: 'a',
      name: 'Alpha Flexi',
      value: 300,
      invested: 200,
      ownerId: 'p1',
      ownerName: 'Anil',
    }),
    line({
      assetId: 'b',
      name: 'Beta Small',
      value: 100,
      invested: 120,
      categoryKey: 'small',
      categoryLabel: 'Small cap',
      amc: 'Beta',
      ownerId: 'p2',
      ownerName: 'Beena',
      dayAmount: null,
      dayPct: null,
      xirr: null,
      ret1y: null,
    }),
    line({
      assetId: 'c',
      name: 'Gamma Flexi',
      value: 200,
      invested: 100,
      ownerId: 'p1',
      ownerName: 'Anil',
      amc: null,
    }),
  ];
  it('groups by person, kind or house, largest first, with totals', () => {
    const byPerson = groupLines(lines, 'person', xirrOf);
    expect(byPerson.map((g) => g.label)).toEqual(['Anil', 'Beena']);
    expect(byPerson[0]!.totals.value).toBe(500);
    expect(byPerson[0]!.totals.gain).toBe(200);
    expect(byPerson[0]!.totals.gainPct).toBeCloseTo(200 / 300);
    expect(byPerson[0]!.totals.share).toBeCloseTo(500 / 600);
    expect(byPerson[0]!.totals.xirr).toBeCloseTo(0.02);
    expect(byPerson[0]!.lines.map((l) => l.assetId)).toEqual(['a', 'c']);
    expect(groupLines(lines, 'kind', xirrOf).map((g) => g.key)).toEqual(['flexi', 'small']);
    expect(groupLines(lines, 'house', xirrOf).map((g) => g.label)).toContain(
      'Fund house not known',
    );
    expect(groupLines(lines, 'none', xirrOf)).toHaveLength(1);
  });
  it('adds today only over the funds that have a move, and the SIPs only while running', () => {
    const t = totalsOfLines(
      [
        line({ assetId: 'x', dayAmount: 5, value: 105, sipMonthly: 10 }),
        line({ assetId: 'y', dayAmount: null, dayPct: null, sipStopped: true }),
      ],
      1000,
      xirrOf,
    );
    expect(t.dayAmount).toBe(5);
    expect(t.dayPct).toBeCloseTo(5 / 100);
    expect(t.sipMonthly).toBe(10);
  });
  it('sorts with missing figures last either way, and searches by every word', () => {
    expect(sortLines(lines, 'xirr', 1).map((l) => l.assetId)).toEqual(['a', 'c', 'b']);
    expect(
      sortLines(lines, 'xirr', -1)
        .map((l) => l.assetId)
        .pop(),
    ).toBe('b');
    expect(sortLines(lines, 'name', 1)[0]!.name).toBe('Alpha Flexi');
    expect(sortLines(lines, 'value', -1)[0]!.assetId).toBe('a');
    expect(searchLines(lines, 'flexi anil')).toHaveLength(2);
    expect(searchLines(lines, 'small')).toHaveLength(1);
    expect(searchLines(lines, '  ')).toHaveLength(3);
  });
  it('groups by goal: one goal each, funds with none and funds split between goals last', () => {
    const g = [
      line({ assetId: 'a', value: 100, goalIds: ['g1'] }),
      line({ assetId: 'b', value: 900, goalIds: [] }),
      line({ assetId: 'c', value: 50, goalIds: ['g1', 'g2'] }),
      line({ assetId: 'd', value: 40, goalIds: ['g2'] }),
    ];
    const groups = groupLines(g, 'goal', xirrOf, [
      { id: 'g1', name: 'Education' },
      { id: 'g2', name: 'House' },
    ]);
    expect(groups.map((x) => x.label)).toEqual([
      'Education',
      'House',
      'Split between goals',
      'No goal',
    ]);
    expect(groups[0]!.totals.value).toBe(100);
    expect(groups[3]!.lines.map((l) => l.assetId)).toEqual(['b']);
  });
  it('reads the grouping from the address', () => {
    expect(parseGroupBy('goal')).toBe('goal');
    expect(parseGroupBy('kind')).toBe('kind');
    expect(parseGroupBy('nonsense')).toBe('person');
    expect(parseGroupBy(undefined)).toBe('person');
  });
});

const fund = (o: Partial<StatFund>): StatFund => ({
  assetId: 'f',
  ownerId: 'p1',
  name: 'F',
  value: 1000,
  invested: 800,
  units: 100,
  nav: 10,
  startedOn: '2024-01-01',
  sipMonthly: null,
  sipStopped: false,
  dayAmount: null,
  dayPct: null,
  folioLast4: null,
  category: fundCategory('F', null),
  amc: null,
  taxClass: 'equity',
  hasStatement: true,
  txns: [],
  lots: [],
  lotsBasis: 'statement',
  realised: [],
  ...o,
});

describe('Type and Platform groupings', () => {
  const lines = [
    line({ assetId: 'a', value: 300, plan: 'direct', platform: 'App' }),
    line({ assetId: 'b', value: 100, plan: 'regular', platform: 'Broker' }),
    line({ assetId: 'c', value: 50, plan: 'unknown', platform: null }),
    line({ assetId: 'd', value: 20, plan: 'regular', platform: 'Broker' }),
  ];
  it('groups by plan, with the plan not known last', () => {
    const g = groupLines(lines, 'plan', xirrOf);
    expect(g.map((x) => [x.label, x.lines.length])).toEqual([
      ['Direct plans', 1],
      ['Regular plans', 2],
      ['Plan not known', 1],
    ]);
    expect(g[1]!.totals.value).toBe(120);
    expect(parseGroupBy('plan')).toBe('plan');
  });
  it('groups by platform, with the platform not set last', () => {
    const g = groupLines(lines, 'platform', xirrOf);
    expect(g.map((x) => x.label)).toEqual(['App', 'Broker', 'Platform not set']);
    expect(parseGroupBy('platform')).toBe('platform');
  });
  it('finds a fund by its platform', () => {
    expect(searchLines(lines, 'broker').map((l) => l.assetId)).toEqual(['b', 'd']);
  });
});

describe('fundPlatform', () => {
  const rules = ['in hdfc = HDFC Securities', '* = Kuvera'];
  it('applies the first rule whose words are in either name, else the * rule', () => {
    expect(fundPlatform(['Nippon India small cap fund (In HDFC)', null], rules)).toBe(
      'HDFC Securities',
    );
    expect(fundPlatform(['Nippon India Small Cap Growth', 'Mid Cap (in  HDFC)'], rules)).toBe(
      'HDFC Securities',
    );
    expect(fundPlatform(['Parag Parikh Flexi Cap Direct Growth'], rules)).toBe('Kuvera');
  });
  it('is null with no rule that fits and no * rule, and skips a broken rule', () => {
    expect(fundPlatform(['Axis Large Cap'], ['in hdfc = HDFC Securities'])).toBeNull();
    expect(fundPlatform(['Axis Large Cap'], ['no equals sign', '* = App'])).toBe('App');
  });
  it('reads a rule and says what is wrong with a bad one', () => {
    expect(parsePlatformRule('  In  HDFC = HDFC  Securities ')).toEqual({
      words: 'in hdfc',
      platform: 'HDFC Securities',
    });
    expect('error' in parsePlatformRule('HDFC Securities')).toBe(true);
    expect('error' in parsePlatformRule('x = y')).toBe(true);
  });
});

describe('fundPlanOf', () => {
  it('keeps a saved plan, else the scheme plan, else a word in a name', () => {
    expect(fundPlanOf('regular', 'Direct', ['X Direct'])).toBe('regular');
    expect(fundPlanOf('regular_or_unknown', 'Regular', ['Nippon (In HDFC)'])).toBe('regular');
    expect(fundPlanOf(null, 'Other', ['Quant Small Cap Growth Direct Plan'])).toBe('direct');
    expect(fundPlanOf(null, null, ['Nippon India Small Cap Fund - Regular Plan'])).toBe('regular');
    expect(fundPlanOf('regular_or_unknown', null, ['Nippon (In HDFC)', null])).toBe('unknown');
  });
  it('does not read "directly" or a word inside another as a plan', () => {
    expect(fundPlanOf(null, null, ['Bought directly'])).toBe('unknown');
  });
});

describe('sipSeenOf', () => {
  const rules = { sipMinInstalments: 3, moneyTolerance: 1 };
  const monthly = (from: number, n: number, kind = 'sip') =>
    Array.from({ length: n }, (_, i) => {
      const m = from + i;
      const y = 2025 + Math.floor((m - 1) / 12);
      const mm = String(((m - 1) % 12) + 1).padStart(2, '0');
      return { date: `${y}-${mm}-05`, kind, amount: 5000, source: 'cas' };
    });
  it('reads a stopped SIP: regular instalments, then the next one overdue', () => {
    const s = sipSeenOf(monthly(1, 6), '2026-10-30', rules);
    expect(s).toEqual({ last: '2025-06-05', amount: 5000, state: 'stopped' });
  });
  it('reads a running SIP from purchases too', () => {
    const s = sipSeenOf(monthly(15, 6, 'purchase'), '2026-09-10', rules);
    expect(s?.state).toBe('running');
    expect(s?.last).toBe('2026-08-05');
    // one due date missed is not yet a stop; two are
    expect(sipSeenOf(monthly(15, 6, 'purchase'), '2026-09-30', rules)?.state).toBe('running');
    expect(sipSeenOf(monthly(15, 6, 'purchase'), '2026-10-12', rules)?.state).toBe('stopped');
  });
  it('sees no SIP in one-off buys or assumed instalments', () => {
    expect(sipSeenOf(monthly(1, 2), '2026-10-30', rules)).toBeNull();
    expect(
      sipSeenOf(
        monthly(1, 6).map((x) => ({ ...x, source: 'estimate' })),
        '2026-10-30',
        rules,
      ),
    ).toBeNull();
    expect(sipSeenOf(monthly(1, 6, 'redemption'), '2026-10-30', rules)).toBeNull();
  });
});

describe('splitByPlan', () => {
  it('splits the value between Direct, Regular and not set, leaving out empty groups', () => {
    const s = splitByPlan([
      line({ assetId: 'a', plan: 'direct', value: 600 }),
      line({ assetId: 'b', plan: 'regular', value: 300 }),
      line({ assetId: 'c', plan: 'direct', value: 100 }),
    ]);
    expect(s.map((x) => x.key)).toEqual(['direct', 'regular']);
    expect(s[0]!.value).toBe(700);
    expect(s[0]!.share).toBeCloseTo(0.7);
    expect(s[0]!.funds).toBe(2);
    expect(splitByPlan([])).toEqual([]);
  });
});

describe('lotAgeing', () => {
  const today = '2026-10-26';
  it('puts the value of each purchase in the bucket of its age', () => {
    const a = lotAgeing(
      [
        fund({
          value: 400,
          lots: [
            { acquiredOn: '2026-09-01', units: 10, cost: 90 }, // 1 month
            { acquiredOn: '2026-01-15', units: 10, cost: 90 }, // 9 months
            { acquiredOn: '2025-02-01', units: 10, cost: 90 }, // 20 months
            { acquiredOn: '2022-02-01', units: 10, cost: 90 }, // over 3 years
          ],
        }),
      ],
      today,
      [3, 12, 36],
    );
    expect(a.buckets.map((b) => b.label)).toEqual([
      'Under 3 months',
      '3 months to 1 year',
      '1 year to 3 years',
      'Over 3 years',
    ]);
    expect(a.buckets.map((b) => Math.round(b.value))).toEqual([100, 100, 100, 100]);
    expect(a.buckets[0]!.share).toBeCloseTo(0.25);
    expect(a.buckets[0]!.gain).toBeCloseTo(10);
  });
  it('keeps units from before the statement apart and counts a fund with no lots as unknown', () => {
    const a = lotAgeing(
      [
        fund({ value: 300, lots: [{ acquiredOn: '1900-01-01', units: 10, cost: 100 }] }),
        fund({ assetId: 'g', value: 200, lots: [] }),
      ],
      today,
      [12],
    );
    expect(a.buckets.find((b) => b.key === 'before')!.value).toBeCloseTo(300);
    expect(a.unknownValue).toBe(200);
  });
  it('marks value that rests on a plan estimate', () => {
    const a = lotAgeing(
      [
        fund({
          value: 100,
          lots: [{ acquiredOn: '2026-10-01', units: 10, cost: 90, estimated: true }],
        }),
      ],
      today,
      [12],
    );
    expect(a.buckets[0]!.estimatedValue).toBeCloseTo(100);
  });
});

describe('upcomingSips', () => {
  it('lists the next instalment of each running SIP, soonest first', () => {
    const sip = (d: string) => ({ date: d, kind: 'sip', units: 1, amount: 100 });
    const list = upcomingSips(
      [
        fund({
          assetId: 'a',
          name: 'A',
          sipMonthly: 100,
          txns: [sip('2026-09-05'), sip('2026-10-05')],
        }),
        fund({ assetId: 'b', name: 'B', sipMonthly: 200, txns: [sip('2026-10-20')] }),
        fund({
          assetId: 'c',
          name: 'C',
          sipMonthly: 300,
          sipStopped: true,
          txns: [sip('2026-10-01')],
        }),
      ],
      '2026-10-26',
      5,
    );
    expect(list.map((x) => x.assetId)).toEqual(['a', 'b']);
    expect(list[1]!.on).toBe('2026-11-20');
    expect(list[0]!.estimated).toBe(false);
    expect(
      upcomingSips([fund({ sipMonthly: 5, txns: [sip('2026-10-05')] })], '2026-10-26', 0),
    ).toEqual([]);
  });
});
