import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import {
  harvestDueOn,
  harvestTaskTitle,
  planHarvest,
  type HarvestPosition,
} from '../src/harvest-plan';

const pos = (o: Partial<HarvestPosition> & { assetId: string }): HarvestPosition => ({
  ownerId: 'r',
  fund: 'Fund',
  value: 300_000,
  invested: 200_000,
  startedOn: '2020-01-01',
  sipActive: false,
  nav: 100,
  ...o,
});
const TODAY = '2026-10-26';

describe('planHarvest uses the rules it is given', () => {
  const rule = (fy: string, ex: number) => ({
    fy,
    from: `${fy.slice(0, 4)}-04-01`,
    to: `${Number(fy.slice(0, 4)) + 1}-03-31`,
    equity: { holdingMonthsLong: 12, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemption: ex },
    cess: 0.04,
    verification: 'primary' as const,
    sources: [],
    notes: [],
  });
  const big = [pos({ assetId: 'a', value: 1_000_000, invested: 100_000 })];

  it('follows an allowance changed in Settings', () => {
    const plan = planHarvest(big, TODAY, { rules: [rule('2026-27', 200_000)] });
    expect(plan.plans[0]!.exemption).toBe(200_000);
    expect(plan.plans[0]!.totalGain).toBeLessThanOrEqual(200_000);
    expect(plan.rulesVerified).toBe(true);
  });

  it('carries the latest earlier year forward when a new year has no rules, and says so', () => {
    const plan = planHarvest(big, '2028-05-10', { rules: [rule('2026-27', 150_000)] });
    expect(plan.status).toBe('ok');
    expect(plan.rulesCarriedForward).toBe(true);
    expect(plan.rulesVerified).toBe(false);
    expect(plan.fy).toBe('2028-29');
    expect(plan.plans[0]!.exemption).toBe(150_000);
  });

  it('reports missing rules only when no earlier year exists at all', () => {
    expect(planHarvest(big, '2020-05-10', { rules: [rule('2026-27', 1)] }).status).toBe(
      'rules_missing',
    );
  });

  it('obeys the harvest switches: minimum sale, active SIP, NRI withholding and the reminder date', () => {
    const withSip = [pos({ assetId: 's', value: 300_000, invested: 200_000, sipActive: true })];
    expect(
      planHarvest(withSip, TODAY, {
        config: { ...DEFAULT_CONFIG.harvest, skipActiveSip: false },
      }).plans[0]!.picks,
    ).toHaveLength(1);
    expect(planHarvest(withSip, TODAY).plans[0]!.picks).toHaveLength(0);
    const resident = planHarvest(
      [pos({ assetId: 'a', value: 150_000, invested: 100_000 })],
      TODAY,
      { config: { ...DEFAULT_CONFIG.harvest, nri: false } },
    );
    expect(resident.plans[0]!.tdsWithheld).toBe(0);
    expect(harvestDueOn(resident, TODAY, { month: 2, day: 1 })).toBe('2027-02-01');
  });
});

