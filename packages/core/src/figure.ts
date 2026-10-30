/**
 * The five kinds of figure the app shows, and the glossary of every headline metric. One taxonomy for every screen, report, e-mail
 * and export, so a number is never presented as something it is not:
 *
 *  - actual      a value read from a bank, a fund statement (CAS), a confirmed transaction or your own entry, on its effective date;
 *  - estimate    worked out from rules, rates or contract terms between actual records (savings interest since the last balance, a
 *                deposit's accrued interest, a value moved with the price, growth assumed in Settings);
 *  - market      units or a native amount you hold times an official published price (the fund's NAV, a share's closing price, the
 *                exchange rate), with that price's date;
 *  - projection  something expected but not yet confirmed (a SIP instalment due after the last statement, units it would buy);
 *  - history     a figure about the past (performance over a period, a return per cent), worked out from the four above.
 *
 * A total mixes kinds only when it says so: `mixOf` tells which kinds are inside it and how much of it each makes up.
 *
 * Pure: no I/O.
 */
import type { ValueBasis } from './position';

export type FigureKind = 'actual' | 'estimate' | 'market' | 'projection' | 'history';

export const FIGURE_KINDS: { key: FigureKind; label: string; short: string; meaning: string }[] = [
  {
    key: 'actual',
    label: 'Actual',
    short: 'actual',
    meaning:
      'Read from a bank, a fund statement, a confirmed transaction or your own entry, on the date it applies to.',
  },
  {
    key: 'estimate',
    label: 'Estimate',
    short: 'est.',
    meaning:
      'Worked out from rates, contract terms or a rule since the last actual record. Replaced by the next actual record.',
  },
  {
    key: 'market',
    label: 'Market value',
    short: 'market',
    meaning:
      'Units or an amount you hold times an official published price (NAV, closing price or exchange rate) of the date shown.',
  },
  {
    key: 'projection',
    label: 'Projection',
    short: 'proj.',
    meaning:
      'Expected but not confirmed yet, such as a SIP instalment due after the last statement. Never counted as money invested or as profit.',
  },
  {
    key: 'history',
    label: 'Past performance',
    short: 'history',
    meaning: 'A figure about a past period, worked out from actual records, estimates and prices.',
  },
];

export const figureKindLabel = (k: FigureKind): string =>
  FIGURE_KINDS.find((x) => x.key === k)!.label;

/**
 * The kind of a holding's value from how it was worked out. Units times a price is a market value only when the units themselves are
 * confirmed (a statement or a count); units rebuilt from a plan, or including instalments not yet on a statement, make it an estimate.
 */
export function kindOfBasis(basis: ValueBasis | null, unitsConfirmed = true): FigureKind | null {
  switch (basis) {
    case null:
      return null;
    case 'recorded':
      return 'actual';
    case 'units_nav':
      return unitsConfirmed ? 'market' : 'estimate';
    case 'fx':
      return 'market';
    case 'terms':
    case 'bank_amount':
    case 'rate':
    case 'nav_scaled':
    case 'sheet':
    case 'assumed':
      return 'estimate';
  }
}

/** How much of a total each kind makes up, and the kind to label the total with: the single kind, or 'estimate' for any mix with one. */
export function mixOf(parts: { kind: FigureKind | null; value: number }[]): {
  by: Partial<Record<FigureKind, number>>;
  label: FigureKind | 'mixed' | null;
} {
  const by: Partial<Record<FigureKind, number>> = {};
  for (const p of parts) if (p.kind) by[p.kind] = (by[p.kind] ?? 0) + p.value;
  const kinds = Object.keys(by) as FigureKind[];
  if (kinds.length === 0) return { by, label: null };
  if (kinds.length === 1) return { by, label: kinds[0]! };
  if (kinds.includes('projection')) return { by, label: 'mixed' };
  return { by, label: kinds.includes('estimate') ? 'estimate' : 'mixed' };
}

