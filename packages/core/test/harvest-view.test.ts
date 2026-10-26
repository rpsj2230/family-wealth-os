import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import { formatUnits, harvestView, shortDate } from '../src/harvest-view';
import { planHarvest, type HarvestPosition } from '../src/harvest-plan';
import { planLossHarvest } from '../src/loss-harvest';
import { RULES, type TaxRuleSet } from '../src/tax';

const TODAY = '2026-11-20';
const cfg = DEFAULT_CONFIG.harvest;
const sip = (from: string, n: number, units: number, cost: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { acquiredOn: d.toISOString().slice(0, 10), units, cost };
  });
const lotted = (
  o: Partial<HarvestPosition> & { assetId: string; lots: NonNullable<HarvestPosition['lots']> },
): HarvestPosition => {
  const units = o.lots.reduce((a, l) => a + l.units, 0);
  const nav = o.nav ?? 100;
  return {
    ownerId: 'p',
    fund: 'Fund',
    value: units * nav,
    invested: o.lots.reduce((a, l) => a + (l.cost ?? 0), 0),
    startedOn: o.lots[0]!.acquiredOn,
    sipActive: false,
    taxClass: 'equity',
    nav,
    ...o,
  };
};

const build = (
  positions: HarvestPosition[],
  over: { rules?: TaxRuleSet[]; config?: typeof cfg; ytd?: number } = {},
) => {
  const rules = over.rules ?? RULES;
  const config = over.config ?? cfg;
  const plan = planHarvest(positions, TODAY, {
    rules,
    config,
    ytdRealised: { p: over.ytd ?? 0 },
  });
  const losses = planLossHarvest(positions, TODAY, {
    rules,
    config,
    plannedGain: { p: plan.plans[0]?.totalGain ?? 0 },
  });
  return harvestView({ plan, losses, today: TODAY, names: { p: 'Asha' }, rules, config });
};

const positions = (): HarvestPosition[] => [
  lotted({
    assetId: 'old',
    fund: 'Old Bluechip',
    lots: [
      { acquiredOn: '2021-03-01', units: 400, cost: 20_000 },
      { acquiredOn: '2022-03-01', units: 600, cost: 40_000 },
    ],
  }),
  lotted({
    assetId: 'sipfund',
    fund: 'Monthly Fund',
    sipActive: true,
    lots: [...sip('2025-02-10', 16, 10, 800), ...sip('2026-06-10', 6, 10, 900)],
  }),
  lotted({
    assetId: 'recent',
    fund: 'Recent Fund',
    sipActive: true,
    lots: sip('2026-05-10', 6, 10, 900),
  }),
  {
    assetId: 'intl',
    ownerId: 'p',
    fund: 'US Fund of Funds',
    value: 150_000,
    invested: 100_000,
    startedOn: '2022-01-01',
    sipActive: false,
    taxClass: 'other_long',
  },
];

