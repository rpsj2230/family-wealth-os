/**
 * Automatic tax-gain harvesting plan, per person, with no inputs.
 *
 * Idea: each person can realise ₹1.25 lakh of long-term equity gain a year tax-free (use it or lose it by 31 March).
 * Selling a profitable, long-held fund up to that limit and buying back resets the cost basis, so later sales owe less.
 * This plan picks which positions to sell, how much, per person, for the current financial year.
 *
 * Honest limits (shown to the user): it works from each fund's total invested amount and first purchase date, not from
 * every purchase, so funds with an active SIP are left out (their newer units may still be short-term), the gain on a
 * partial sale is taken in proportion, and gains already booked this year are taken as zero unless supplied.
 * Exact figures arrive with the fund statement (CAS). Nothing is ever traded by the app.
 */
import { DEFAULT_CONFIG, effectiveRules, type AppConfig } from './config';
import { fyOf, RULES, type TaxRuleSet } from './tax';
import { fundTaxClass, type FundTaxClass } from './fund-class';
import { lotLadder, lotStatus, type LotLadder, type LotTranche } from './harvest-lots';

export interface HarvestPosition {
  assetId: string;
  ownerId: string;
  fund: string;
  value: number;
  invested: number;
  startedOn: string | null;
  sipActive: boolean;
  /**
   * Units still held, one entry per purchase, from the fund statement. When present the plan uses real purchase dates
   * and costs (the oldest units are sold first), so a fund with an active SIP is no longer left out. `cost` is null when
   * the purchase is not on the statement; such units are not counted as harvestable.
   */
  lots?: { acquiredOn: string; units: number; cost: number | null; estimated?: boolean }[];
  /** the tax class of the fund (from its category); equity when not given */
  taxClass?: FundTaxClass;
  /** false when the class is only a guess from the fund's name */
  classCertain?: boolean;
  /** latest price per unit, to say how many units to sell */
  nav?: number | null;
  /** this fund's own exit load; the household default is used when absent */
  exitLoad?: { pct: number; days: number } | null;
  /** ELSS lock-in in months from each purchase */
  lockInMonths?: number;
  /** price per unit on 31 Jan 2018 for units bought before 1 Feb 2018 */
  fmv2018?: number | null;
}

export interface HarvestPick {
  assetId: string;
  fund: string;
  sellAmount: number;
  estimatedGain: number;
  fullExit: boolean;
  /** buy the same fund again with the proceeds so the holding carries on with a higher cost basis */
  buyBackAmount: number;
  /** units to redeem (by units rather than by amount, so the gain is what is planned); null when the price is not known */
  units: number | null;
  /** securities transaction tax on the sale plus stamp duty on the purchase */
  frictionCost: number;
  /** the lots behind this sale are estimated from the SIP plan, not read from a fund statement */
  lotsEstimated: boolean;
}

export type FundStatus =
  'picked' | 'ready_not_needed' | 'waiting' | 'no_gain' | 'excluded' | 'no_lots';

/** Why each fund is or is not in the plan, with its lots laid out. */
export interface FundView {
  assetId: string;
  fund: string;
  status: FundStatus;
  className: string;
  /** the class is a guess from the name only */
  classGuess: boolean;
  /** one sentence saying why */
  reason: string;
  value: number;
  lotsEstimated: boolean;
  ladder: LotLadder | null;
  /** the next few days on which more units become ready */
  nextReady: LotTranche[];
}

export interface PersonHarvest {
  ownerId: string;
  exemption: number;
  alreadyUsed: number;
  room: number;
  picks: HarvestPick[];
  totalProceeds: number;
  totalGain: number;
  /** what an NRI's fund house would withhold on these sales until the refund at filing */
  tdsWithheld: number;
  /** the part of that withholding recovered at filing: all of it while the gains stay inside the allowance */
  refundExpected: number;
  /** every fund of this person, with the reason it is or is not being harvested and when its later units become ready */
  funds: FundView[];
  /** total to put back into funds after the sales */
  buyBackTotal: number;
  /** tax that may be avoided on these gains later; hypothetical */
  futureTaxMayBeAvoided: number;
  notes: string[];
}

export interface HarvestPlan {
  status: 'ok' | 'rules_missing';
  /** the tax numbers for this year were not entered; the latest earlier year is assumed to apply */
  rulesCarriedForward: boolean;
  fy: string;
  deadline: string;
  rulesVerified: boolean;
  plans: PersonHarvest[];
  assumptions: string[];
}

const addMonths = (iso: string, m: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + m);
  return d.toISOString().slice(0, 10);
};

