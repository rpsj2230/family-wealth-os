/**
 * What the Tax page shows for a tax-gain harvest, worked out as plain data so no arithmetic is left in the page:
 * per person a headline, the allowance meter, a short "sell this" list, the funds to leave for now with the dates they turn
 * ready, the losses worth booking, and the costs to expect. The detail the engine computes (purchase lots, term split, buy-back
 * amounts, set-off order, withholding) is kept apart, under each fund's "working", so the main view stays short.
 * Pure; every number comes from the plan, the tax rules and the harvest settings. Nothing here sells or buys.
 */
import type { AppConfig } from './config';
import { DEFAULT_CONFIG } from './config';
import { addDaysIso, addMonthsIso } from './harvest-lots';
import type { FundView, HarvestPlan, HarvestPick, PersonHarvest } from './harvest-plan';
import type { LossCandidate, LossHarvestPlan, PersonLossHarvest } from './loss-harvest';
import { formatInr } from './money';
import { effectiveRules, RULES, type TaxRuleSet } from './tax';

const DAY = 86_400_000;
const iso = (d: string) => Date.parse(`${d}T00:00:00Z`);

/** 12 Dec 2026 */
export const shortDate = (d: string): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** 31 March 2027 */
export const fullDate = (d: string): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Units as a fund statement shows them: three decimals, no thousands separator, so the figure can be typed or pasted as it is. */
export const formatUnits = (n: number): string => (Math.round(n * 1000) / 1000).toFixed(3);

const inr = (n: number) => formatInr(Math.round(n));
const pct = (r: number) => `${Math.round(r * 10000) / 100}%`;
const monthsText = (m: number) => `${m} month${m === 1 ? '' : 's'}`;

export type Tone = 'ok' | 'warn';
export interface Check {
  tone: Tone;
  text: string;
}

export interface WorkingLot {
  acquiredOn: string;
  /** units sold from this purchase */
  units: number;
  /** units bought in this purchase, so a part sale can say "part of" */
  unitsInLot: number;
  partial: boolean;
  cost: number;
  value: number;
  gain: number;
  longTerm: boolean;
}

export interface SellWorking {
  /** one sentence on where the lots come from */
  basisLabel: string;
  /** the lots are read from a statement, not estimated */
  exact: boolean;
  lots: WorkingLot[];
  totals: { cost: number; value: number; gain: number };
  /** how the gain splits by term */
  shortTermGain: number;
  longTermGain: number;
  /** what to put back into the fund afterwards, and the costs of selling and buying */
  buyBack: number;
  costs: { stt: number; stampDuty: number; exitLoad: number };
  notes: string[];
}

export interface SellRow {
  assetId: string;
  fund: string;
  /** units to type into the sell screen, and the same as text with three decimals */
  units: number;
  unitsText: string;
  /** "Oldest 123.456 of 400.000 units" or "Whole holding" */
  scope: string;
  worth: number;
  gain: number;
  checks: Check[];
  /** the units come from estimated lots (not a statement) */
  estimated: boolean;
  working: SellWorking;
}

export interface DateLine {
  text: string;
  on: string;
}

export interface NotNowRow {
  assetId: string;
  fund: string;
  kind: 'waiting' | 'allowance_used' | 'no_gain' | 'needs_data' | 'more_later';
  /** plain sentence: why not now */
  reason: string;
  /** the dates that matter, soonest first */
  dates: DateLine[];
  /** the first day any of its units is fine to sell, when known */
  okOn: string | null;
  /** later tranches: when each batch turns ready (soonest first) */
  later: { on: string; units: number; gain: number; lots: number }[];
  estimated: boolean;
}

export interface LossRow {
  assetId: string;
  fund: string;
  units: number;
  unitsText: string;
  scope: string;
  worth: number;
  loss: number;
  shortLoss: number;
  longLoss: number;
  exitLoad: number;
  sentence: string;
  estimated: boolean;
  lots: WorkingLot[];
}

export interface LossSection {
  rows: LossRow[];
  /** plain sentence: what booking these would do for tax this year */
  summary: string;
  /** the set-off order, carry-forward and gains booked so far, for "show the working" */
  working: string[];
}

