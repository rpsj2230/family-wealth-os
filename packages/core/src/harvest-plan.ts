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
  lots?: { acquiredOn: string; units: number; cost: number | null }[];
}

export interface HarvestPick {
  assetId: string;
  fund: string;
  sellAmount: number;
  estimatedGain: number;
  fullExit: boolean;
  /** buy the same fund again with the proceeds so the holding carries on with a higher cost basis */
  buyBackAmount: number;
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
    // lots known: the oldest long-term units, their value and gain
    const withLots = mine
      .filter((p) => p.lots && p.lots.length > 0)
      .map((p) => {
        const units = p.lots!.reduce((a, l) => a + l.units, 0);
        const unitValue = units > 0 ? p.value / units : 0;
        const prefix: { value: number; gain: number }[] = [];
        for (const l of [...p.lots!].sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn))) {
          if (l.acquiredOn > longSince || l.cost === null) break;
          const v = l.units * unitValue;
          prefix.push({ value: v, gain: v - l.cost });
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
        prefix: x.prefix as { value: number; gain: number }[] | null,
        eligibleValue: x.value,
      })),
      ...mine
        .filter(
          (p) =>
            !lotted.has(p.assetId) &&
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
          prefix: null as { value: number; gain: number }[] | null,
          eligibleValue: p.value,
        })),
    ]
      // smallest whole gains first, so as many positions as possible are completed inside the allowance
      .sort((a, b) => a.gain - b.gain);
    const picks: HarvestPick[] = [];
    let left = room;
    for (const p of eligible) {
      if (left < 1) break;
      if (p.prefix) {
        // sell the oldest lots in order; the last lot only in part
        let sell = 0;
        let gain = 0;
        let full = true;
        for (const l of p.prefix) {
          if (left - gain < 1) {
            full = false;
            break;
          }
          if (l.gain <= left - gain) {
            sell += l.value;
            gain += l.gain;
          } else {
            const f = l.gain > 0 ? (left - gain) / l.gain : 0;
            sell += l.value * f;
            gain += l.gain * f;
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
    return {
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
