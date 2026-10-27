/**
 * The "Exit load and tax" panel of one fund, as plain data: which units are still under an exit load, which are long-term and which
 * short-term, how much is at a loss, and what to sell now (if anything) to use the person's tax-free allowance. It reuses the rules
 * of the harvest engine (harvest-lots, harvest-plan) and adds none of its own: every number comes from the tax rules and the Settings
 * it is given. Pure: no database, no React.
 */
import { effectiveRules, type AppConfig } from './config';
import type { FundTaxClass } from './fund-class';
import { BEFORE_STATEMENT, type LotsBasis, type StatLot } from './fund-stats';
import { addDaysIso, lotStatus, type LotRules, type LotStatus } from './harvest-lots';
import type { FundView, HarvestPick, HarvestPlan, PersonHarvest } from './harvest-plan';
import type { LedgerStatus } from './ledger-check';
import type { TaxRuleSet } from './tax';

export type Term = 'LTCG' | 'STCG' | 'slab' | 'check' | 'older';

export interface LoadRule {
  pct: number;
  days: number;
}

export interface PanelRow {
  key: string;
  /** the purchase date; null for the units held before the first line on file */
  acquiredOn: string | null;
  beforeStatement: boolean;
  units: number;
  cost: number | null;
  value: number | null;
  gain: number | null;
  daysHeld: number | null;
  /** first day with no exit load; null when the fund has no exit-load rule */
  loadFreeOn: string | null;
  underLoad: boolean;
  /** first day a sale is long-term; null when the kind of fund has no such date */
  longTermOn: string | null;
  term: Term;
  termWords: string;
  /** the ELSS lock-in ends on this day (units cannot be sold before) */
  lockedUntil: string | null;
  estimated: boolean;
  chips: { label: string; tone: 'ok' | 'warn' | 'bad' | 'info' }[];
}

export interface PanelTotals {
  unitsUnderLoad: number;
  valueUnderLoad: number;
  unitsLoadFree: number;
  stcgUnits: number;
  stcgGain: number;
  ltcgUnits: number;
  ltcgGain: number;
  lossUnits: number;
  lossAmount: number;
  /** units whose cost is not on file, so their gain cannot be stated */
  unknownCostUnits: number;
  units: number;
}

export interface ExitLoadStatus {
  state: 'under_load' | 'none_under' | 'no_rule' | 'not_set';
  headline: string;
  detail: string | null;
  /** the fund has no exit load of its own: the page offers a link to set it */
  offerSet: boolean;
  /** last day on which a sale still pays the load; null when no unit is under it */
  until: string | null;
  rule: LoadRule | null;
  source: 'fund' | 'default' | 'none';
  loadIfSoldToday: number;
}

export interface HarvestAdvice {
  /** nothing to do now, with the reason */
  state: 'sell_now' | 'nothing' | 'not_applicable' | 'unknown';
  headline: string;
  lines: string[];
  pick: HarvestPick | null;
  /** the person's allowance for the year and what is left of it */
  allowance: { exemption: number; used: number; room: number; fy: string; deadline: string } | null;
  /** when more units of this fund become ready, soonest first */
  next: { on: string; units: number; gain: number }[];
  /** the lots behind the advice are estimated from the SIP plan, or there are none on file */
  estimated: boolean;
  caution: string | null;
}

export interface FundTaxPanel {
  taxClass: FundTaxClass;
  classLabel: string;
  classCertain: boolean;
  classNote: string;
  /** equity-oriented units can be split into short and long term and harvested */
  equity: boolean;
  basis: LotsBasis;
  /** the history under the lots is not reconciled, so the split is only as good as the ledger */
  ledgerStatus: LedgerStatus;
  estimated: boolean;
  rows: PanelRow[];
  totals: PanelTotals;
  exitLoad: ExitLoadStatus;
  harvest: HarvestAdvice;
  /** what a sale would cost: tax rates the take-out box uses */
  rates: { stcg: number; ltcg: number; cess: number; exemption: number } | null;
}

export interface FundTaxInput {
  assetId: string;
  ownerId: string;
  taxClass: FundTaxClass;
  classLabel: string;
  classCertain: boolean;
  classNote: string;
  lots: StatLot[];
  lotsBasis: LotsBasis;
  /** latest price per unit */
  nav: number | null;
  /** units held and value, to price lots when only a total is known */
  units: number | null;
  value: number;
  /** this fund's own exit load; null when none is set for it */
  exitLoad: LoadRule | null;
  lockInMonths: number;
  firstTxnOn: string | null;
  ledgerStatus: LedgerStatus;
}

