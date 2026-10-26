/**
 * Indian mutual-fund capital-gains engine (equity-oriented funds), lot by lot, one taxpayer at a time.
 *
 * Design rules
 *  - Tax rules are DATA with an effective period, a verification status and sources. No rate is hard-coded in logic.
 *  - A ledger belongs to ONE taxpayer (PAN). Lots from two owners can never be mixed, exemptions and losses never move across owners.
 *  - Units are redeemed FIFO (the default for mutual-fund units), so the lots touched are the oldest ones.
 *  - Exit load is charged per lot on the units redeemed within the load period of THAT lot's purchase date.
 *  - Unsupported situations (debt funds taxed at slab, missing year of rules) return an explicit status; they never return a quiet 0.
 *  - This is decision support, not tax advice.
 */

export type FundClass = 'equity' | 'debt_specified' | 'other';

export interface EquityRule {
  /** held MORE than this many months => long term */
  holdingMonthsLong: number;
  stcgRate: number;
  ltcgRate: number;
  /** per taxpayer, per financial year, on long-term equity gains */
  ltcgExemption: number;
}

export interface TaxRuleSet {
  fy: string; // '2026-27'
  from: string; // first day, YYYY-MM-DD
  to: string; // last day
  equity: EquityRule;
  /** health and education cess on tax */
  cess: number;
  verification: 'primary' | 'secondary_sources' | 'unverified';
  sources: { title: string; url: string }[];
  notes: string[];
}

export const RULES: TaxRuleSet[] = [
  {
    fy: '2025-26',
    from: '2025-04-01',
    to: '2026-03-31',
    equity: { holdingMonthsLong: 12, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemption: 125_000 },
    cess: 0.04,
    verification: 'secondary_sources',
    sources: [
      {
        title: 'Outlook Money tax reckoner 2026-27 (secondary source)',
        url: 'https://www.outlookmoney.com/invest/tax-reckoner-2026-27-how-mutual-fund-investments-will-be-taxed-after-budget',
      },
    ],
    notes: [
      'Rates for gains on or after 23 Jul 2024. Confirm against the Income Tax Department before filing.',
    ],
  },
  {
    fy: '2026-27',
    from: '2026-04-01',
    to: '2027-03-31',
    equity: { holdingMonthsLong: 12, stcgRate: 0.2, ltcgRate: 0.125, ltcgExemption: 125_000 },
    cess: 0.04,
    verification: 'secondary_sources',
    sources: [
      {
        title: 'Outlook Money tax reckoner 2026-27 (secondary source)',
        url: 'https://www.outlookmoney.com/invest/tax-reckoner-2026-27-how-mutual-fund-investments-will-be-taxed-after-budget',
      },
      {
        title: 'HSBC Mutual Fund tax reckoner FY 2026-27',
        url: 'https://www.assetmanagement.hsbc.co.in/assets/documents/mutual-funds/en/da5d1d18-343c-41d2-aaf9-e6967d009ee8/tax-reckoner-fy-2026-2027.pdf',
      },
    ],
    notes: [
      'Budget 2026 reported as leaving equity fund capital-gains rates unchanged. The Income Tax Act, 2025 applies from 1 Apr 2026 with new section numbers.',
      'Confirm against the Income Tax Department / official notifications before relying on these numbers.',
    ],
  },
];

export const fyOf = (date: string): string => {
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7));
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
};

export function rulesFor(date: string, rules: TaxRuleSet[] = RULES): TaxRuleSet | null {
  return effectiveRules(date, rules)?.rules ?? null;
}

/** "2027-28" -> first and last day of that financial year. */
export function fyBoundsOf(fy: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fy);
  if (!m) return null;
  const y = Number(m[1]);
  if (Number(m[2]) !== (y + 1) % 100) return null;
  return { from: `${y}-04-01`, to: `${y + 1}-03-31` };
}

export interface EffectiveRules {
  rules: TaxRuleSet;
  /** no rule exists for that year; the latest earlier year is assumed to still apply */
  carriedForward: boolean;
}