export interface PersonView {
  ownerId: string;
  name: string;
  /** the one sentence at the top of the person's block */
  headline: string;
  /** a second, shorter sentence: what is already used or why nothing is ready */
  sub: string;
  meter: { allowance: number; used: number; plan: number; free: number };
  sell: SellRow[];
  notNow: NotNowRow[];
  /** funds the harvest does not apply to (other fund types) with one sentence each */
  leftOut: { assetId: string; fund: string; reason: string }[];
  losses: LossSection;
  /** the non-resident detail and the tax this may save later, shown only under "show the working" */
  working: string[];
  /** costs to expect for this person's sales */
  costs: { stt: number; stampDuty: number; exitLoad: number };
}

export interface HarvestView {
  fy: string;
  deadline: string;
  deadlineLabel: string;
  daysLeft: number;
  people: PersonView[];
  /** costs to expect across everyone, one footnote */
  costs: { stt: number; stampDuty: number; exitLoad: number; total: number };
  costsLine: string;
  /** five short lines for the platform, with this year's dates */
  checklist: string[];
  /** the day to place orders by (the deadline less the buffer from Settings) */
  orderBy: string;
}

export interface HarvestViewInput {
  plan: HarvestPlan;
  losses: LossHarvestPlan;
  today: string;
  names: Record<string, string>;
  rules?: TaxRuleSet[];
  config?: AppConfig['harvest'];
}

/** The dates a fund's units turn long-term and lose their exit load, from the lots (or the first purchase when no lots are known). */
function fundDates(
  f: FundView,
  today: string,
  holdingMonths: number,
): { longTermOn: string | null; loadFreeOn: string | null } {
  const lt: string[] = [];
  const lf: string[] = [];
  if (f.ladder && f.ladder.lots.length > 0) {
    for (const s of f.ladder.lots) {
      if (s.gain === null) continue;
      if (s.longTermOn > today) lt.push(s.longTermOn);
      if (f.exitLoad && s.loadFreeOn > today) lf.push(s.loadFreeOn);
    }
  } else if (f.startedOn) {
    const l = addDaysIso(addMonthsIso(f.startedOn, holdingMonths), 1);
    if (l > today) lt.push(l);
    if (f.exitLoad) {
      const x = addDaysIso(f.startedOn, f.exitLoad.days + 1);
      if (x > today) lf.push(x);
    }
  }
  const min = (a: string[]) => (a.length > 0 ? a.reduce((x, y) => (x < y ? x : y)) : null);
  return { longTermOn: min(lt), loadFreeOn: min(lf) };
}

function workingLots(pick: HarvestPick, today: string): WorkingLot[] {
  return pick.lots.map((l) => ({
    acquiredOn: l.acquiredOn,
    units: l.units,
    unitsInLot: l.unitsInLot,
    partial: l.partial,
    cost: l.cost,
    value: l.value,
    gain: l.gain,
    longTerm: l.longTermOn <= today,
  }));
}