describe('planHarvest', () => {
  it('sells whole positions with the smallest gains first and stops inside the allowance', () => {
    const plan = planHarvest(
      [
        pos({ assetId: 'a', fund: 'A', value: 150_000, invested: 100_000 }), // gain 50k
        pos({ assetId: 'b', fund: 'B', value: 180_000, invested: 100_000 }), // gain 80k
        pos({ assetId: 'c', fund: 'C', value: 400_000, invested: 100_000 }), // gain 300k
      ],
      TODAY,
    );
    const p = plan.plans[0]!;
    expect(plan.status).toBe('ok');
    expect(plan.fy).toBe('2026-27');
    expect(plan.deadline).toBe('2027-03-31');
    expect(p.exemption).toBe(125_000);
    // A (50k) fits whole; B (80k) does not (50k+80k > 125k) so it is sold in part to use the remaining 75k
    expect(p.picks[0]).toMatchObject({ assetId: 'a', fullExit: true, estimatedGain: 50_000 });
    expect(p.picks[1]).toMatchObject({ assetId: 'b', fullExit: false });
    expect(p.totalGain).toBeLessThanOrEqual(125_000);
    expect(p.totalGain).toBeGreaterThan(120_000);
  });

  it('plans separately for each person; one person’s gains never use another’s allowance', () => {
    const plan = planHarvest(
      [
        pos({ assetId: 'a', ownerId: 'r', value: 400_000, invested: 100_000 }),
        pos({ assetId: 'b', ownerId: 'g', value: 130_000, invested: 100_000 }),
      ],
      TODAY,
    );
    const r = plan.plans.find((x) => x.ownerId === 'r')!;
    const g = plan.plans.find((x) => x.ownerId === 'g')!;
    expect(r.totalGain).toBeLessThanOrEqual(125_000);
    expect(g.picks[0]).toMatchObject({ assetId: 'b', fullExit: true, estimatedGain: 30_000 });
  });

  it('leaves out SIP funds, recent purchases, losses and unknown dates', () => {
    const plan = planHarvest(
      [
        pos({ assetId: 'sip', sipActive: true }),
        pos({ assetId: 'new', startedOn: '2026-06-01' }),
        pos({ assetId: 'loss', value: 90_000, invested: 100_000 }),
        pos({ assetId: 'nodate', startedOn: null }),
      ],
      TODAY,
    );
    expect(plan.plans[0]!.picks).toEqual([]);
    expect(plan.plans[0]!.notes[0]).toContain('Nothing qualifies');
  });

  it('shrinks the room by gains already booked this year', () => {
    const plan = planHarvest([pos({ assetId: 'a', value: 1_000_000, invested: 100_000 })], TODAY, {
      ytdRealised: { r: 100_000 },
    });
    expect(plan.plans[0]!.room).toBe(25_000);
    expect(plan.plans[0]!.totalGain).toBeLessThanOrEqual(25_000);
  });

  it('estimates the tax an NRI’s fund house would withhold, and says nothing is traded', () => {
    const plan = planHarvest([pos({ assetId: 'a', value: 150_000, invested: 100_000 })], TODAY);
    expect(plan.plans[0]!.tdsWithheld).toBe(Math.round(50_000 * 0.125 * 1.04));
    expect(plan.assumptions.join(' ')).toContain('Nothing is sold for you');
  });

  it('says how much to buy back and expects the whole withholding back', () => {
    const plan = planHarvest(
      [
        pos({ assetId: 'a', fund: 'Fund A', value: 150_000, invested: 100_000 }),
        pos({ assetId: 'b', fund: 'Fund B', value: 300_000, invested: 100_000 }),
      ],
      TODAY,
    );
    const pp = plan.plans[0]!;
    expect(pp.picks.every((x) => x.buyBackAmount === x.sellAmount)).toBe(true);
    expect(pp.buyBackTotal).toBe(pp.totalProceeds);
    expect(pp.refundExpected).toBe(pp.tdsWithheld);
    expect(harvestTaskTitle(plan.fy, 'R', pp)).toContain('buy back');
  });

  it('keeps its task title stable and dates the reminder before the year ends', () => {
    const plan = planHarvest(
      [pos({ assetId: 'a', fund: 'Quant Small Cap', value: 150_000, invested: 100_000 })],
      TODAY,
    );
    const t1 = harvestTaskTitle(plan.fy, 'Rupash', plan.plans[0]!);
    expect(t1.startsWith('[Harvest 2026-27 Rupash]')).toBe(true);
    expect(t1).toContain('sell all of Quant Small Cap');
    expect(harvestDueOn(plan, TODAY)).toBe('2027-03-15');
    expect(harvestDueOn(plan, '2027-03-20')).toBe('2027-03-20');
  });
});

