/**
 * Estimated CURRENT value of an asset, rolled forward from its last verified observation.
 *
 *   current estimate = last verified amount (anchor)
 *                    + interest accrued since the anchor date   (FDs, savings)
 *                    + market gain/loss since the anchor date   (mutual funds, stocks via NAV/price)
 *                    + currency movement since the anchor date  (S$ balances)
 *
 * Rules:
 *  - The anchor is never overwritten; the estimate is shown beside it with its components.
 *  - `basis` says how much to trust the number:
 *      calculated      exact from contract terms or units x NAV (e.g. FD accrual, units known)
 *      estimated       modelled (e.g. savings interest on an assumed rate, NAV-ratio roll-forward)
 *      carried_forward no model available; last verified value repeated
 *  - A new verified observation replaces the anchor and the estimate restarts from it.
 */
import { daysBetween, fdValueOn, type Compounding } from './fd';

export type ComponentKind = 'interest' | 'market' | 'fx' | 'contribution';
export type Basis = 'calculated' | 'estimated' | 'carried_forward';

export interface EstimateComponent {
  kind: ComponentKind;
  amount: number; // INR, signed
  note: string;
}

export interface CurrentValueEstimate {
  anchorAmount: number;
  anchorAsOf: Date;
  estimatedAmount: number;
  estimatedOn: Date;
  ageDays: number;
  components: EstimateComponent[];
  basis: Basis;
  method: string;
}

function build(
  anchorAmount: number,
  anchorAsOf: Date,
  today: Date,
  components: EstimateComponent[],
  basis: Basis,
  method: string,
): CurrentValueEstimate {
  const delta = components.reduce((s, c) => s + c.amount, 0);
  return {
    anchorAmount,
    anchorAsOf,
    estimatedAmount: anchorAmount + delta,
    estimatedOn: today,
    ageDays: Math.max(0, daysBetween(anchorAsOf, today)),
    components,
    basis,
    method,
  };
}

function assertFinite(label: string, v: number) {
  if (!Number.isFinite(v)) throw new RangeError(`${label} must be a finite number`);
}

/** FD: principal accrued on the contract terms (not an estimate of the bank's figure, a calculation). */
export function estimateFd(args: {
  principal: number;
  annualRate: number;
  bookedOn: Date;
  today: Date;
  maturityOn?: Date;
  compounding?: Compounding;
}): CurrentValueEstimate {
  const value = fdValueOn({
    principal: args.principal,
    annualRate: args.annualRate,
    bookedOn: args.bookedOn,
    asOf: args.today,
    ...(args.maturityOn ? { maturityOn: args.maturityOn } : {}),
    ...(args.compounding ? { compounding: args.compounding } : {}),
  });
  return build(
    args.principal,
    args.bookedOn,
    args.today,
    [{ kind: 'interest', amount: value - args.principal, note: 'Accrued on contract terms' }],
    'calculated',
    'fd_accrual',
  );
}

/**
 * Savings / current account: last verified balance plus interest accrued since that date at the
 * account's rate, optionally reduced by TDS. Interest is usually credited quarterly, so this is an
 * estimate until the next verified balance arrives.
 */
export function estimateSavings(args: {
  balance: number;
  balanceAsOf: Date;
  today: Date;
  annualRate: number;
  tdsRate?: number;
}): CurrentValueEstimate {
  assertFinite('balance', args.balance);
  if (!(args.annualRate >= 0)) throw new RangeError('annualRate must be non-negative');
  const tds = args.tdsRate ?? 0;
  if (!(tds >= 0 && tds < 1)) throw new RangeError('tdsRate must be in [0, 1)');
  const days = Math.max(0, daysBetween(args.balanceAsOf, args.today));
  const gross = (args.balance * args.annualRate * days) / 365;
  const net = gross * (1 - tds);
  const comps: EstimateComponent[] = [
    {
      kind: 'interest',
      amount: net,
      note: `${days} days at ${(args.annualRate * 100).toFixed(2)}%${tds ? ` less ${(tds * 100).toFixed(1)}% TDS` : ''}`,
    },
  ];
  return build(args.balance, args.balanceAsOf, args.today, comps, 'estimated', 'savings_interest');
}