describe('harvestView: the sell list', () => {
  const v = build(positions());
  const p = v.people[0]!;

  it('opens with one plain sentence naming the person, the tax-free gain and the date', () => {
    expect(p.headline).toMatch(/^Asha can book ₹[\d,]+ of tax-free gain this year\./);
    expect(p.headline).toContain('before 31 March 2027');
    expect(p.headline).toContain(
      `₹${p.sell.reduce((a, r) => a + r.gain, 0).toLocaleString('en-IN')}`,
    );
  });

  it('gives exact units, three decimals, for every row, and never a blank', () => {
    expect(p.sell.length).toBeGreaterThan(0);
    for (const r of p.sell) {
      expect(r.units).toBeGreaterThan(0);
      expect(r.unitsText).toMatch(/^\d+\.\d{3}$/);
      expect(r.unitsText).toBe(formatUnits(r.units));
      expect(r.worth).toBeGreaterThan(0);
    }
  });

  it('shows four checks per row, using the long-term period, exit load and allowance from the settings', () => {
    const r = p.sell[0]!;
    const texts = r.checks.map((c) => c.text);
    expect(texts[0]).toBe('Held over 12 months, long-term');
    expect(texts[1]).toBe('No exit load (past 365 days)');
    expect(texts[2]).toBe('Within this year’s free allowance');
    expect(texts[3]).toBe('Lots: from your statement');
    expect(r.checks.every((c) => c.tone === 'ok')).toBe(true);
  });

  it('follows a changed long-term period and exit-load days instead of fixed numbers', () => {
    const rule: TaxRuleSet = {
      ...RULES[1]!,
      equity: { ...RULES[1]!.equity, holdingMonthsLong: 24 },
    };
    const v2 = build(positions(), { rules: [rule], config: { ...cfg, exitLoadDays: 90 } });
    const texts = v2.people[0]!.sell[0]!.checks.map((c) => c.text);
    expect(texts[0]).toBe('Held over 24 months, long-term');
    expect(texts[1]).toBe('No exit load (past 90 days)');
  });

  it('says plainly when lots are estimated and asks for a statement', () => {
    const est = positions();
    est[0] = lotted({
      assetId: 'old',
      fund: 'Old Bluechip',
      lots: [{ acquiredOn: '2021-03-01', units: 1000, cost: 60_000, estimated: true }],
    });
    const r = build(est).people[0]!.sell.find((x) => x.assetId === 'old')!;
    expect(r.estimated).toBe(true);
    expect(r.checks[3]!.tone).toBe('warn');
    expect(r.checks[3]!.text).toContain('estimated from your SIP history');
    expect(r.checks[3]!.text).toContain('import a statement');
    expect(r.working.exact).toBe(false);
  });

  it('keeps the main view free of any mention of buying back', () => {
    const main = JSON.stringify({
      headline: p.headline,
      sub: p.sub,
      sell: p.sell.map((r) => ({ ...r, working: undefined })),
      notNow: p.notNow,
      losses: p.losses.rows,
      summary: p.losses.summary,
      checklist: v.checklist,
      costs: v.costsLine,
    });
    expect(main).not.toMatch(/buy.?back|buy first|rebuy|buying/i);
    // the working may carry the amount
    expect(p.sell[0]!.working.buyBack).toBe(p.sell[0]!.worth);
  });

  it('lists the lots behind each sale, oldest first, with date, cost and gain, adding up to the sale', () => {
    for (const r of p.sell) {
      const w = r.working;
      expect(w.lots.length).toBeGreaterThan(0);
      const dates = w.lots.map((l) => l.acquiredOn);
      expect([...dates].sort()).toEqual(dates);
      expect(w.lots.reduce((a, l) => a + l.units, 0)).toBeCloseTo(r.units, 3);
      expect(Math.round(w.totals.gain)).toBe(r.gain);
      expect(w.shortTermGain).toBe(0);
      expect(w.longTermGain).toBeCloseTo(w.totals.gain, 6);
      expect(w.lots.every((l) => l.longTerm)).toBe(true);
    }
  });

  it('shows the meter parts adding up to the yearly allowance and uses gains already booked', () => {
    const m = p.meter;
    expect(m.allowance).toBe(125_000);
    expect(m.used + m.plan + m.free).toBe(m.allowance);
    const v3 = build(positions(), { ytd: 100_000 }).people[0]!;
    expect(v3.meter.used).toBe(100_000);
    expect(v3.meter.plan).toBeLessThanOrEqual(25_000);
    expect(v3.sub).toContain('already used');
  });

  it('sums the costs to expect for the footnote', () => {
    expect(v.costs.stt).toBe(p.sell.reduce((a, r) => a + r.working.costs.stt, 0));
    expect(v.costs.total).toBe(v.costs.stt + v.costs.stampDuty + v.costs.exitLoad);
    expect(v.costsLine).toContain('stamp duty');
    expect(v.costsLine).toContain('exit load');
  });

  it('flags a total-only estimate as such', () => {
    const noLots: HarvestPosition = {
      assetId: 'tot',
      ownerId: 'p',
      fund: 'Totals Fund',
      value: 150_000,
      invested: 100_000,
      startedOn: '2022-01-01',
      sipActive: false,
      taxClass: 'equity',
      nav: 50,
    };
    const r = build([noLots]).people[0]!.sell[0]!;
    expect(r.unitsText).toBe('3000.000');
    expect(r.checks[3]!.text).toContain('estimated from the total invested');
    expect(r.working.lots).toEqual([]);
    expect(r.working.notes.join(' ')).toContain('proportion');
  });

  it('never lists a fund without units: it moves to “not now” with a reason', () => {
    const plan = planHarvest(positions(), TODAY, { rules: RULES, config: cfg });
    const bad = structuredClone(plan);
    bad.plans[0]!.picks[0]!.units = null;
    const view = harvestView({
      plan: bad,
      losses: { fy: plan.fy, plans: [] },
      today: TODAY,
      names: { p: 'Asha' },
      rules: RULES,
      config: cfg,
    }).people[0]!;
    expect(view.sell.find((r) => r.assetId === bad.plans[0]!.picks[0]!.assetId)).toBeUndefined();
    expect(
      view.notNow.some(
        (r) => r.assetId === bad.plans[0]!.picks[0]!.assetId && r.kind === 'needs_data',
      ),
    ).toBe(true);
  });

  it('warns about an exit load when a sale would still pay one', () => {
    const plan = planHarvest(positions(), TODAY, { rules: RULES, config: cfg });
    const edited = structuredClone(plan);
    edited.plans[0]!.picks[0]!.exitLoadCost = 750;
    const view = harvestView({
      plan: edited,
      losses: { fy: plan.fy, plans: [] },
      today: TODAY,
      names: { p: 'Asha' },
      rules: RULES,
      config: cfg,
    }).people[0]!;
    expect(view.sell[0]!.checks[1]).toEqual({ tone: 'warn', text: 'Exit load ₹750 applies' });
    expect(view.costs.exitLoad).toBe(750);
  });
});