describe('planHarvest with purchase lots from a fund statement', () => {
  const lotted = (over: Partial<HarvestPosition> = {}): HarvestPosition => ({
    assetId: 'm',
    ownerId: 'r',
    fund: 'Statement Fund',
    // 1,000 units at ₹200 today
    value: 200_000,
    invested: 140_000,
    startedOn: '2023-01-01',
    sipActive: true,
    lots: [
      { acquiredOn: '2023-01-01', units: 400, cost: 40_000 }, // 80,000 now, gain 40,000
      { acquiredOn: '2024-06-01', units: 400, cost: 60_000 }, // 80,000 now, gain 20,000
      { acquiredOn: '2026-08-01', units: 200, cost: 40_000 }, // recent
    ],
    ...over,
  });

  it('includes a fund with an active SIP and sells only its old units', () => {
    const plan = planHarvest([lotted()], TODAY);
    const p = plan.plans[0]!;
    expect(p.picks).toHaveLength(1);
    // both old lots together are worth 160,000 with a gain of 60,000, inside the allowance
    expect(p.picks[0]!.sellAmount).toBe(160_000);
    expect(p.picks[0]!.estimatedGain).toBe(60_000);
    expect(p.picks[0]!.fullExit).toBe(false); // the recent lot stays
    expect(p.picks[0]!.buyBackAmount).toBe(160_000);
  });

  it('takes the oldest lots first and part of the next one when the allowance runs out', () => {
    const plan = planHarvest([lotted()], TODAY, { ytdRealised: { r: 100_000 } }); // 25,000 left
    const pick = plan.plans[0]!.picks[0]!;
    expect(pick.estimatedGain).toBe(25_000);
    // first lot's gain is 40,000 so 25,000 is 62.5% of it: 62.5% of 80,000
    expect(pick.sellAmount).toBe(50_000);
  });

  it('ignores units whose cost is not on the statement', () => {
    const plan = planHarvest(
      [lotted({ lots: [{ acquiredOn: '1900-01-01', units: 1000, cost: null }] })],
      TODAY,
    );
    expect(plan.plans[0]!.picks).toHaveLength(0);
  });
});