// ------------------------------------------------------------------------------------------------
// The glossary: what every headline figure means. The "?" explainers and docs/DEFINITIONS.md read it.
// ------------------------------------------------------------------------------------------------
export type MetricKey =
  | 'netWorth'
  | 'assets'
  | 'liabilities'
  | 'savingsBalance'
  | 'fdValue'
  | 'fdPrincipal'
  | 'fdAccrued'
  | 'fdMaturityValue'
  | 'maturityProceeds'
  | 'fundsConfirmed'
  | 'fundsEstimated'
  | 'sipProjected'
  | 'stocks'
  | 'otherAssets'
  | 'cash'
  | 'externalCapital'
  | 'netExternalFlows'
  | 'openingPosition'
  | 'cumulativeGain'
  | 'cumulativeGainPct'
  | 'xirr'
  | 'twr'
  | 'costBasis'
  | 'currentCost'
  | 'currentGain'
  | 'realisedGain'
  | 'unrealisedGain'
  | 'interestEarned'
  | 'income'
  | 'unexplained'
  | 'periodChange';

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  kind: FigureKind | 'mixed';
  definition: string;
  /** the date the figure applies to */
  effectiveDate: string;
  /** for a per cent: what it is a per cent of */
  denominator?: string;
}

export const METRICS: Record<MetricKey, MetricDefinition> = {
  netWorth: {
    key: 'netWorth',
    label: 'Net worth',
    kind: 'mixed',
    definition:
      'Everything the family owns (savings, deposits, maturity proceeds not yet placed, funds, shares, other assets) less what it owes. Each part is valued by its own rule and keeps its own label.',
    effectiveDate: 'The valuation date shown (today, or the day of a past snapshot).',
  },
  assets: {
    key: 'assets',
    label: 'Assets',
    kind: 'mixed',
    definition: 'The value of everything owned, before loans owed are taken off.',
    effectiveDate: 'The valuation date.',
  },
  liabilities: {
    key: 'liabilities',
    label: 'Liabilities',
    kind: 'estimate',
    definition: 'What the family owes: the outstanding amount of each loan on the valuation date.',
    effectiveDate: 'The valuation date.',
  },
  savingsBalance: {
    key: 'savingsBalance',
    label: 'Savings (estimated balance)',
    kind: 'estimate',
    definition:
      'The last actual balance, plus confirmed money in and out since, plus interest worked out day by day at the rate in force (including slab rates). Becomes actual again when the next balance arrives.',
    effectiveDate: 'The valuation date; the baseline balance keeps its own date.',
  },
  fdValue: {
    key: 'fdValue',
    label: 'Fixed deposits (current value)',
    kind: 'estimate',
    definition:
      'For each running deposit: the principal plus the interest earned on its contract terms and not yet paid out.',
    effectiveDate: 'The valuation date.',
  },
  fdPrincipal: {
    key: 'fdPrincipal',
    label: 'Deposit principal',
    kind: 'actual',
    definition: 'The amount each running deposit was opened with, as on its contract.',
    effectiveDate: 'The booking date of each deposit.',
  },
  fdAccrued: {
    key: 'fdAccrued',
    label: 'Accrued interest',
    kind: 'estimate',
    definition:
      'Interest earned so far and still held in the deposit (not yet paid out). Interest already paid out to an account is shown apart as credited.',
    effectiveDate: 'The valuation date.',
  },
  fdMaturityValue: {
    key: 'fdMaturityValue',
    label: 'Maturity value',
    kind: 'estimate',
    definition:
      'What the deposit pays on its maturity date on its contract terms (the bank’s own figure when it is on file). A future amount, not part of current value.',
    effectiveDate: 'The maturity date.',
  },
  maturityProceeds: {
    key: 'maturityProceeds',
    label: 'Maturity proceeds awaiting confirmation',
    kind: 'estimate',
    definition:
      'Money paid out by deposits that matured where you have not yet said where it went (a savings account, a new deposit, withdrawn). Counted once in net worth; never reinvested automatically.',
    effectiveDate: 'The maturity date of each deposit.',
  },
  fundsConfirmed: {
    key: 'fundsConfirmed',
    label: 'Funds: confirmed value',
    kind: 'market',
    definition:
      'Units confirmed by your fund statements (CAS) or a unit count, times the official NAV of the date shown. No projected instalment is in it.',
    effectiveDate: 'The NAV date shown.',
  },
  fundsEstimated: {
    key: 'fundsEstimated',
    label: 'Funds: estimated value',
    kind: 'estimate',
    definition:
      'The confirmed value plus the units the active SIPs are expected to have bought since the last statement, each at the NAV of its own date. Replaced by actual figures when the next statement is imported.',
    effectiveDate: 'The NAV date shown.',
  },
  sipProjected: {
    key: 'sipProjected',
    label: 'Projected SIP activity',
    kind: 'projection',
    definition:
      'SIP instalments due after the last statement, with the amount in force on each date and the units the NAV of that date buys. Not money invested until a statement confirms it.',
    effectiveDate: 'Each instalment’s own date.',
  },
  stocks: {
    key: 'stocks',
    label: 'Shares',
    kind: 'market',
    definition:
      'Quantity held times the latest official closing price; a price older than Settings allows is flagged as stale.',
    effectiveDate: 'The price date shown.',
  },
  otherAssets: {
    key: 'otherAssets',
    label: 'Other assets',
    kind: 'actual',
    definition:
      'Property, money lent, pension and insurance savings and anything else: the value last recorded, moved on only at a growth rate you set in Settings (then marked as an estimate).',
    effectiveDate: 'The date of the value recorded.',
  },
  cash: {
    key: 'cash',
    label: 'Cash',
    kind: 'estimate',
    definition:
      'Savings and current accounts in rupees and in other currencies (converted at the exchange rate of the date shown).',
    effectiveDate: 'The valuation date.',
  },
  externalCapital: {
    key: 'externalCapital',
    label: 'Own money',
    kind: 'history',
    definition:
      'The opening position plus all money that came in from outside the family’s accounts (salary, gifts received, sale of something not tracked) less all money withdrawn of them. Interest, profit, renewals, reinvestment and transfers between your own accounts never change it.',
    effectiveDate: 'The valuation date.',
  },
  netExternalFlows: {
    key: 'netExternalFlows',
    label: 'Net outside money',
    kind: 'history',
    definition:
      'Money that came in from outside less money that went out, in the period. Confirmed movements are shown apart from amounts worked out from balances.',
    effectiveDate: 'The period shown.',
  },
  openingPosition: {
    key: 'openingPosition',
    label: 'Opening position',
    kind: 'history',
    definition:
      'Net worth on the first date with a value for the holdings on record, taken as the money the family started with. Profit is measured from it, never from zero.',
    effectiveDate: 'The opening date shown.',
  },
  cumulativeGain: {
    key: 'cumulativeGain',
    label: 'Lifetime profit',
    kind: 'history',
    definition:
      'Net worth less own money: interest, fund and share profit, exchange-rate moves and income, after fees and taxes. Changes not yet explained are shown apart and not counted.',
    effectiveDate: 'The valuation date, since the opening date.',
  },
  cumulativeGainPct: {
    key: 'cumulativeGainPct',
    label: 'Lifetime profit (%)',
    kind: 'history',
    definition: 'Lifetime profit as a per cent of own money.',
    effectiveDate: 'The valuation date, since the opening date.',
    denominator:
      'Own money (opening position plus net outside money). Not shown when that is zero or negative.',
  },
  xirr: {
    key: 'xirr',
    label: 'Annual return (XIRR)',
    kind: 'history',
    definition:
      'The yearly rate that turns the opening position and every dated movement of outside money into today’s net worth (money-weighted). Internal transfers, renewals and reinvested interest are not movements.',
    effectiveDate: 'From the opening date to the valuation date.',
    denominator: 'Money-weighted: each sum counts for the time it was invested.',
  },
  twr: {
    key: 'twr',
    label: 'Time-weighted return',
    kind: 'history',
    definition:
      'The growth of the money invested over the period with the effect of money added or withdrawn removed: each stretch between movements is measured on its own and the stretches are chained.',
    effectiveDate: 'The period shown.',
    denominator: 'Value at the start of each stretch.',
  },
  costBasis: {
    key: 'costBasis',
    label: 'Invested (cost)',
    kind: 'actual',
    definition:
      'For funds: the purchase cost of the units still held, matched first-in first-out against sales (the method Indian capital-gains tax uses). Projected instalments are not in it.',
    effectiveDate: 'The date of the last statement.',
  },
  currentCost: {
    key: 'currentCost',
    label: 'Cost of current holdings',
    kind: 'actual',
    definition:
      'What the holdings you have today cost: each running deposit’s amount, the last balance of each savings account, and the first-in first-out cost of the fund units still held. A deposit renewed with its interest counts at its new, larger amount, so reinvested interest is inside it. Not the same as own money.',
    effectiveDate: 'Today.',
  },
  currentGain: {
    key: 'currentGain',
    label: 'Profit',
    kind: 'estimate',
    definition:
      'Current value of the holdings you have now, less what they cost. Interest already rolled into a renewed deposit is part of its cost, so it is not in this profit; the lifetime profit counts it once.',
    effectiveDate: 'Today.',
    denominator: 'Cost of current holdings.',
  },
  realisedGain: {
    key: 'realisedGain',
    label: 'Booked profit',
    kind: 'history',
    definition: 'Sale proceeds less the first-in first-out cost of the units sold.',
    effectiveDate: 'The sale dates in the period.',
  },
  unrealisedGain: {
    key: 'unrealisedGain',
    label: 'Profit',
    kind: 'market',
    definition: 'Value of the units still held less their cost.',
    effectiveDate: 'The NAV or price date shown.',
  },
  interestEarned: {
    key: 'interestEarned',
    label: 'Interest earned',
    kind: 'estimate',
    definition:
      'Interest on savings and deposits in the period, whether credited to an account, paid out, reinvested or still accruing; credited and accrued are shown apart.',
    effectiveDate: 'The period shown.',
  },
  income: {
    key: 'income',
    label: 'Income and distributions',
    kind: 'actual',
    definition: 'Dividends and fund payouts (IDCW) received in the period.',
    effectiveDate: 'The payment dates.',
  },
  unexplained: {
    key: 'unexplained',
    label: 'Not yet explained',
    kind: 'estimate',
    definition:
      'The difference between a new actual balance and what the earlier balance, confirmed movements and interest predicted. Never counted as profit or as invested until you classify it.',
    effectiveDate: 'The date of the balance that showed it.',
  },
  periodChange: {
    key: 'periodChange',
    label: 'Change in wealth',
    kind: 'history',
    definition:
      'Net worth at the end of the period less net worth at its start, split into outside money, interest, market profit, income, fees and taxes, and anything not yet explained.',
    effectiveDate: 'The period shown.',
  },
};

/** The glossary as Markdown, for docs/DEFINITIONS.md (a test keeps the file in step). */
export function metricsMarkdown(): string {
  const kinds = FIGURE_KINDS.map((k) => `- **${k.label}** (${k.short}): ${k.meaning}`).join('\n');
  const rows = Object.values(METRICS)
    .map(
      (m) =>
        `### ${m.label}\n\n${m.definition}\n\n- Kind: ${m.kind === 'mixed' ? 'mixed (each part keeps its own label)' : figureKindLabel(m.kind)}\n- Applies to: ${m.effectiveDate}${m.denominator ? `\n- Per cent of: ${m.denominator}` : ''}\n`,
    )
    .join('\n');
  return `# Definitions\n\nGenerated from \`packages/core/src/figure.ts\`; do not edit by hand.\n\n## The five kinds of figure\n\n${kinds}\n\n## Metrics\n\n${rows}`;
}