export interface FundTaxContext {
  today: string;
  rules: TaxRuleSet[];
  config: Pick<
    AppConfig['harvest'],
    'exitLoadPct' | 'exitLoadDays' | 'otherLongMonths' | 'holdingMarginMonths'
  >;
  /** the plan for the person's funds (planHarvest), when the class can be harvested */
  plan: HarvestPlan | null;
  /** the place to set the fund's own exit load */
  setExitLoadHref?: string;
}

const dayDiff = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const unitsFmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const inr = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;
const pctText = (x: number) => `${Math.round(x * 10_000) / 100}%`;
const niceIso = (iso: string) => {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(iso.slice(8, 10))} ${m[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
};

/** The exit-load rule that applies to the fund: its own, else the usual one from Settings, else none. */
export function exitLoadRuleFor(
  own: LoadRule | null,
  cfg: { exitLoadPct: number; exitLoadDays: number },
): { rule: LoadRule | null; source: 'fund' | 'default' | 'none' } {
  if (own)
    return own.pct > 0 && own.days > 0
      ? { rule: own, source: 'fund' }
      : { rule: null, source: 'fund' };
  return cfg.exitLoadDays > 0 && cfg.exitLoadPct > 0
    ? { rule: { pct: cfg.exitLoadPct, days: cfg.exitLoadDays }, source: 'default' }
    : { rule: null, source: 'none' };
}

/** Months after which a sale is long-term for this kind of fund; null when the kind has no such rule (debt: slab rate). */
export function holdingMonthsFor(
  cls: FundTaxClass,
  equityMonths: number | null,
  otherLongMonths: number,
): number | null {
  if (cls === 'equity') return equityMonths;
  if (cls === 'other_long') return otherLongMonths;
  return null;
}

function termWords(t: Term, longTermOn: string | null, today: string): string {
  if (t === 'LTCG') return 'Long-term';
  if (t === 'STCG')
    return `Short-term${longTermOn ? ` until ${niceIso(addDaysIso(longTermOn, -1))}` : ''}`;
  void today;
  if (t === 'slab') return 'Taxed at your slab rate';
  if (t === 'older') return 'Age not known (bought before the first line on file)';
  return 'Check the fund’s category';
}

/** The lots of a fund, one row per purchase date, with every clock. */
function buildRows(
  lots: StatLot[],
  nav: number | null,
  fallbackUnitValue: number | null,
  input: FundTaxInput,
  ctx: FundTaxContext,
  rule: LoadRule | null,
  months: number | null,
): PanelRow[] {
  const unitValue = nav ?? fallbackUnitValue;
  const byDate = new Map<string, StatLot[]>();
  for (const l of [...lots].sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn)))
    byDate.set(l.acquiredOn, [...(byDate.get(l.acquiredOn) ?? []), l]);
  const lr: LotRules = {
    holdingMonths: months ?? 0,
    ...(rule ? { exitLoadDays: rule.days, exitLoadPct: rule.pct } : {}),
    lockInMonths: input.lockInMonths,
  };
  const rows: PanelRow[] = [];
  for (const [date, group] of byDate) {
    const before = date === BEFORE_STATEMENT || date.startsWith('0001');
    const units = group.reduce((a, l) => a + l.units, 0);
    const known = group.every((l) => l.cost !== null);
    const cost = known ? group.reduce((a, l) => a + (l.cost ?? 0), 0) : null;
    const value = unitValue !== null ? units * unitValue : null;
    const gain = value !== null && cost !== null ? value - cost : null;
    const estimated = group.some((l) => l.estimated);
    // units from before the first line are at least as old as that line
    const anchor = before ? input.firstTxnOn : date;
    const st: LotStatus | null =
      anchor && months !== null
        ? lotStatus({ acquiredOn: anchor, units, cost: cost ?? 0 }, unitValue ?? 0, lr)
        : null;
    const longTermOn = st ? st.longTermOn : null;
    const loadFreeOn = rule && anchor ? addDaysIso(anchor, rule.days + 1) : null;
    const underLoad = !before && !!loadFreeOn && loadFreeOn > ctx.today;
    const locked = !before && input.lockInMonths > 0 && st ? st.unlockedOn : null;
    let term: Term;
    if (months === null) term = input.taxClass === 'debt_slab' ? 'slab' : 'check';
    else if (longTermOn && longTermOn <= ctx.today) term = 'LTCG';
    else term = before ? 'older' : 'STCG';
    const chips: PanelRow['chips'] = [];
    if (before) chips.push({ label: 'Before the first line', tone: 'info' });
    if (rule && !before)
      chips.push(
        underLoad ? { label: 'Exit load', tone: 'warn' } : { label: 'Load-free', tone: 'ok' },
      );
    if (term === 'LTCG') chips.push({ label: before ? 'LTCG (at least)' : 'LTCG', tone: 'ok' });
    else if (term === 'STCG') chips.push({ label: 'STCG', tone: 'warn' });
    if (gain !== null && gain < 0) chips.push({ label: 'Loss', tone: 'bad' });
    if (locked && locked > ctx.today) chips.push({ label: 'Locked', tone: 'bad' });
    if (estimated) chips.push({ label: 'est.', tone: 'info' });
    rows.push({
      key: date,
      acquiredOn: before ? null : date,
      beforeStatement: before,
      units,
      cost,
      value,
      gain,
      daysHeld: before ? null : dayDiff(date, ctx.today),
      loadFreeOn: before ? null : loadFreeOn,
      underLoad,
      longTermOn,
      term,
      termWords: termWords(term, longTermOn, ctx.today),
      lockedUntil: locked,
      estimated,
      chips,
    });
  }
  return rows;
}