/**
 * The rule for a date. When the year has no rules yet, the most recent earlier year is used and flagged, so planning never stops
 * because a new financial year began; the screen tells you to confirm the numbers in Settings.
 */
export function effectiveRules(date: string, rules: TaxRuleSet[] = RULES): EffectiveRules | null {
  const exact = rules.find((r) => date >= r.from && date <= r.to);
  if (exact) return { rules: exact, carriedForward: false };
  const earlier = [...rules].filter((r) => r.to < date).sort((a, b) => b.to.localeCompare(a.to))[0];
  if (!earlier) return null;
  const b = fyBoundsOf(fyOf(date));
  return {
    rules: {
      ...earlier,
      fy: fyOf(date),
      from: b?.from ?? earlier.from,
      to: b?.to ?? earlier.to,
      verification: 'unverified',
      notes: [`Assumed unchanged from ${earlier.fy}. Confirm in Settings.`],
    },
    carriedForward: true,
  };
}

// -------------------------------------------------------------------------------------------------
// Lots
// -------------------------------------------------------------------------------------------------
export interface Lot {
  lotId: string;
  schemeId: string;
  ownerId: string;
  fundClass: FundClass;
  acquiredOn: string;
  /** units still held */
  units: number;
  /** acquisition cost per unit (as it will be reported) */
  costPerUnit: number;
  /** NAV on 31 Jan 2018, only for units bought on/before that date (grandfathering) */
  fmv20180131PerUnit?: number;
}

export interface ExitLoadRule {
  /** charged when the lot is younger than this many days at redemption */
  days: number;
  rate: number;
}

export interface Ledger {
  /** net short-term gains already realised this FY by this taxpayer (negative = loss) */
  stcgYtd: number;
  /** net long-term gains already realised this FY (negative = loss) */
  ltcgYtd: number;
  /** unabsorbed losses brought forward (positive numbers) */
  carryStcl: number;
  carryLtcl: number;
}

export const EMPTY_LEDGER: Ledger = { stcgYtd: 0, ltcgYtd: 0, carryStcl: 0, carryLtcl: 0 };

export interface Position {
  stcgNet: number;
  ltcgNet: number;
  exemptionUsed: number;
  exemptionLeft: number;
  taxableStcg: number;
  taxableLtcg: number;
  tax: number;
  lossCarriedOut: { stcl: number; ltcl: number };
}

function addMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(d, last));
  return t.toISOString().slice(0, 10);
}

export const isLongTerm = (lot: Pick<Lot, 'acquiredOn'>, saleDate: string, rule: EquityRule) =>
  saleDate > addMonths(lot.acquiredOn, rule.holdingMonthsLong);

/**
 * Tax for one taxpayer for one FY from realised totals.
 *  - a short-term loss may be set off against short- and long-term gains; a long-term loss only against long-term gains
 *  - brought-forward losses are applied after current-year set-off, in the same way
 *  - the long-term exemption applies after loss set-off; for an NRI the basic exemption limit is not available
 *  - `surcharge` (a fraction of tax) depends on total income; supply it, otherwise 0 is used and stated
 */
export function computePosition(
  stcg: number,
  ltcg: number,
  carry: { stcl: number; ltcl: number },
  rule: EquityRule,
  cess: number,
  surcharge = 0,
): Position {
  let st = stcg;
  let lt = ltcg;
  let cStcl = carry.stcl;
  let cLtcl = carry.ltcl;
  if (st < 0 && lt > 0) {
    const use = Math.min(-st, lt);
    st += use;
    lt -= use;
  }
  if (st > 0 && cStcl > 0) {
    const use = Math.min(st, cStcl);
    st -= use;
    cStcl -= use;
  }
  if (lt > 0 && cStcl > 0) {
    const use = Math.min(lt, cStcl);
    lt -= use;
    cStcl -= use;
  }
  if (lt > 0 && cLtcl > 0) {
    const use = Math.min(lt, cLtcl);
    lt -= use;
    cLtcl -= use;
  }
  const exemptionUsed = Math.min(Math.max(lt, 0), rule.ltcgExemption);
  const taxableLtcg = Math.max(0, lt - rule.ltcgExemption);
  const taxableStcg = Math.max(0, st);
  const tax =
    (taxableStcg * rule.stcgRate + taxableLtcg * rule.ltcgRate) * (1 + surcharge) * (1 + cess);
  return {
    stcgNet: st,
    ltcgNet: lt,
    exemptionUsed,
    exemptionLeft: rule.ltcgExemption - exemptionUsed,
    taxableStcg,
    taxableLtcg,
    tax,
    lossCarriedOut: { stcl: Math.max(0, -st) + cStcl, ltcl: Math.max(0, -lt) + cLtcl },
  };
}

