import { describe, expect, it } from 'vitest';
import { planLossHarvest } from '../src/loss-harvest';
import { planHarvest, type HarvestPosition } from '../src/harvest-plan';
import { DEFAULT_CONFIG } from '../src/config';

const TODAY = '2026-10-26';
const base = (o: Partial<HarvestPosition>): HarvestPosition => ({
  assetId: 'f',
  ownerId: 'r',
  fund: 'Quant Small Cap Fund',
  value: 0,
  invested: 0,
  startedOn: null,
  sipActive: true,
  ...o,
});

describe('planLossHarvest', () => {
  // 100 units a month from Jan to Aug 2026 bought at 150; the fund is now at 120: every lot is at a loss
  const lots = Array.from({ length: 8 }, (_, i) => ({
    acquiredOn: `2026-${String(i + 1).padStart(2, '0')}-10`,
    units: 100,
    cost: 15_000,
  }));
  const fund = base({ value: 96_000, invested: 120_000, lots });

  it('books the short-term loss of recent purchases and says exit load applies', () => {
    const p = planLossHarvest([fund], TODAY).plans[0]!;
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]).toMatchObject({ shortLoss: 24_000, longLoss: 0, lots: 8, units: 800 });
    expect(p.candidates[0]!.exitLoad).toBe(960);
    expect(p.notes.join(' ')).toContain('exit load');
  });

  it('saves tax only against gains: short-term gain first, then long-term gain above the allowance', () => {
    const none = planLossHarvest([fund], TODAY).plans[0]!;
    expect(none.taxSavedNow).toBe(0);
    expect(none.carryForward).toBe(24_000);
    expect(none.notes.join(' ')).toContain('carried forward for eight years');

    const stcg = planLossHarvest([fund], TODAY, { ytd: { r: { stcg: 10_000, ltcg: 0 } } })
      .plans[0]!;
    expect(stcg.taxSavedNow).toBe(Math.round(10_000 * 0.2 * 1.04));
    expect(stcg.carryForward).toBe(14_000);

    // long-term gain of 2,00,000 against a 1,25,000 allowance: only the 75,000 above it can be reduced
    const ltcg = planLossHarvest([fund], TODAY, { ytd: { r: { stcg: 0, ltcg: 200_000 } } })
      .plans[0]!;
    expect(ltcg.taxSavedNow).toBe(Math.round(24_000 * 0.125 * 1.04));
    expect(ltcg.carryForward).toBe(0);

    // a gain inside the allowance is not taxed anyway, so a loss against it saves nothing
    const inside = planLossHarvest([fund], TODAY, { ytd: { r: { stcg: 0, ltcg: 100_000 } } })
      .plans[0]!;
    expect(inside.taxSavedNow).toBe(0);
  });

  it('cannot pick the loss lots alone: older profitable units are sold first and offset the loss', () => {
    const mixed = base({
      value: 140_000,
      invested: 150_000,
      lots: [
        { acquiredOn: '2024-01-10', units: 500, cost: 25_000 }, // worth 60,000: gain 35,000, long-term
        { acquiredOn: '2026-05-10', units: 1000, cost: 125_000 }, // worth 120,000... see value below
      ],
    });
    // unit price = 140,000 / 1,500 units = 93.33: lot 1 worth 46,667 (gain 21,667), lot 2 worth 93,333 (loss 31,667)
    const p = planLossHarvest([mixed], TODAY).plans[0]!;
    // selling both books a net loss of 10,000 (long gain 21,667 less short loss 31,667)
    expect(p.candidates[0]!.shortLoss).toBe(31_667);
    expect(p.candidates[0]!.longLoss).toBe(0);
  });

  it('ignores debt funds, ELSS lots still locked in, and tiny losses', () => {
    expect(
      planLossHarvest([{ ...fund, fund: 'HDFC Liquid Fund' }], TODAY).plans[0]!.candidates,
    ).toEqual([]);
    const elss = planLossHarvest([{ ...fund, lockInMonths: 36 }], TODAY).plans[0]!;
    expect(elss.candidates).toEqual([]);
    const tiny = base({
      value: 14_800,
      invested: 15_000,
      lots: [{ acquiredOn: '2026-01-10', units: 100, cost: 15_000 }],
    });
    expect(planLossHarvest([tiny], TODAY).plans[0]!.candidates).toEqual([]);
  });
});