/** Fund with known units: units x latest NAV (exact for the NAV date). */
export function estimateFundByUnits(args: {
  units: number;
  navToday: number;
  anchorAmount: number;
  anchorAsOf: Date;
  today: Date;
}): CurrentValueEstimate {
  assertFinite('units', args.units);
  if (!(args.navToday > 0)) throw new RangeError('navToday must be positive');
  const value = args.units * args.navToday;
  return build(
    args.anchorAmount,
    args.anchorAsOf,
    args.today,
    [{ kind: 'market', amount: value - args.anchorAmount, note: 'Units x latest NAV' }],
    'calculated',
    'units_x_nav',
  );
}

/**
 * Fund without unit data (e.g. an opening value copied from a spreadsheet): scale the anchor value
 * by NAV movement since the anchor date. Assumes no purchases/redemptions in between, so it is an estimate.
 */
export function estimateFundByNavRatio(args: {
  anchorAmount: number;
  anchorAsOf: Date;
  navAtAnchor: number | null;
  navToday: number | null;
  today: Date;
}): CurrentValueEstimate {
  if (!args.navAtAnchor || !args.navToday || args.navAtAnchor <= 0 || args.navToday <= 0) {
    return build(
      args.anchorAmount,
      args.anchorAsOf,
      args.today,
      [],
      'carried_forward',
      'carry_forward',
    );
  }
  const value = (args.anchorAmount * args.navToday) / args.navAtAnchor;
  return build(
    args.anchorAmount,
    args.anchorAsOf,
    args.today,
    [{ kind: 'market', amount: value - args.anchorAmount, note: 'NAV change since anchor date' }],
    'estimated',
    'nav_ratio',
  );
}