export function planHarvest(
  positions: HarvestPosition[],
  today: string,
  opts: {
    ytdRealised?: Record<string, number>;
    rules?: TaxRuleSet[];
    config?: AppConfig['harvest'];
  } = {},
): HarvestPlan {
  const cfg = opts.config ?? DEFAULT_CONFIG.harvest;
  const eff = effectiveRules(today, opts.rules ?? RULES);
  const rules = eff?.rules ?? null;
  const fy = fyOf(today);
  const endYear = Number(fy.slice(0, 4)) + 1;
  const deadline = `${endYear}-03-31`;
  const assumptions = [
    'Funds with an imported fund statement use their real purchase dates and costs, selling the oldest units first. Other funds use the total invested amount and first purchase date.',
    ...(cfg.skipActiveSip
      ? [
          'Funds with an active SIP are left out because their recent units may still be short-term.',
        ]
      : []),
    'The gain on a partial sale is taken in proportion; the real gain can be higher because the oldest units are sold first.',
    'Gains already booked this year are taken as zero unless known.',
    'Nothing is sold for you. Check each redemption screen before confirming.',
  ];
  if (!rules)
    return {
      status: 'rules_missing',
      rulesCarriedForward: false,
      fy,
      deadline,
      rulesVerified: false,
      plans: [],
      assumptions,
    };

  const longSince = addMonths(today, -(rules.equity.holdingMonthsLong + cfg.holdingMarginMonths));
  const tds = cfg.nri ? rules.equity.ltcgRate * (1 + rules.cess) : 0;
  const owners = [...new Set(positions.map((p) => p.ownerId))];
  const plans: PersonHarvest[] = owners.map((ownerId) => {
    const used = opts.ytdRealised?.[ownerId] ?? 0;
    const room = Math.max(0, rules.equity.ltcgExemption - used);
    const notes: string[] = [];
    const mine = positions.filter((p) => p.ownerId === ownerId && p.value > 0);
    // lots known: the oldest units that are ready (long-term, past any exit load and lock-in), their value and gain
    const exitDef = cfg.exitLoadDays > 0 ? { pct: cfg.exitLoadPct, days: cfg.exitLoadDays } : null;
    const rulesFor = (p: HarvestPosition) => {
      const ex = p.exitLoad ?? exitDef;
      return {
        holdingMonths: rules.equity.holdingMonthsLong,
        marginMonths: cfg.holdingMarginMonths,
        ...(ex ? { exitLoadDays: ex.days, exitLoadPct: ex.pct } : {}),
        lockInMonths: p.lockInMonths ?? 0,
      };
    };
    const ladders = new Map<string, LotLadder>();
    const withLots = mine
      .filter((p) => p.lots && p.lots.length > 0 && (p.taxClass ?? 'equity') === 'equity')
      .map((p) => {
        const units = p.lots!.reduce((a, l) => a + l.units, 0);
        const unitValue = units > 0 ? p.value / units : 0;
        const rl = rulesFor(p);
        ladders.set(
          p.assetId,
          lotLadder({
            lots: p.lots!,
            unitValue,
            today,
            rules: rl,
            fmv2018PerUnit: p.fmv2018 ?? null,
          }),
        );
        const prefix: { value: number; gain: number; units: number }[] = [];
        for (const l of [...p.lots!].sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn))) {
          if (l.cost === null) break;
          const st = lotStatus(l, unitValue, rl, p.fmv2018 ?? null);
          if (st.readyOn > today) break;
          prefix.push({ value: st.value, gain: st.gain ?? 0, units: l.units });
        }
        const gain = prefix.reduce((a, l) => a + l.gain, 0);
        return { p, prefix, gain, value: prefix.reduce((a, l) => a + l.value, 0) };
      })
      .filter((x) => x.prefix.length > 0 && x.gain > 0);
    const lotted = new Set(mine.filter((p) => p.lots && p.lots.length > 0).map((p) => p.assetId));
    const eligible = [
      ...withLots.map((x) => ({
        ...x.p,
        gain: x.gain,
        ratio: x.value > 0 ? x.gain / x.value : 0,
        prefix: x.prefix as { value: number; gain: number; units: number }[] | null,
        eligibleValue: x.value,
      })),
      ...mine
        .filter(
          (p) =>
            !lotted.has(p.assetId) &&
            (p.taxClass ?? 'equity') === 'equity' &&
            (p.lockInMonths ?? 0) === 0 &&
            !(cfg.skipActiveSip && p.sipActive) &&
            p.startedOn !== null &&
            p.startedOn <= longSince &&
            p.invested > 0 &&
            p.value > p.invested,
        )
        .map((p) => ({
          ...p,
          gain: p.value - p.invested,
          ratio: (p.value - p.invested) / p.value,
          prefix: null as { value: number; gain: number; units: number }[] | null,
          eligibleValue: p.value,
        })),
    ]
      // smallest whole gains first, so as many positions as possible are completed inside the allowance
      .sort((a, b) => a.gain - b.gain);
    const friction = (amount: number) =>
      Math.round(amount * cfg.sttPct + amount * cfg.stampDutyPct);
    const unitsFor = (nav: number | null | undefined, amount: number) =>
      nav && nav > 0 ? Math.floor((amount / nav) * 1000) / 1000 : null;
    const picks: HarvestPick[] = [];
    let left = room;
    for (const p of eligible) {
      if (left < 1) break;
      if (p.prefix) {
        // sell the oldest lots in order; the last lot only in part
        let sell = 0;
        let gain = 0;
        let soldUnits = 0;
        let full = true;
        for (const l of p.prefix) {
          if (left - gain < 1) {
            full = false;
            break;
          }
          if (l.gain <= left - gain) {
            sell += l.value;
            gain += l.gain;
            soldUnits += l.units;
          } else {
            const f = l.gain > 0 ? (left - gain) / l.gain : 0;
            sell += l.value * f;
            gain += l.gain * f;
            soldUnits += l.units * f;
            full = false;
            break;
          }
        }
        if (sell >= cfg.minSellAmount) {
          picks.push({
            assetId: p.assetId,
            fund: p.fund,
            sellAmount: Math.floor(sell),
            estimatedGain: Math.round(gain),
            fullExit: full && p.eligibleValue >= p.value - 1,
            buyBackAmount: Math.floor(sell),
            units: Math.floor(soldUnits * 1000) / 1000,
            frictionCost: friction(sell),
            lotsEstimated: !!p.lots?.some((x) => x.estimated),
          });
        }
        left -= gain;
        continue;
      }
      if (p.gain <= left) {
        picks.push({
          assetId: p.assetId,
          fund: p.fund,
          sellAmount: Math.round(p.value),
          estimatedGain: Math.round(p.gain),
          fullExit: true,
          buyBackAmount: Math.round(p.value),
          units: unitsFor(p.nav, p.value),
          frictionCost: friction(p.value),
          lotsEstimated: false,
        });
        left -= p.gain;
      } else {
        const sell = Math.floor(left / p.ratio);
        if (sell >= cfg.minSellAmount)
          picks.push({
            assetId: p.assetId,
            fund: p.fund,
            sellAmount: sell,
            estimatedGain: Math.round(left),
            fullExit: false,
            buyBackAmount: sell,
            units: unitsFor(p.nav, sell),
            frictionCost: friction(sell),
            lotsEstimated: false,
          });
        left = 0;
      }
    }
    if (eligible.length === 0)
      notes.push(
        'Nothing qualifies yet: no profitable fund with long-held units' +
          (cfg.skipActiveSip
            ? ' (funds with an active SIP are left out until a fund statement is imported).'
            : '.'),
      );
    else if (room < rules.equity.ltcgExemption)
      notes.push('Part of this year’s allowance is already used.');
    const totalGain = picks.reduce((s, p) => s + p.estimatedGain, 0);
    const pickedIds = new Set(picks.map((x) => x.assetId));
    const readyIds = new Set(withLots.map((x) => x.p.assetId));
    const funds: FundView[] = mine.map((p) => {
      const cls = fundTaxClass(p.fund);
      const klass = p.taxClass ?? cls.class;
      const ladder = ladders.get(p.assetId) ?? null;
      const estimated = !!p.lots?.some((x) => x.estimated);
      const base = {
        assetId: p.assetId,
        fund: p.fund,
        className: klass === 'equity' ? 'Equity-oriented' : fundTaxClass(p.fund, null).label,
        classGuess: p.classCertain === false,
        value: p.value,
        lotsEstimated: estimated,
        ladder,
        nextReady: ladder ? ladder.upcoming.slice(0, 6) : [],
      };
      if (klass !== 'equity')
        return {
          ...base,
          status: 'excluded' as const,
          className: cls.label,
          reason:
            klass === 'other_long'
              ? 'International, gold or fund-of-funds units: long-term only after 24 months and no tax-free allowance, so they cannot be harvested like equity funds.'
              : klass === 'debt_slab'
                ? 'Debt fund: taxed at your slab rate whatever the holding period, so there is nothing to harvest.'
                : 'Hybrid or unknown category: the tax depends on its equity share. Check the fund’s factsheet before harvesting.',
        };
      if ((p.lockInMonths ?? 0) > 0 && !ladder)
        return {
          ...base,
          status: 'excluded' as const,
          reason:
            'ELSS: each purchase is locked for 3 years, and buying back starts a new lock-in. Not harvested without the purchase dates.',
        };
      if (pickedIds.has(p.assetId))
        return {
          ...base,
          status: 'picked' as const,
          reason: 'Sold up to the allowance, oldest units first.',
        };
      if (readyIds.has(p.assetId))
        return {
          ...base,
          status: 'ready_not_needed' as const,
          reason: 'Has units ready, but the allowance is used up by funds with smaller gains.',
        };
      if (ladder && ladder.ready.lots === 0 && ladder.waiting.lots > 0)
        return {
          ...base,
          status: 'waiting' as const,
          reason: `No unit is ready yet: the oldest purchase (${ladder.firstPurchase}) has not passed one year${p.exitLoad || cfg.exitLoadDays ? ' and the exit-load window' : ''}.`,
        };
      if (ladder && ladder.ready.lots === 0 && ladder.readyAtLoss.lots > 0)
        return {
          ...base,
          status: 'no_gain' as const,
          reason:
            'The units that are ready are at a loss: nothing to harvest as a gain (see loss harvesting).',
        };
      if (!ladder && p.value <= p.invested)
        return { ...base, status: 'no_gain' as const, reason: 'Not in profit.' };
      if (!ladder && (p.startedOn === null || p.startedOn > longSince))
        return {
          ...base,
          status: 'waiting' as const,
          reason: p.startedOn
            ? `Started ${p.startedOn}; not yet past the long-term period.`
            : 'No start date is known.',
        };
      if (!ladder && cfg.skipActiveSip && p.sipActive)
        return {
          ...base,
          status: 'no_lots' as const,
          reason:
            'Active SIP and no purchase history: import a fund statement so its older units can be used.',
        };
      return {
        ...base,
        status: 'no_lots' as const,
        reason: 'Purchase history is needed to know which units are old enough.',
      };
    });
    return {
      funds,
      ownerId,
      exemption: rules.equity.ltcgExemption,
      alreadyUsed: used,
      room,
      picks,
      totalProceeds: picks.reduce((s, p) => s + p.sellAmount, 0),
      totalGain,
      tdsWithheld: Math.round(totalGain * tds),
      // the gains are held to the allowance, so no tax is due on them and every rupee withheld is recovered
      refundExpected: Math.round(totalGain * tds),
      buyBackTotal: picks.reduce((s, p) => s + p.buyBackAmount, 0),
      futureTaxMayBeAvoided: Math.round(totalGain * rules.equity.ltcgRate * (1 + rules.cess)),
      notes,
    };
  });
  return {
    status: 'ok',
    rulesCarriedForward: eff?.carriedForward ?? false,
    fy,
    deadline,
    rulesVerified: rules.verification === 'primary',
    plans,
    assumptions,
  };
}