function totalsOf(rows: PanelRow[]): PanelTotals {
  const t: PanelTotals = {
    unitsUnderLoad: 0,
    valueUnderLoad: 0,
    unitsLoadFree: 0,
    stcgUnits: 0,
    stcgGain: 0,
    ltcgUnits: 0,
    ltcgGain: 0,
    lossUnits: 0,
    lossAmount: 0,
    unknownCostUnits: 0,
    units: 0,
  };
  for (const r of rows) {
    t.units += r.units;
    if (r.underLoad) {
      t.unitsUnderLoad += r.units;
      t.valueUnderLoad += r.value ?? 0;
    } else t.unitsLoadFree += r.units;
    if (r.gain === null) t.unknownCostUnits += r.units;
    if (r.term === 'STCG') {
      t.stcgUnits += r.units;
      t.stcgGain += r.gain ?? 0;
    } else if (r.term === 'LTCG') {
      t.ltcgUnits += r.units;
      t.ltcgGain += r.gain ?? 0;
    }
    if (r.gain !== null && r.gain < 0) {
      t.lossUnits += r.units;
      t.lossAmount += r.gain;
    }
  }
  return t;
}

function exitLoadStatus(
  rows: PanelRow[],
  totals: PanelTotals,
  rule: LoadRule | null,
  source: 'fund' | 'default' | 'none',
  ctx: FundTaxContext,
): ExitLoadStatus {
  const under = rows.filter((r) => r.underLoad);
  const until = under.reduce<string | null>((m, r) => {
    const d = r.loadFreeOn ? addDaysIso(r.loadFreeOn, -1) : null;
    return d && (m === null || d > m) ? d : m;
  }, null);
  const loadIfSoldToday = rule ? under.reduce((a, r) => a + (r.value ?? 0) * rule.pct, 0) : 0;
  const base = { rule, source, until, loadIfSoldToday, offerSet: source !== 'fund' };
  if (source === 'fund' && !rule)
    return {
      ...base,
      state: 'no_rule',
      headline: 'No exit load on any unit',
      detail: 'This fund is set to charge no exit load.',
      offerSet: false,
    };
  if (source === 'none')
    return {
      ...base,
      state: 'not_set',
      headline: 'Exit load not set for this fund',
      detail: ctx.setExitLoadHref
        ? 'No exit load is set for this fund and none is set in Settings, so none is assumed. Set it here.'
        : 'No exit load is set for this fund and none is set in Settings, so none is assumed.',
    };
  const r = rule!;
  const assumed =
    source === 'default'
      ? ` Not set for this fund: the usual ${pctText(r.pct)} for ${r.days} days from Settings is assumed.`
      : '';
  if (totals.unitsUnderLoad > 0.0005)
    return {
      ...base,
      state: 'under_load',
      headline: `Exit load applies today to ${unitsFmt(totals.unitsUnderLoad)} units (${pctText(r.pct)}) until ${niceIso(until!)}`,
      detail: `Selling them today would cost about ${inr(loadIfSoldToday)}. The other ${unitsFmt(totals.unitsLoadFree)} units are load-free.${assumed}`,
    };
  return {
    ...base,
    state: 'none_under',
    headline: 'No exit load on any unit',
    detail: `Every unit has been held longer than ${r.days} days (${pctText(r.pct)} rule).${assumed}`,
  };
}