describe('harvestView: not now, left out and the empty case', () => {
  const v = build(positions());
  const p = v.people[0]!;

  it('lists funds with only short-term units, with the date each becomes ready', () => {
    const row = p.notNow.find((r) => r.assetId === 'recent')!;
    expect(row.kind).toBe('waiting');
    expect(row.reason).toContain('held under 12 months');
    expect(row.reason).toContain('20%');
    expect(row.reason).toContain('exit load still applies');
    expect(row.okOn).toBe('2027-06-11');
    const texts = row.dates.map((d) => d.text).join(' | ');
    expect(texts).toContain('turn long-term');
    expect(texts).toContain('Exit load');
    expect(row.dates.map((d) => d.on)).toEqual([...row.dates.map((d) => d.on)].sort());
  });

  it('names the units still short-term in a fund that is also being sold, and leaves them out of the sale', () => {
    const sold = p.sell.find((r) => r.assetId === 'sipfund')!;
    expect(sold.working.lots.every((l) => l.longTerm && l.acquiredOn < '2025-11-20')).toBe(true);
    const more = p.notNow.find((r) => r.assetId === 'sipfund')!;
    expect(more.kind).toBe('more_later');
    expect(more.dates.length).toBeGreaterThan(0);
  });

  it('puts other fund types under left out, never in the sell list', () => {
    expect(p.leftOut.map((f) => f.assetId)).toEqual(['intl']);
    expect(p.sell.some((r) => r.assetId === 'intl')).toBe(false);
  });

  it('says what happens when nothing is ready, with the next ready date', () => {
    const only = build([positions()[2]!]).people[0]!;
    expect(only.sell).toEqual([]);
    expect(only.headline).toBe('Nothing is ready for Asha to sell for tax-free gain right now.');
    expect(only.sub).toContain('The next units are ready on');
  });

  it('explains a fund held back because the allowance is already used', () => {
    const view = build(positions(), { ytd: 125_000 }).people[0]!;
    expect(view.sell).toEqual([]);
    expect(view.notNow.some((r) => r.kind === 'allowance_used')).toBe(true);
  });
});

describe('harvestView: losses, working and checklist', () => {
  const losers = (): HarvestPosition[] => [
    lotted({
      assetId: 'dn',
      fund: 'Down Fund',
      nav: 60,
      lots: [{ acquiredOn: '2024-01-10', units: 1000, cost: 100_000 }],
    }),
  ];

  it('describes a loss in plain words and says whether it saves tax this year', () => {
    const view = build(losers()).people[0]!;
    expect(view.losses.rows).toHaveLength(1);
    const row = view.losses.rows[0]!;
    expect(row.sentence).toBe(
      'Sell 1000.000 units (worth about ₹60,000) to book a loss of ₹40,000.',
    );
    expect(row.scope).toBe('Your whole holding');
    expect(view.losses.summary).toContain('would not reduce your tax');
    expect(view.losses.summary).toContain('carried forward');
    expect(view.losses.working.join(' ')).toContain('Set-off order');
  });

  it('keeps the withholding and buy-back detail for the working', () => {
    const p = build(positions()).people[0]!;
    const joined = p.working.join(' ');
    expect(joined).toContain('put back');
    expect(joined).toContain('Non-resident');
    const noNri = build(positions(), { config: { ...cfg, nri: false } }).people[0]!;
    expect(noNri.working.join(' ')).not.toContain('Non-resident');
  });

  it('gives five short lines with this year’s dates and the buffer from the settings', () => {
    const v = build(positions());
    expect(v.checklist).toHaveLength(5);
    expect(v.orderBy).toBe('2027-03-25');
    expect(v.checklist[2]).toContain(shortDate('2027-03-25'));
    expect(v.checklist.join(' ')).not.toMatch(/buy/i);
    const v2 = build(positions(), { config: { ...cfg, orderBufferDays: 10 } });
    expect(v2.orderBy).toBe('2027-03-21');
  });
});