// -------------------------------------------------------------------------------------------------
// Redemption simulation
// -------------------------------------------------------------------------------------------------
export interface Slice {
  lotId: string;
  units: number;
  acquiredOn: string;
  term: 'long' | 'short';
  proceeds: number;
  exitLoad: number;
  cost: number;
  gain: number;
}

export interface SimulationInput {
  lots: Lot[];
  /** redeem this many units (FIFO)... */
  units?: number;
  /** ...or this much money (before exit load) */
  amount?: number;
  nav: number;
  saleDate: string;
  exitLoad?: ExitLoadRule | null;
  ledger?: Ledger;
  /** NRI: the fund house deducts tax at source on the gain */
  tdsApplies?: boolean;
  surcharge?: number;
  rules?: TaxRuleSet[];
}

export type SimulationStatus =
  'ok' | 'rules_missing' | 'insufficient_units' | 'not_modelled' | 'invalid_input';

export interface SimulationResult {
  status: SimulationStatus;
  message: string;
  rules: TaxRuleSet | null;
  units: number;
  slices: Slice[];
  gross: number;
  exitLoad: number;
  netProceeds: number;
  stcg: number;
  ltcg: number;
  before: Position | null;
  after: Position | null;
  /** extra tax caused by this redemption (what you would owe when you file) */
  incrementalTax: number;
  /** tax the fund house is expected to deduct now (NRI) */
  tdsEstimate: number;
  /** TDS minus tax actually due: what a filed return should bring back */
  refundExpected: number;
  unitsLeft: number;
  assumptions: string[];
}

const fail = (
  status: SimulationStatus,
  message: string,
  rules: TaxRuleSet | null = null,
): SimulationResult => ({
  status,
  message,
  rules,
  units: 0,
  slices: [],
  gross: 0,
  exitLoad: 0,
  netProceeds: 0,
  stcg: 0,
  ltcg: 0,
  before: null,
  after: null,
  incrementalTax: 0,
  tdsEstimate: 0,
  refundExpected: 0,
  unitsLeft: 0,
  assumptions: [],
});