function sellRow(
  pick: HarvestPick,
  pp: PersonHarvest,
  today: string,
  rules: TaxRuleSet,
  sipActive: boolean,
): SellRow {
  const holding = rules.equity.holdingMonthsLong;
  const lots = workingLots(pick, today);
  const checks: Check[] = [];
  // 1. term
  if (pick.basis === 'total_only') {
    checks.push(
      sipActive
        ? {
            tone: 'warn',
            text: 'Long-term judged from the first purchase only; newer monthly units may be short-term',
          }
        : {
            tone: 'ok',
            text: `Held over ${monthsText(holding)}, long-term (from the first purchase date)`,
          },
    );
  } else if (lots.every((l) => l.longTerm)) {
    checks.push({ tone: 'ok', text: `Held over ${monthsText(holding)}, long-term` });
  } else {
    checks.push({ tone: 'warn', text: `Some units are held under ${monthsText(holding)}` });
  }
  // 2. exit load
  if (!pick.exitLoad) checks.push({ tone: 'ok', text: 'No exit load on this fund' });
  else if (pick.exitLoadCost > 0)
    checks.push({ tone: 'warn', text: `Exit load ${inr(pick.exitLoadCost)} applies` });
  else checks.push({ tone: 'ok', text: `No exit load (past ${pick.exitLoad.days} days)` });
  // 3. allowance
  checks.push(
    pp.totalGain <= pp.room + 1
      ? { tone: 'ok', text: 'Within this year’s free allowance' }
      : { tone: 'warn', text: 'Above this year’s free allowance' },
  );
  // 4. where the lots come from
  checks.push(
    pick.basis === 'statement'
      ? { tone: 'ok', text: 'Lots: from your statement' }
      : pick.basis === 'estimated_lots'
        ? {
            tone: 'warn',
            text: 'Lots: estimated from your SIP history (import a statement for exact units)',
          }
        : {
            tone: 'warn',
            text: 'Units estimated from the total invested (import a statement for exact units)',
          },
  );

  const shortTermGain = lots.filter((l) => !l.longTerm).reduce((a, l) => a + l.gain, 0);
  const totalGain = lots.length > 0 ? lots.reduce((a, l) => a + l.gain, 0) : pick.estimatedGain;
  const notes: string[] = [];
  if (pick.basis === 'total_only')
    notes.push(
      `Only the total invested and the first purchase date${pick.startedOn ? ` (${shortDate(pick.startedOn)})` : ''} are known, so the gain on a part sale is taken in proportion and the units come from the latest price.`,
    );
  if (lots.some((l) => l.partial))
    notes.push(
      'The last purchase is sold in part, so the gain stays inside the free allowance. The fund house sells the oldest units first, so this is exactly what is sold.',
    );
  if (lots.some((l) => l.acquiredOn < '2018-02-01'))
    notes.push(
      'Units bought before 1 Feb 2018 use the higher of what was paid and the lower of the 31 Jan 2018 price and the sale price, where that price is known.',
    );
  if (pick.lotsEstimated)
    notes.push(
      'These purchases are worked out from the monthly-investment plan and published prices, not read from a statement, so the units can be off by a little. Import a statement for exact units.',
    );
  const exact = pick.basis === 'statement';
  return {
    assetId: pick.assetId,
    fund: pick.fund,
    units: pick.units ?? 0,
    unitsText: formatUnits(pick.units ?? 0),
    scope:
      pick.fullExit || (pick.unitsHeld !== null && (pick.units ?? 0) >= pick.unitsHeld - 0.0005)
        ? 'Your whole holding'
        : pick.unitsHeld !== null
          ? `The oldest ${formatUnits(pick.units ?? 0)} of ${formatUnits(pick.unitsHeld)} units`
          : 'Part of your holding',
    worth: pick.sellAmount,
    gain: pick.estimatedGain,
    checks,
    estimated: pick.lotsEstimated,
    working: {
      basisLabel: exact
        ? 'Purchases read from your statement or transaction export (exact).'
        : pick.basis === 'estimated_lots'
          ? 'Purchases estimated from your SIP history (not exact).'
          : 'No purchase-by-purchase history (estimate).',
      exact,
      lots,
      totals: {
        cost: lots.reduce((a, l) => a + l.cost, 0) || pick.sellAmount - pick.estimatedGain,
        value: pick.sellAmount,
        gain: totalGain,
      },
      shortTermGain,
      longTermGain: totalGain - shortTermGain,
      buyBack: pick.buyBackAmount,
      costs: { stt: pick.stt, stampDuty: pick.stampDuty, exitLoad: pick.exitLoadCost },
      notes,
    },
  };
}