/** Task title for a person's harvest, stable per year so re-running the job never duplicates it. */
export const harvestTaskTitle = (fy: string, ownerName: string, p: PersonHarvest) =>
  `[Harvest ${fy} ${ownerName}] Realise about ₹${p.totalGain.toLocaleString('en-IN')} of tax-free gain: ${p.picks
    .map(
      (x) =>
        `${x.fullExit ? 'sell all of' : 'sell ₹' + x.sellAmount.toLocaleString('en-IN') + ' of'} ${x.fund}`,
    )
    .join(
      '; ',
    )}. Then buy back ₹${p.buyBackTotal.toLocaleString('en-IN')} into the same funds. Before 31 March`;

/** When the reminder task is due (the date comes from Settings); never in the past. */
export function harvestDueOn(
  plan: HarvestPlan,
  today: string,
  remind: { month: number; day: number } = {
    month: DEFAULT_CONFIG.reminders.harvestMonth,
    day: DEFAULT_CONFIG.reminders.harvestDay,
  },
): string {
  const endYear = plan.deadline.slice(0, 4);
  const due = `${endYear}-${String(remind.month).padStart(2, '0')}-${String(remind.day).padStart(2, '0')}`;
  return due < today ? today : due;
}

/** One or two plain sentences for the daily summary: how long is left and what to sell, per person. */
export function harvestPlanSummary(
  plan: HarvestPlan,
  today: string,
  ownerName: Map<string, string>,
): string[] {
  if (plan.status !== 'ok') return [];
  const left = Math.round(
    (Date.parse(`${plan.deadline}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
  const rupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
  return plan.plans
    .filter((p) => p.picks.length > 0)
    .map(
      (p) =>
        `Tax harvest for ${ownerName.get(p.ownerId) ?? 'a family member'}: ${left} days left in ${plan.fy}; sell about ${rupees(p.totalProceeds)} of funds (${rupees(p.totalGain)} tax-free gain) and buy back; about ${rupees(p.refundExpected)} withheld tax comes back when you file.`,
    );
}