export function simulateRedemption(input: SimulationInput): SimulationResult {
  const { lots, nav, saleDate } = input;
  if (!(nav > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(saleDate))
    return fail('invalid_input', 'NAV must be positive and the sale date must be YYYY-MM-DD.');
  if (input.units === undefined && input.amount === undefined)
    return fail('invalid_input', 'Say how many units or how much money to redeem.');
  const owners = new Set(lots.map((l) => l.ownerId));
  if (owners.size > 1)
    throw new Error('lots from different taxpayers cannot be combined in one redemption');
  const classes = new Set(lots.map((l) => l.fundClass));
  const rules = rulesFor(saleDate, input.rules);
  if (!rules)
    return fail(
      'rules_missing',
      `No tax rules are loaded for ${fyOf(saleDate)}. Add and verify them before simulating.`,
    );
  if (classes.size > 1 || (lots[0] && lots[0].fundClass !== 'equity')) {
    return fail(
      'not_modelled',
      'Only equity-oriented funds are modelled. Debt and hybrid funds are taxed differently (often at your slab rate) and are not simulated.',
      rules,
    );
  }
  const ledger = input.ledger ?? EMPTY_LEDGER;
  const ordered = [...lots]
    .filter((l) => l.units > 0)
    .sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn) || a.lotId.localeCompare(b.lotId));
  const held = ordered.reduce((s, l) => s + l.units, 0);
  const wanted = input.units ?? (input.amount as number) / nav;
  if (!(wanted > 0)) return fail('invalid_input', 'Redemption size must be positive.', rules);
  if (wanted > held + 1e-9)
    return fail(
      'insufficient_units',
      `You hold ${held.toFixed(3)} units but asked to redeem ${wanted.toFixed(3)}.`,
      rules,
    );

  let left = wanted;
  const slices: Slice[] = [];
  for (const lot of ordered) {
    if (left <= 1e-12) break;
    const u = Math.min(lot.units, left);
    left -= u;
    const proceeds = u * nav;
    const young = input.exitLoad
      ? (Date.parse(saleDate) - Date.parse(lot.acquiredOn)) / 86_400_000 < input.exitLoad.days
      : false;
    const load = young && input.exitLoad ? proceeds * input.exitLoad.rate : 0;
    let costPerUnit = lot.costPerUnit;
    if (lot.fmv20180131PerUnit !== undefined && lot.acquiredOn <= '2018-01-31') {
      // grandfathering: cost = higher of actual cost and the lower of (value on 31 Jan 2018, sale value)
      costPerUnit = Math.max(lot.costPerUnit, Math.min(lot.fmv20180131PerUnit, nav));
    }
    const cost = u * costPerUnit;
    slices.push({
      lotId: lot.lotId,
      units: u,
      acquiredOn: lot.acquiredOn,
      term: isLongTerm(lot, saleDate, rules.equity) ? 'long' : 'short',
      proceeds,
      exitLoad: load,
      cost,
      gain: proceeds - load - cost,
    });
  }
  const gross = slices.reduce((s, x) => s + x.proceeds, 0);
  const exitLoad = slices.reduce((s, x) => s + x.exitLoad, 0);
  const stcg = slices.filter((s) => s.term === 'short').reduce((s, x) => s + x.gain, 0);
  const ltcg = slices.filter((s) => s.term === 'long').reduce((s, x) => s + x.gain, 0);
  const carry = { stcl: ledger.carryStcl, ltcl: ledger.carryLtcl };
  const before = computePosition(
    ledger.stcgYtd,
    ledger.ltcgYtd,
    carry,
    rules.equity,
    rules.cess,
    input.surcharge ?? 0,
  );
  const after = computePosition(
    ledger.stcgYtd + stcg,
    ledger.ltcgYtd + ltcg,
    carry,
    rules.equity,
    rules.cess,
    input.surcharge ?? 0,
  );
  const incrementalTax = after.tax - before.tax;
  // Fund house TDS for a non-resident: on the gain of this transaction, no exemption, no loss set-off.
  const tds = input.tdsApplies
    ? (Math.max(0, stcg) * rules.equity.stcgRate + Math.max(0, ltcg) * rules.equity.ltcgRate) *
      (1 + (input.surcharge ?? 0)) *
      (1 + rules.cess)
    : 0;
  return {
    status: 'ok',
    message: 'ok',
    rules,
    units: wanted,
    slices,
    gross,
    exitLoad,
    netProceeds: gross - exitLoad - tds,
    stcg,
    ltcg,
    before,
    after,
    incrementalTax,
    tdsEstimate: tds,
    refundExpected: input.tdsApplies ? tds - incrementalTax : 0,
    unitsLeft: held - wanted,
    assumptions: [
      `Rules for FY ${rules.fy} (${rules.verification === 'primary' ? 'verified' : 'NOT yet verified against official sources'}).`,
      'Units are redeemed oldest first (FIFO).',
      (input.surcharge ?? 0) > 0
        ? `Surcharge of ${(input.surcharge! * 100).toFixed(0)}% applied.`
        : 'Surcharge not included; it depends on your total income.',
      'Gains of other funds and other brokers are included only through the ledger you supply.',
      input.tdsApplies
        ? 'Tax deducted at source is estimated on this transaction alone; any refund needs a filed return.'
        : 'No tax deducted at source assumed.',
    ],
  };
}