export interface SipPlan {
  monthly: number;
  /** first instalment date (YYYY-MM-DD); its day of month is the debit day */
  startedOn: string;
  stopped: boolean;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** Instalment dates strictly after `after` and on or before `until`, one per month on the SIP's debit day. */
export function sipDates(startedOn: string, after: Date, until: Date): string[] {
  const start = new Date(`${startedOn}T00:00:00Z`);
  if (Number.isNaN(start.getTime())) return [];
  const day = start.getUTCDate();
  const out: string[] = [];
  let y = start.getUTCFullYear();
  let m = start.getUTCMonth();
  for (let guard = 0; guard < 1200; guard++) {
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const d = new Date(Date.UTC(y, m, Math.min(day, last)));
    if (d > until) break;
    if (d > after) out.push(iso(d));
    m++;
    if (m > 11) {
      m = 0;
      y++;
    }
  }
  return out;
}

/**
 * Fund without unit data but with an active SIP: roll the last recorded value forward by NAV movement, then add
 * every SIP instalment due since that date, each valued at today's NAV relative to the NAV on its debit date.
 * Still an estimate: it assumes every instalment was debited on its due date and nothing else was bought or sold.
 */
export function estimateFundWithSip(args: {
  anchorAmount: number;
  anchorAsOf: Date;
  navAtAnchor: number | null;
  navToday: number | null;
  navOn: (date: string) => number | null;
  sip: SipPlan | null;
  today: Date;
}): CurrentValueEstimate {
  const base = estimateFundByNavRatio(args);
  if (base.basis !== 'estimated' || !args.sip || args.sip.stopped || !(args.sip.monthly > 0))
    return base;
  const dates = sipDates(args.sip.startedOn, args.anchorAsOf, args.today);
  if (dates.length === 0) return base;
  const navToday = args.navToday as number;
  let invested = 0;
  let worth = 0;
  for (const d of dates) {
    const n = args.navOn(d);
    invested += args.sip.monthly;
    worth += n && n > 0 ? (args.sip.monthly * navToday) / n : args.sip.monthly;
  }
  const components: EstimateComponent[] = [
    ...base.components,
    {
      kind: 'contribution',
      amount: invested,
      note: `${dates.length} SIP instalment${dates.length === 1 ? '' : 's'} of ₹${args.sip.monthly.toLocaleString('en-IN')} since the last recorded value`,
    },
    { kind: 'market', amount: worth - invested, note: 'NAV change on those instalments' },
  ];
  return build(
    args.anchorAmount,
    args.anchorAsOf,
    args.today,
    components,
    'estimated',
    'nav_ratio_sip',
  );
}

/**
 * Fund whose units are known: today's value is units x today's NAV (the live feed), plus the units any SIP instalment since the
 * units were counted would have bought. Exact when no instalment is assumed; an estimate only for the assumed instalments.
 * A fund statement (or the monthly update) replaces the units and the estimate restarts from there.
 */
export function estimateFundUnitsWithSip(args: {
  units: number;
  unitsAsOf: Date;
  /** the latest recorded value, kept as the anchor so the change since then is visible */
  anchorAmount: number;
  anchorAsOf: Date;
  navToday: number;
  navOn: (date: string) => number | null;
  sip: SipPlan | null;
  today: Date;
}): CurrentValueEstimate {
  assertFinite('units', args.units);
  const held = args.units * args.navToday;
  const components: EstimateComponent[] = [
    {
      kind: 'market',
      amount: held - args.anchorAmount,
      note: `${args.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units at today's price`,
    },
  ];
  let assumed = false;
  if (args.sip && !args.sip.stopped && args.sip.monthly > 0) {
    const dates = sipDates(args.sip.startedOn, args.unitsAsOf, args.today);
    if (dates.length > 0) {
      assumed = true;
      let invested = 0;
      let worth = 0;
      for (const d of dates) {
        const n = args.navOn(d);
        invested += args.sip.monthly;
        worth += n && n > 0 ? (args.sip.monthly * args.navToday) / n : args.sip.monthly;
      }
      components.push(
        {
          kind: 'contribution',
          amount: invested,
          note: `${dates.length} SIP instalment${dates.length === 1 ? '' : 's'} of ₹${args.sip.monthly.toLocaleString('en-IN')} since the units were counted`,
        },
        { kind: 'market', amount: worth - invested, note: 'NAV change on those instalments' },
      );
    }
  }
  return build(
    args.anchorAmount,
    args.anchorAsOf,
    args.today,
    components,
    assumed ? 'estimated' : 'calculated',
    assumed ? 'units_nav_sip' : 'units_nav',
  );
}

/** Foreign-currency balance (e.g. S$): native amount valued at today's rate versus the anchor rate. */
export function estimateForeign(args: {
  nativeAmount: number;
  anchorRate: number; // INR per unit when the balance was verified
  anchorAsOf: Date;
  rateToday: number;
  today: Date;
}): CurrentValueEstimate {
  if (!(args.anchorRate > 0) || !(args.rateToday > 0))
    throw new RangeError('FX rates must be positive');
  const anchor = args.nativeAmount * args.anchorRate;
  const now = args.nativeAmount * args.rateToday;
  return build(
    anchor,
    args.anchorAsOf,
    args.today,
    [{ kind: 'fx', amount: now - anchor, note: 'Currency movement on unchanged balance' }],
    'calculated',
    'fx',
  );
}

/** No model available (property, receivables, policies): last verified value repeated and labelled. */
export function carryForward(args: {
  amount: number;
  asOf: Date;
  today: Date;
}): CurrentValueEstimate {
  return build(args.amount, args.asOf, args.today, [], 'carried_forward', 'carry_forward');
}

export interface EstimateTotals {
  anchorTotal: number;
  estimatedTotal: number;
  interest: number;
  market: number;
  fx: number;
  /** SIP instalments assumed invested since each fund's last recorded value */
  contribution: number;
  byBasis: Record<Basis, number>;
}

/** Aggregate many estimates and show how much of the change is interest, market and FX. */
export function sumEstimates(items: CurrentValueEstimate[]): EstimateTotals {
  const t: EstimateTotals = {
    anchorTotal: 0,
    estimatedTotal: 0,
    interest: 0,
    market: 0,
    fx: 0,
    contribution: 0,
    byBasis: { calculated: 0, estimated: 0, carried_forward: 0 },
  };
  for (const e of items) {
    t.anchorTotal += e.anchorAmount;
    t.estimatedTotal += e.estimatedAmount;
    t.byBasis[e.basis] += e.estimatedAmount;
    for (const c of e.components) t[c.kind] += c.amount;
  }
  return t;
}