function adviceFor(
  input: FundTaxInput,
  view: FundView | null,
  person: PersonHarvest | null,
  plan: HarvestPlan | null,
  estimated: boolean,
): HarvestAdvice {
  const na = (headline: string, lines: string[] = []): HarvestAdvice => ({
    state: 'not_applicable',
    headline,
    lines,
    pick: null,
    allowance: null,
    next: [],
    estimated,
    caution: null,
  });
  if (input.taxClass !== 'equity')
    return na(
      input.taxClass === 'debt_slab'
        ? 'Nothing to harvest: debt fund gains are taxed at your slab rate whatever the holding period.'
        : input.taxClass === 'other_long'
          ? 'Nothing to harvest: this kind of fund has no yearly tax-free allowance.'
          : 'Not worked out: the tax on this fund depends on its equity share. Check the factsheet first.',
    );
  if (!plan || plan.status !== 'ok' || !person || !view)
    return {
      ...na('The tax rules for this year are missing, so no harvest can be worked out.'),
      state: 'unknown',
    };
  const allowance = {
    exemption: person.exemption,
    used: person.alreadyUsed,
    room: person.room,
    fy: plan.fy,
    deadline: plan.deadline,
  };
  const pick = person.picks.find((p) => p.assetId === input.assetId) ?? null;
  const next = view.nextReady.slice(0, 3).map((t) => ({ on: t.on, units: t.units, gain: t.gain }));
  const caution = estimated
    ? 'These lots are estimated from the monthly investment plan or a total, not read from a statement. Import a detailed statement before selling.'
    : null;
  const lines: string[] = [];
  if (pick) {
    lines.push(
      `Sell about ${pick.units !== null ? `${unitsFmt(pick.units)} units (` : '('}${inr(pick.sellAmount)}${pick.units !== null ? ')' : ''} before ${niceIso(plan.deadline)}, oldest units first. That books about ${inr(pick.estimatedGain)} of long-term gain, inside the ${inr(person.room)} of tax-free allowance still left for ${plan.fy}.`,
    );
    lines.push(
      `Tax on that gain: ${inr(0)}. Other costs: about ${inr(pick.frictionCost)} in transaction tax and stamp duty${pick.exitLoadCost > 0 ? `, ${inr(pick.exitLoadCost)} exit load` : ', no exit load'}.${person.tdsWithheld > 0 ? ` As a non-resident about ${inr(person.tdsWithheld)} is withheld and comes back when you file.` : ''}`,
    );
    lines.push(
      `Then buy the same amount back (${inr(pick.buyBackAmount)}) so the cost of the units goes up.`,
    );
    return {
      state: 'sell_now',
      headline: `Take out about ${inr(pick.sellAmount)} this year`,
      lines,
      pick,
      allowance,
      next,
      estimated,
      caution,
    };
  }
  lines.push(view.reason);
  if (person.room < 1)
    lines.push(`Your ${inr(person.exemption)} tax-free allowance for ${plan.fy} is already used.`);
  else if (view.status === 'ready_not_needed')
    lines.push(
      `${inr(person.room)} of the allowance is left but is used by funds with smaller gains first. See the Tax page for the whole plan.`,
    );
  if (next.length > 0)
    lines.push(
      `More units become ready: ${next.map((n) => `${niceIso(n.on)} (${unitsFmt(n.units)} units, gain ${inr(n.gain)})`).join('; ')}.`,
    );
  return {
    state: 'nothing',
    headline: 'Nothing to do now',
    lines,
    pick: null,
    allowance,
    next,
    estimated,
    caution,
  };
}

export function fundTaxPanel(input: FundTaxInput, ctx: FundTaxContext): FundTaxPanel {
  const eff = effectiveRules(ctx.today, ctx.rules);
  const eq = eff?.rules.equity ?? null;
  const months = holdingMonthsFor(
    input.taxClass,
    eq?.holdingMonthsLong ?? null,
    ctx.config.otherLongMonths,
  );
  const { rule, source } = exitLoadRuleFor(input.exitLoad, ctx.config);
  const fallbackUnit = input.units && input.units > 0 ? input.value / input.units : null;
  const rows = buildRows(input.lots, input.nav, fallbackUnit, input, ctx, rule, months);
  const totals = totalsOf(rows);
  const person = ctx.plan?.plans.find((p) => p.ownerId === input.ownerId) ?? null;
  const view = person?.funds.find((f) => f.assetId === input.assetId) ?? null;
  const estimated = input.lotsBasis === 'estimated' || input.lotsBasis === 'none';
  return {
    taxClass: input.taxClass,
    classLabel: input.classLabel,
    classCertain: input.classCertain,
    classNote: input.classNote,
    equity: input.taxClass === 'equity',
    basis: input.lotsBasis,
    ledgerStatus: input.ledgerStatus,
    estimated: estimated || input.ledgerStatus !== 'complete',
    rows,
    totals,
    exitLoad: exitLoadStatus(rows, totals, rule, source, ctx),
    harvest: adviceFor(input, view, person, ctx.plan, estimated),
    rates: eff
      ? {
          stcg: eff.rules.equity.stcgRate,
          ltcg: eff.rules.equity.ltcgRate,
          cess: eff.rules.cess,
          exemption: eff.rules.equity.ltcgExemption,
        }
      : null,
  };
}

// ------------------------------------------------------------------------------------------------
// How much to take out for a given amount
// ------------------------------------------------------------------------------------------------
export interface TakeOutPiece {
  acquiredOn: string | null;
  units: number;
  value: number;
  gain: number | null;
  term: Term;
  underLoad: boolean;
}

export interface TakeOut {
  /** the amount asked for, and what the units chosen are worth */
  asked: number;
  proceeds: number;
  units: number;
  pieces: TakeOutPiece[];
  exitLoad: number;
  stcgGain: number;
  ltcgGain: number;
  /** tax on the gains after the tax-free allowance left (rounded up to the rupee) */
  tax: number;
  /** units still under an exit load are among those sold */
  includesLoadUnits: boolean;
  /** the amount is more than the fund holds, so everything is listed */
  allOfIt: boolean;
  /** units with no known cost are among those sold: their gain is not counted */
  unknownCost: boolean;
}

/**
 * The units to sell to take out `amount` rupees. Units are redeemed oldest first, which is also the order in which they leave the
 * exit load and turn long-term, so the oldest load-free long-term units go first. Gains are counted by term; the tax is the
 * short-term gain at its rate plus the long-term gain above `room` at its rate, with the cess.
 */
export function takeOutFor(args: {
  rows: PanelRow[];
  amount: number;
  exitLoad: LoadRule | null;
  rates: { stcg: number; ltcg: number; cess: number } | null;
  /** the tax-free long-term gain still left this year */
  room: number;
}): TakeOut | null {
  if (!(args.amount > 0)) return null;
  const rows = args.rows.filter((r) => r.value !== null && r.value > 0);
  let left = args.amount;
  const pieces: TakeOutPiece[] = [];
  for (const r of rows) {
    if (left <= 0.005) break;
    const f = Math.min(1, left / r.value!);
    pieces.push({
      acquiredOn: r.acquiredOn,
      units: r.units * f,
      value: r.value! * f,
      gain: r.gain === null ? null : r.gain * f,
      term: r.term,
      underLoad: r.underLoad,
    });
    left -= r.value! * f;
  }
  const proceeds = pieces.reduce((a, p) => a + p.value, 0);
  const stcg = pieces.filter((p) => p.term === 'STCG').reduce((a, p) => a + (p.gain ?? 0), 0);
  const ltcg = pieces.filter((p) => p.term === 'LTCG').reduce((a, p) => a + (p.gain ?? 0), 0);
  const load = args.exitLoad
    ? pieces.filter((p) => p.underLoad).reduce((a, p) => a + p.value * args.exitLoad!.pct, 0)
    : 0;
  const k = args.rates ? 1 + args.rates.cess : 1;
  const tax = args.rates
    ? Math.ceil(
        Math.max(0, stcg) * args.rates.stcg * k +
          Math.max(0, ltcg - Math.max(0, args.room)) * args.rates.ltcg * k,
      )
    : 0;
  return {
    asked: args.amount,
    proceeds,
    units: pieces.reduce((a, p) => a + p.units, 0),
    pieces,
    exitLoad: load,
    stcgGain: stcg,
    ltcgGain: ltcg,
    tax: Math.max(0, tax),
    includesLoadUnits: pieces.some((p) => p.underLoad),
    allOfIt: left > 0.5,
    unknownCost: pieces.some((p) => p.gain === null),
  };
}