function notNowFor(
  f: FundView,
  today: string,
  rules: TaxRuleSet,
  marginMonths: number,
  picked: boolean,
): NotNowRow | null {
  const holding = rules.equity.holdingMonthsLong;
  const stcg = pct(rules.equity.stcgRate);
  const dates = fundDates(f, today, holding);
  const later = (f.ladder?.upcoming ?? []).slice(0, 6).map((t) => ({
    on: t.on,
    units: t.units,
    gain: t.gain,
    lots: t.lots,
  }));
  const base = {
    assetId: f.assetId,
    fund: f.fund,
    estimated: f.lotsEstimated,
    later,
  };
  const waitingUnits = f.ladder?.waiting.units ?? 0;
  const dateLines = (): DateLine[] => {
    const out: DateLine[] = [];
    if (dates.longTermOn) out.push({ text: 'Next units turn long-term on', on: dates.longTermOn });
    if (dates.loadFreeOn && f.exitLoad)
      out.push({
        text: `Exit load (${pct(f.exitLoad.pct)} for ${f.exitLoad.days} days) next ends on`,
        on: dates.loadFreeOn,
      });
    return out.sort((a, b) => a.on.localeCompare(b.on));
  };
  const okOn = f.ladder?.upcoming[0]?.on ?? null;

  if (f.status === 'waiting') {
    const ds = dateLines();
    // no lots: the first purchase decides, the same way the plan judges it
    const fallbackOn = f.startedOn
      ? [
          addMonthsIso(f.startedOn, holding + marginMonths),
          f.exitLoad ? addDaysIso(f.startedOn, f.exitLoad.days + 1) : f.startedOn,
        ]
          .sort()
          .pop()!
      : null;
    const ready = okOn ?? fallbackOn;
    const loadRunning = !!dates.loadFreeOn;
    const shortTerm = !!dates.longTermOn;
    return {
      ...base,
      kind: 'waiting',
      reason:
        waitingUnits > 0
          ? `${formatUnits(waitingUnits)} units are ${shortTerm ? `held under ${monthsText(holding)}, so a sale now is short-term and taxed at ${stcg}` : 'still inside the exit-load window'}${loadRunning && shortTerm ? ', and an exit load still applies' : ''}.`
          : `${shortTerm ? `Bought under ${monthsText(holding)} ago, so a sale now is short-term and taxed at ${stcg}` : 'The exit-load window has not ended'}${loadRunning && shortTerm ? ', and an exit load still applies' : ''}.`,
      dates: ds,
      okOn: ready,
    };
  }
  if (f.status === 'ready_not_needed')
    return {
      ...base,
      kind: 'allowance_used',
      reason:
        'Some units are ready, but this year’s free allowance is already planned for the funds above.',
      dates: [],
      okOn: null,
    };
  if (f.status === 'no_gain')
    return {
      ...base,
      kind: 'no_gain',
      reason:
        f.ladder && f.ladder.readyAtLoss.lots > 0
          ? 'The units that are ready are at a loss, so there is no gain to book. See “Losses you can book”.'
          : 'Not in profit, so there is no gain to book.',
      dates: [],
      okOn: null,
    };
  if (f.status === 'no_lots')
    return {
      ...base,
      kind: 'needs_data',
      reason:
        f.ladder && f.ladder.unknownCost.lots > 0
          ? 'Some units are from before your statement starts, so their cost is not known. Import a statement from the first investment to include this fund.'
          : f.reason,
      dates: [],
      okOn: null,
    };
  // picked funds: only list the units that are not part of today's sale
  if (picked && waitingUnits > 0) {
    const ds = dateLines();
    return {
      ...base,
      kind: 'more_later',
      reason: `${formatUnits(waitingUnits)} more units are not ready: they are held under ${monthsText(holding)} (a sale now would be short-term, taxed at ${stcg}) or still inside the exit-load window. Leave them.`,
      dates: ds,
      okOn,
    };
  }
  return null;
}

function lossRow(c: LossCandidate): LossRow {
  const loss = c.shortLoss + c.longLoss;
  const whole = c.units >= c.unitsHeld - 0.0005;
  return {
    assetId: c.assetId,
    fund: c.fund,
    units: c.units,
    unitsText: formatUnits(c.units),
    scope: whole
      ? 'Your whole holding'
      : `The oldest ${formatUnits(c.units)} of ${formatUnits(c.unitsHeld)} units`,
    worth: c.proceeds,
    loss,
    shortLoss: c.shortLoss,
    longLoss: c.longLoss,
    exitLoad: c.exitLoad,
    estimated: c.lotsEstimated,
    sentence: `Sell ${formatUnits(c.units)} units (worth about ${inr(c.proceeds)}) to book a loss of ${inr(loss)}${c.exitLoad > 0 ? `; an exit load of about ${inr(c.exitLoad)} is taken from the proceeds` : ''}.`,
    lots: c.lotDetail.map((l) => ({
      acquiredOn: l.acquiredOn,
      units: l.units,
      unitsInLot: l.units,
      partial: false,
      cost: l.cost,
      value: l.value,
      gain: l.gain,
      longTerm: l.longTerm,
    })),
  };
}