describe('planHarvest: units, exit load and short-term units are never mishandled', () => {
  const cfg = DEFAULT_CONFIG.harvest;

  it('never offers a sale without exact units: a fund with no price is left out and keeps the allowance for the others', () => {
    const plan = planHarvest(
      [
        pos({
          assetId: 'noprice',
          fund: 'No price',
          taxClass: 'equity',
          value: 200_000,
          invested: 100_000,
          nav: null,
        }),
        pos({ assetId: 'ok', fund: 'Priced', value: 160_000, invested: 100_000 }),
      ],
      TODAY,
    );
    const p = plan.plans[0]!;
    expect(p.picks.map((x) => x.assetId)).toEqual(['ok']);
    expect(p.picks.every((x) => x.units !== null && x.units > 0)).toBe(true);
    const f = p.funds.find((x) => x.assetId === 'noprice')!;
    expect(f.status).toBe('no_lots');
    expect(f.reason).toContain('price');
  });

  it('does not count a sale below the smallest worth suggesting against the allowance', () => {
    const lots = [{ acquiredOn: '2023-01-01', units: 10, cost: 9_900 }]; // ₹100 gain at ₹1,000 a unit
    const plan = planHarvest(
      [
        pos({ assetId: 'tiny', fund: 'Tiny', value: 10_000, invested: 9_900, lots, nav: 1000 }),
        pos({ assetId: 'big', fund: 'Big', value: 400_000, invested: 100_000 }),
      ],
      TODAY,
      { config: { ...cfg, minSellAmount: 50_000 } },
    );
    const p = plan.plans[0]!;
    expect(p.picks.map((x) => x.assetId)).toEqual(['big']);
    // the whole allowance went to the fund that was actually suggested
    expect(p.picks[0]!.estimatedGain).toBeGreaterThan(124_000);
  });

  it('holds back a fund whose first purchase is still inside a long exit-load window (no lots known)', () => {
    const p = pos({
      assetId: 'x',
      taxClass: 'equity',
      value: 150_000,
      invested: 100_000,
      startedOn: '2025-02-01',
    });
    const rule = { ...cfg, exitLoadDays: 730 };
    const held = planHarvest([p], TODAY, { config: rule }).plans[0]!;
    expect(held.picks).toHaveLength(0);
    expect(held.funds[0]!.status).toBe('waiting');
    expect(held.funds[0]!.reason).toContain('exit-load');
    // a fund with its own shorter load is fine
    const own = planHarvest([{ ...p, exitLoad: { pct: 0.01, days: 30 } }], TODAY, {
      config: rule,
    }).plans[0]!;
    expect(own.picks).toHaveLength(1);
    expect(own.picks[0]!.exitLoad).toEqual({ pct: 0.01, days: 30 });
    expect(own.picks[0]!.basis).toBe('total_only');
    expect(own.picks[0]!.lotsEstimated).toBe(true);
  });

  it('sells only long-term lots past the exit-load window, never short-term units, and reports each lot', () => {
    const lots = [
      { acquiredOn: '2024-01-10', units: 100.1, cost: 5_000 },
      { acquiredOn: '2025-06-10', units: 100.2, cost: 8_000 }, // past 12 months, but inside a 600-day window
      { acquiredOn: '2026-05-10', units: 100.3, cost: 9_000 }, // short-term
    ];
    const position = pos({
      assetId: 'l',
      value: 300.6 * 100,
      invested: 22_000,
      lots,
      nav: 100,
      sipActive: true,
    });
    const strict = planHarvest([position], TODAY, { config: { ...cfg, exitLoadDays: 600 } });
    const pick = strict.plans[0]!.picks[0]!;
    expect(pick.lots.map((l) => l.acquiredOn)).toEqual(['2024-01-10']);
    expect(pick.units).toBe(100.1);
    expect(pick.exitLoadCost).toBe(0);
    expect(pick.basis).toBe('statement');
    const normal = planHarvest([position], TODAY).plans[0]!.picks[0]!;
    expect(normal.lots.map((l) => l.acquiredOn)).toEqual(['2024-01-10', '2025-06-10']);
    expect(normal.lots.every((l) => l.longTermOn <= TODAY && l.loadFreeOn <= TODAY)).toBe(true);
    // the lot units add up to the units to sell, to three decimals
    expect(Math.round(normal.lots.reduce((a, l) => a + l.units, 0) * 1000) / 1000).toBe(
      normal.units,
    );
    expect(normal.units).toBe(200.3);
    expect(normal.lots.reduce((a, l) => a + l.gain, 0)).toBeCloseTo(normal.estimatedGain, 0);
  });

  it('does not lose a thousandth of a unit to floating-point sums', () => {
    const lots = Array.from({ length: 3 }, (_, i) => ({
      acquiredOn: `2023-0${i + 1}-05`,
      units: 0.1 + i * 0.1, // 0.1, 0.2, 0.30000000000000004 in floating point
      cost: 1_000,
    }));
    const position = pos({
      assetId: 'f',
      value: 0.6 * 100_000,
      invested: 3_000,
      lots,
      nav: 100_000,
    });
    const pick = planHarvest([position], TODAY).plans[0]!.picks[0]!;
    expect(pick.units).toBe(0.6);
  });

  it('marks purchases worked out from the SIP plan as estimated', () => {
    const lots = [{ acquiredOn: '2023-01-01', units: 100, cost: 5_000, estimated: true }];
    const pick = planHarvest(
      [pos({ assetId: 'e', value: 10_000, invested: 5_000, lots, nav: 100 })],
      TODAY,
    ).plans[0]!.picks[0]!;
    expect(pick.basis).toBe('estimated_lots');
    expect(pick.lotsEstimated).toBe(true);
  });
});