// -------------------------------------------------------------------------------------------------
// Harvest suggestion
// -------------------------------------------------------------------------------------------------
export interface HarvestSuggestion {
  status: 'ok' | 'nothing_to_harvest' | SimulationStatus;
  message: string;
  units: number;
  result: SimulationResult | null;
  exemptionLeft: number;
  /** long-term gain that would be "reset" into a higher cost basis */
  gainRealised: number;
  /** hypothetical: tax you might avoid later if you had to pay 12.5% on this gain; not a promise */
  futureTaxMayBeAvoided: number;
  costOfActing: { exitLoad: number; tdsTiedUpUntilRefund: number };
  tradeOffs: string[];
}

/**
 * Largest number of FIFO units whose realised long-term gain stays inside the remaining tax-free allowance for this taxpayer.
 * Stops at the first short-term lot. It only suggests; the caller decides and nothing is traded.
 */
export function suggestHarvest(
  input: Omit<SimulationInput, 'units' | 'amount'>,
): HarvestSuggestion {
  const base = (status: HarvestSuggestion['status'], message: string): HarvestSuggestion => ({
    status,
    message,
    units: 0,
    result: null,
    exemptionLeft: 0,
    gainRealised: 0,
    futureTaxMayBeAvoided: 0,
    costOfActing: { exitLoad: 0, tdsTiedUpUntilRefund: 0 },
    tradeOffs: [],
  });
  const rules = rulesFor(input.saleDate, input.rules);
  if (!rules) return base('rules_missing', `No tax rules are loaded for ${fyOf(input.saleDate)}.`);
  const ordered = [...input.lots]
    .filter((l) => l.units > 0)
    .sort((a, b) => a.acquiredOn.localeCompare(b.acquiredOn));
  let ltUnits = 0;
  for (const l of ordered) {
    if (!isLongTerm(l, input.saleDate, rules.equity)) break;
    ltUnits += l.units;
  }
  if (ltUnits <= 0)
    return base(
      'nothing_to_harvest',
      'No long-term units are held yet, so there is no tax-free long-term gain to realise.',
    );
  const free = (u: number) => simulateRedemption({ ...input, units: u });
  const probe = free(ltUnits);
  if (probe.status !== 'ok') return base(probe.status, probe.message);
  const within = (r: SimulationResult) =>
    r.incrementalTax <= 0.005 && r.slices.every((s) => s.term === 'long');
  let units = ltUnits;
  if (!within(probe)) {
    let lo = 0;
    let hi = ltUnits;
    for (let i = 0; i < 80 && hi - lo > 1e-6; i++) {
      const mid = (lo + hi) / 2;
      if (within(free(mid))) lo = mid;
      else hi = mid;
    }
    units = lo;
  }
  if (units <= 1e-6)
    return base(
      'nothing_to_harvest',
      'The remaining tax-free allowance is already used or the gains are losses.',
    );
  const r = free(units);
  const gain = r.ltcg;
  if (gain < 1)
    return base(
      'nothing_to_harvest',
      'There is no meaningful tax-free gain to realise (the allowance is used up, or these units are at a loss or break-even).',
    );
  return {
    status: 'ok',
    message: 'ok',
    units,
    result: r,
    exemptionLeft: r.after ? r.after.exemptionLeft : 0,
    gainRealised: gain,
    futureTaxMayBeAvoided: gain * rules.equity.ltcgRate * (1 + rules.cess),
    costOfActing: { exitLoad: r.exitLoad, tdsTiedUpUntilRefund: r.tdsEstimate },
    tradeOffs: [
      'Selling and buying back resets the cost to today’s price; it only helps if you would otherwise pay tax on this gain later.',
      'There is a gap between selling and buying back, and the price can move against you in that gap.',
      input.tdsApplies
        ? 'As a non-resident, tax is deducted on the whole gain now; the saving arrives only after you file a return and the refund is processed.'
        : 'No tax is deducted now.',
      'Exit load, bid/offer differences and any new lock-in or exit-load clock on the repurchased units are real costs.',
      'Using the allowance does not carry forward: it resets each financial year, so unused allowance is lost, but that alone is not a reason to sell.',
    ],
  };
}