function lossSection(pl: PersonLossHarvest | undefined, rules: TaxRuleSet): LossSection {
  if (!pl || pl.candidates.length === 0)
    return {
      rows: [],
      summary:
        'No fund is at a net loss on its oldest units, so there is no loss to book right now.',
      working: [],
    };
  const rows = pl.candidates.map(lossRow);
  const summary =
    pl.taxSavedNow > 0
      ? `Booking these losses would save about ${inr(pl.taxSavedNow)} in tax this year${pl.carryForward > 0 ? `, and ${inr(pl.carryForward)} more would be carried forward to later years` : ''}.`
      : `This year it would not reduce your tax, because your gains are inside the free allowance. The loss of ${inr(pl.totalShortLoss + pl.totalLongLoss)} can be carried forward to later years if the return is filed on time.`;
  return {
    rows,
    summary,
    working: [
      `Gains already booked this year: short-term ${inr(pl.stcgYtd)}, long-term ${inr(pl.ltcgYtd)}.`,
      `Set-off order: a short-term loss meets short-term gains first (taxed at ${pct(rules.equity.stcgRate)}), then long-term gains; a long-term loss meets long-term gains only. All of this happens before the free allowance of ${inr(rules.equity.ltcgExemption)} is applied.`,
      `Tax saved this year: ${inr(pl.taxSavedNow)}. Carried forward: ${inr(pl.carryForward)}.`,
      'The fund house sells the oldest units first, so the figure for each fund is what selling that many oldest units books in total, older profitable units included.',
      ...pl.notes,
    ],
  };
}