describe('planHarvest: the per-lot checks', () => {
  const rule = { ...DEFAULT_CONFIG.harvest };
  const sip = (o: Partial<HarvestPosition> = {}): HarvestPosition => ({
    assetId: 's',
    ownerId: 'r',
    fund: 'Quant Small Cap Fund',
    value: 36_000,
    invested: 24_000,
    startedOn: '2025-09-10',
    sipActive: true,
    nav: 120,
    // 300 units: three monthly instalments of 100 units at 80 (cost 8,000 each)
    lots: [
      { acquiredOn: '2025-09-10', units: 100, cost: 8_000 },
      { acquiredOn: '2025-10-10', units: 100, cost: 8_000 },
      { acquiredOn: '2025-11-10', units: 100, cost: 8_000 },
    ],
    ...o,
  });

  it('uses only the instalments that are over a year old and plus the margin, and tells when the next becomes ready', () => {
    const plan = planHarvest([sip()], '2026-09-20', { config: { ...rule, minSellAmount: 100 } })
      .plans[0]!;
    // the 10 Sep 2025 instalment is long-term from 11 Sep 2026 and ready a month later (the safety margin), 11 Oct
    expect(plan.picks).toEqual([]);
    const view = plan.funds[0]!;
    expect(view.status).toBe('waiting');
    expect(view.nextReady.map((t) => t.on)).toEqual(['2026-10-11', '2026-11-11', '2026-12-11']);

    const later = planHarvest([sip()], '2026-11-20', { config: { ...rule, minSellAmount: 100 } })
      .plans[0]!;
    const pick = later.picks[0]!;
    expect(pick.units).toBe(200);
    expect(pick.estimatedGain).toBe(8_000);
    expect(pick.fullExit).toBe(false);
    expect(later.funds[0]!.status).toBe('picked');
  });

  it('counts units, and the small cost of stamp duty and transaction tax', () => {
    const plan = planHarvest([sip()], '2026-11-20', { config: { ...rule, minSellAmount: 100 } })
      .plans[0]!;
    const pick = plan.picks[0]!;
    expect(pick.frictionCost).toBe(
      Math.round(pick.sellAmount * 0.00001 + pick.buyBackAmount * 0.00005),
    );
  });

  it('holds back units still inside the exit-load window and ELSS units still locked', () => {
    const wide = planHarvest([sip()], '2026-11-20', {
      config: { ...rule, minSellAmount: 100, exitLoadDays: 730 },
    }).plans[0]!;
    expect(wide.picks).toEqual([]);
    const elss = planHarvest([sip({ lockInMonths: 36 })], '2026-11-20', {
      config: { ...rule, minSellAmount: 100 },
    }).plans[0]!;
    expect(elss.picks).toEqual([]);
  });

  it('leaves non-equity funds out and says why', () => {
    const plan = planHarvest(
      [
        sip({ taxClass: 'other_long', fund: 'Nasdaq 100 FoF' }),
        sip({ assetId: 'd', taxClass: 'debt_slab', fund: 'Liquid' }),
      ],
      '2026-12-15',
    ).plans[0]!;
    expect(plan.picks).toEqual([]);
    expect(plan.funds.map((f) => f.status)).toEqual(['excluded', 'excluded']);
    expect(plan.funds[0]!.reason).toContain('24 months');
    expect(plan.funds[1]!.reason).toContain('slab');
  });

  it('applies the 31 January 2018 value to old units', () => {
    const old = sip({
      value: 100_000,
      nav: 100,
      lots: [{ acquiredOn: '2016-05-01', units: 1000, cost: 40_000 }],
      fmv2018: 80,
    });
    const plan = planHarvest([old], '2026-12-15', { config: { ...rule, minSellAmount: 100 } })
      .plans[0]!;
    // cost becomes the higher of 40,000 and the lower of 80,000 (2018 value) and 100,000 (sale value): gain 20,000, not 60,000
    expect(plan.picks[0]!.estimatedGain).toBe(20_000);
  });
});
