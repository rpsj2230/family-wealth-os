import { describe, expect, it } from 'vitest';
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
        config: { minSellAmount: 1000, holdingMarginMonths: 1, skipActiveSip: false, nri: true },
      }).plans[0]!.picks,
    ).toHaveLength(1);
    expect(planHarvest(withSip, TODAY).plans[0]!.picks).toHaveLength(0);
    const resident = planHarvest(
      [pos({ assetId: 'a', value: 150_000, invested: 100_000 })],
      TODAY,
      { config: { minSellAmount: 1000, holdingMarginMonths: 1, skipActiveSip: true, nri: false } },
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