export function harvestView(input: HarvestViewInput): HarvestView {
  const { plan, losses, today, names } = input;
  const cfg = input.config ?? DEFAULT_CONFIG.harvest;
  const rules =
    effectiveRules(today, input.rules ?? RULES)?.rules ??
    (input.rules ?? RULES)[(input.rules ?? RULES).length - 1]!;
  const daysLeft = Math.round((iso(plan.deadline) - iso(today)) / DAY);
  const orderBy = addDaysIso(plan.deadline, -cfg.orderBufferDays);
  const people: PersonView[] = plan.plans.map((pp) => {
    const name = names[pp.ownerId] ?? 'This person';
    const fundOf = new Map(pp.funds.map((f) => [f.assetId, f]));
    const sell: SellRow[] = [];
    const notNow: NotNowRow[] = [];
    for (const p of pp.picks) {
      const f = fundOf.get(p.assetId);
      if (p.units === null || !(p.units > 0)) {
        // never offer a sale without exact units
        notNow.push({
          assetId: p.assetId,
          fund: p.fund,
          kind: 'needs_data',
          reason:
            'The units to sell cannot be worked out yet because the latest price is missing. Update the fund’s price on Investments.',
          dates: [],
          okOn: null,
          later: [],
          estimated: p.lotsEstimated,
        });
        continue;
      }
      sell.push(sellRow(p, pp, today, rules, f?.sipActive ?? false));
    }
    const sellIds = new Set(sell.map((r) => r.assetId));
    const leftOut: PersonView['leftOut'] = [];
    for (const f of pp.funds) {
      if (f.status === 'excluded') {
        leftOut.push({ assetId: f.assetId, fund: f.fund, reason: f.reason });
        continue;
      }
      const row = notNowFor(f, today, rules, cfg.holdingMarginMonths, sellIds.has(f.assetId));
      if (row && !(f.status === 'picked' && !sellIds.has(f.assetId))) notNow.push(row);
    }
    // soonest first, those with no date after
    notNow.sort(
      (a, b) => (a.okOn ?? '9999').localeCompare(b.okOn ?? '9999') || a.fund.localeCompare(b.fund),
    );

    const planGain = sell.reduce((a, r) => a + r.gain, 0);
    const used = pp.alreadyUsed;
    const free = Math.max(0, pp.exemption - used - planGain);
    const costs = {
      stt: sell.reduce((a, r) => a + r.working.costs.stt, 0),
      stampDuty: sell.reduce((a, r) => a + r.working.costs.stampDuty, 0),
      exitLoad: sell.reduce((a, r) => a + r.working.costs.exitLoad, 0),
    };
    const nextOk = notNow
      .map((r) => r.okOn)
      .filter((x): x is string => !!x)
      .sort()[0];
    const headline =
      sell.length > 0
        ? `${name} can book ${inr(planGain)} of tax-free gain this year. Sell the funds below before ${fullDate(plan.deadline)}.`
        : `Nothing is ready for ${name} to sell for tax-free gain right now.`;
    const sub =
      sell.length > 0
        ? used > 0
          ? `Of the ${inr(pp.exemption)} free each year, ${inr(used)} is already used this year and ${inr(free)} would still be free after this plan.`
          : `${inr(free)} of the ${inr(pp.exemption)} free each year would still be free after this plan. Unused allowance is lost on 31 March.`
        : nextOk
          ? `The next units are ready on ${shortDate(nextOk)}. ${inr(pp.room)} of the ${inr(pp.exemption)} yearly allowance is still free.`
          : (pp.notes[0] ?? 'No fund qualifies yet.');
    const working: string[] = [];
    if (sell.length > 0) {
      working.push(
        `Free allowance: ${inr(pp.exemption)} a year per person, across all listed shares and equity funds together. ${inr(used)} already used, ${inr(planGain)} in this plan, ${inr(free)} left.`,
      );
      working.push(`Total to put back into the same funds afterwards: ${inr(pp.buyBackTotal)}.`);
      if (pp.futureTaxMayBeAvoided > 0)
        working.push(
          `Tax this can avoid later, if these gains would otherwise have been sold at a profit: about ${inr(pp.futureTaxMayBeAvoided)}.`,
        );
      if (cfg.nri && pp.tdsWithheld > 0)
        working.push(
          `Non-resident: the fund house withholds about ${inr(pp.tdsWithheld)} on these sales. It is refunded in full when you file the return, because the gains stay inside the allowance (${inr(pp.refundExpected)} expected back). Track it on the Refunds tab.`,
        );
    }
    return {
      ownerId: pp.ownerId,
      name,
      headline,
      sub,
      meter: { allowance: pp.exemption, used, plan: planGain, free },
      sell,
      notNow,
      leftOut,
      losses: lossSection(
        losses.plans.find((l) => l.ownerId === pp.ownerId),
        rules,
      ),
      working,
      costs,
    };
  });
  const costs = {
    stt: people.reduce((a, p) => a + p.costs.stt, 0),
    stampDuty: people.reduce((a, p) => a + p.costs.stampDuty, 0),
    exitLoad: people.reduce((a, p) => a + p.costs.exitLoad, 0),
    total: 0,
  };
  costs.total = costs.stt + costs.stampDuty + costs.exitLoad;
  return {
    fy: plan.fy,
    deadline: plan.deadline,
    deadlineLabel: fullDate(plan.deadline),
    daysLeft,
    people,
    costs,
    costsLine: `Costs to expect: stamp duty ${inr(costs.stampDuty)}, transaction tax (STT) ${inr(costs.stt)}, exit load ${inr(costs.exitLoad)}; ${inr(costs.total)} in all.`,
    checklist: [
      'Open the fund on your platform and choose Sell or Redeem, then pick units, not amount.',
      'Type the exact units from the list above. Check the folio and that the exit load shown is nil.',
      `Place each order by ${shortDate(orderBy)}. The last day is ${shortDate(plan.deadline)}, but an order after the cut-off time or on a holiday is priced on the next working day.`,
      'Gains on shares and ETFs use the same free allowance and are not counted here: lower the units if you have booked any this year.',
      'Keep the contract note for each sale as proof for your return.',
    ],
    orderBy,
  };
}
