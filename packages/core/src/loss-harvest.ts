/**
 * Loss harvesting for equity funds: booking a loss to set against gains.
 *  - A short-term loss sets off short-term gains first, then long-term gains; a long-term loss sets off long-term gains only.
 *  - Losses are set off BEFORE the yearly tax-free allowance, so a loss only saves tax when gains exceed the allowance
 *    (or short-term gains exist). Otherwise it is carried forward for eight years, if the return is filed on time.
 *  - Units are sold oldest first, so a loss on recent units can only be booked by selling the older units too; the figure shown
 *    is what selling that many of the oldest units books in total.
 * Pure; nothing is sold. The same units can be bought back, but a round trip with no purpose other than the tax can be questioned
 * (there is no wash-sale rule, only the general anti-avoidance rule), so the page says to keep a reason and a gap.
 */
import { DEFAULT_CONFIG, type AppConfig } from './config';
import { fundTaxClass } from './fund-class';
import { lotLadder, sellPrefix } from './harvest-lots';
import type { HarvestPosition } from './harvest-plan';
import { effectiveRules, fyOf, RULES, type TaxRuleSet } from './tax';

export interface LossCandidate {
  assetId: string;
  fund: string;
  /** units to redeem, oldest first */
  units: number;
  proceeds: number;
  /** positive numbers: the loss this sale books, split by term */
  shortLoss: number;
  longLoss: number;
  /** exit load the sale would cost, on units still inside the load window */
  exitLoad: number;
  lots: number;
  lotsEstimated: boolean;
  /** the purchases the units come from, oldest first, each sold in full */
  lotDetail: {
    acquiredOn: string;
    units: number;
    cost: number;
    value: number;
    gain: number;
    longTerm: boolean;
  }[];
  /** the units the fund holds in all */
  unitsHeld: number;
}

export interface PersonLossHarvest {
  ownerId: string;
  candidates: LossCandidate[];
  totalShortLoss: number;
  totalLongLoss: number;
  /** gains this year that losses can be set against */
  stcgYtd: number;
  ltcgYtd: number;
  /** tax the losses save this year if booked */
  taxSavedNow: number;
  /** the part of the losses with no gain to meet this year: carried forward */
  carryForward: number;
  notes: string[];
}

export interface LossHarvestPlan {
  fy: string;
  plans: PersonLossHarvest[];
}

export function planLossHarvest(
  positions: HarvestPosition[],
  today: string,
  opts: {
    ytd?: Record<string, { stcg: number; ltcg: number }>;
    /** long-term gain a gain harvest already plans for each person */
    plannedGain?: Record<string, number>;
    rules?: TaxRuleSet[];
    config?: AppConfig['harvest'];
  } = {},
): LossHarvestPlan {
  const cfg = opts.config ?? DEFAULT_CONFIG.harvest;
  const eff = effectiveRules(today, opts.rules ?? RULES);
  const fy = fyOf(today);
  if (!eff) return { fy, plans: [] };
  const r = eff.rules;
  const owners = [...new Set(positions.map((p) => p.ownerId))];
  const plans = owners.map((ownerId): PersonLossHarvest => {
    const candidates: LossCandidate[] = [];
    for (const p of positions.filter((x) => x.ownerId === ownerId && x.lots && x.lots.length > 0)) {
      if ((p.taxClass ?? fundTaxClass(p.fund).class) !== 'equity') continue;
      const units = p.lots!.reduce((a, l) => a + l.units, 0);
      if (!(units > 0) || !(p.value > 0)) continue;
      const ex =
        p.exitLoad ??
        (cfg.exitLoadDays > 0 ? { pct: cfg.exitLoadPct, days: cfg.exitLoadDays } : null);
      const ladder = lotLadder({
        lots: p.lots!,
        unitValue: p.value / units,
        today,
        rules: {
          holdingMonths: r.equity.holdingMonthsLong,
          ...(ex ? { exitLoadDays: ex.days, exitLoadPct: ex.pct } : {}),
          lockInMonths: p.lockInMonths ?? 0,
        },
        fmv2018PerUnit: p.fmv2018 ?? null,
      });
      // the sale can only run through lots with a known cost that are not locked in
      let usable = 0;
      for (const s of ladder.lots) {
        if (s.gain === null || s.unlockedOn > today) break;
        usable++;
      }
      let best: { k: number; loss: number } | null = null;
      for (let k = 1; k <= usable; k++) {
        const split = sellPrefix(ladder.lots, k, today);
        const loss = -(split.short + split.long);
        if (loss > 0 && (!best || loss > best.loss)) best = { k, loss };
      }
      if (!best || best.loss < 500) continue;
      const split = sellPrefix(ladder.lots, best.k, today);
      const sold = ladder.lots.slice(0, best.k);
      candidates.push({
        assetId: p.assetId,
        fund: p.fund,
        units: Math.floor(sold.reduce((a, s) => a + s.lot.units, 0) * 1000 + 1e-6) / 1000,
        proceeds: Math.round(split.proceeds),
        shortLoss: Math.round(Math.max(0, -split.short)),
        longLoss: Math.round(Math.max(0, -split.long)),
        exitLoad: Math.round(
          sold.reduce((a, s) => a + (ex && s.loadFreeOn > today ? s.value * ex.pct : 0), 0),
        ),
        lots: best.k,
        lotsEstimated: sold.some((s) => s.lot.estimated),
        lotDetail: sold.map((s) => ({
          acquiredOn: s.lot.acquiredOn,
          units: s.lot.units,
          cost: s.value - (s.gain ?? 0),
          value: s.value,
          gain: s.gain ?? 0,
          longTerm: s.longTermOn <= today,
        })),
        unitsHeld: units,
      });
    }
    candidates.sort((a, b) => b.shortLoss + b.longLoss - (a.shortLoss + a.longLoss));
    const y = opts.ytd?.[ownerId] ?? { stcg: 0, ltcg: 0 };
    const planned = opts.plannedGain?.[ownerId] ?? 0;
    const stcl = candidates.reduce((a, c) => a + c.shortLoss, 0);
    const ltcl = candidates.reduce((a, c) => a + c.longLoss, 0);
    // short-term loss meets short-term gain first; what is left, and any long-term loss, meets long-term gain
    const stclVsStcg = Math.min(stcl, Math.max(0, y.stcg));
    const ltcgGross = Math.max(0, y.ltcg + planned);
    const leftover = stcl - stclVsStcg + ltcl;
    // losses come off before the allowance, so only the gain above the allowance saves tax
    const ltcgAboveAllowance = Math.max(0, ltcgGross - r.equity.ltcgExemption);
    const vsLtcg = Math.min(leftover, ltcgAboveAllowance);
    const taxSavedNow = Math.round(
      stclVsStcg * r.equity.stcgRate * (1 + r.cess) + vsLtcg * r.equity.ltcgRate * (1 + r.cess),
    );
    const notes: string[] = [];
    if (candidates.length > 0 && taxSavedNow === 0)
      notes.push(
        'No gain above the allowance and no short-term gain this year, so these losses would not save tax now; they can be carried forward for eight years if the return is filed by its due date.',
      );
    if (candidates.some((c) => c.exitLoad > 0))
      notes.push(
        'Some of these sales pay an exit load on recent units; it is deducted from the proceeds.',
      );
    return {
      ownerId,
      candidates,
      totalShortLoss: stcl,
      totalLongLoss: ltcl,
      stcgYtd: y.stcg,
      ltcgYtd: y.ltcg,
      taxSavedNow,
      carryForward: Math.round(Math.max(0, leftover - vsLtcg)),
      notes,
    };
  });
  return { fy, plans };
}
