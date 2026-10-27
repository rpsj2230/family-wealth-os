/**
 * The "?" next to a figure: a typed description of how a number was found, from which data, and how complete that data is.
 * Pure. A builder (see explain-invest.ts, explain-home.ts, explain-money.ts, explain-reports.ts) takes the numbers a page already
 * has and returns an `Explain`; the web component `Why` only draws it. Nothing here is a second source of truth: the flags and
 * verdicts a page already holds (ledger check, lots basis, flows estimated, freshness, the estimate mark) are passed in and put
 * into words, never recomputed with a different rule.
 *
 * Five data states are used everywhere, each a colour AND a word on screen:
 *   statement   read from a fund statement, a bank statement or a document
 *   recorded    typed in or confirmed by a person (a balance, a unit count, a deposit's terms)
 *   calculated  worked out exactly from recorded facts (units x price, interest from a deposit's own terms)
 *   estimated   worked out from a rate, a plan or a price move; a good guess, not a record
 *   missing     the data this figure needs is not there, so the figure is left out or reduced
 */
import { formatInr } from './money';

export type ExplainBasis = 'statement' | 'recorded' | 'calculated' | 'estimated' | 'missing';
export type ExplainLevel = 'complete' | 'partly_estimated' | 'estimated' | 'missing';

/** How many things an input covers: "12 of 26 funds" (n = 12, of = 26) or "14 funds" (n = 14). */
export interface ExplainCount {
  n: number;
  of?: number;
  noun: string;
}

export interface ExplainInput {
  label: string;
  /** the value as the person reads it ("₹43,01,000", "21 Oct 2026", "12 funds") */
  value: string;
  basis: ExplainBasis;
  /** the dates the input covers (a single date: only `to`, or the same on both) */
  from?: string | null | undefined;
  to?: string | null | undefined;
  count?: ExplainCount | undefined;
  /** a few words on this input only */
  note?: string | undefined;
}

export interface Explain {
  /** the registered figure this explains (see FIGURES) */
  id: string;
  title: string;
  /** the figure as shown, which may be rounded ("₹8.04 L"), and its exact rupees ("₹8,03,737") */
  shown?: string;
  exact?: string;
  /** one plain sentence: what the figure is */
  what: string;
  /** the formula in words with the actual numbers plugged in */
  how: string;
  inputs: ExplainInput[];
  completeness: { level: ExplainLevel; text: string };
  notes: string[];
  fix?: { label: string; href: string };
  /** further places to go (the Import page, the data check) */
  also?: { label: string; href: string }[];
}

// ------------------------------------------------------------------------------------------------
// Words
// ------------------------------------------------------------------------------------------------
export const BASIS_WORD: Record<ExplainBasis, string> = {
  statement: 'statement',
  recorded: 'recorded',
  calculated: 'calculated',
  estimated: 'estimated',
  missing: 'missing',
};

export const BASIS_HELP: Record<ExplainBasis, string> = {
  statement: 'Read from a fund statement, a bank statement or a document.',
  recorded: 'Typed in or confirmed by a person.',
  calculated: 'Worked out exactly from recorded facts (units times price, a deposit’s own terms).',
  estimated: 'Worked out from a rate, a plan or a price move: a good guess, not a record.',
  missing: 'The data is not there, so the figure is left out or reduced.',
};

export const LEVEL_WORD: Record<ExplainLevel, string> = {
  complete: 'Complete',
  partly_estimated: 'Partly estimated',
  estimated: 'Estimated',
  missing: 'Missing data',
};

/** The rank of a level, worst highest: used to take the weakest of several. */
const LEVEL_RANK: Record<ExplainLevel, number> = {
  complete: 0,
  partly_estimated: 1,
  estimated: 2,
  missing: 3,
};

export const worstLevel = (levels: ExplainLevel[]): ExplainLevel =>
  levels.reduce<ExplainLevel>((w, l) => (LEVEL_RANK[l] > LEVEL_RANK[w] ? l : w), 'complete');

/** Complete when nothing is estimated, estimated when everything is, partly estimated in between. */
export function levelOfShare(estimated: number, total: number): ExplainLevel {
  if (total <= 0) return 'missing';
  if (estimated <= 0) return 'complete';
  return estimated >= total ? 'estimated' : 'partly_estimated';
}

// ------------------------------------------------------------------------------------------------
// Formatting: the same forms the pages use (26 Oct 2026, ₹1,91,79,860, +18.7%)
// ------------------------------------------------------------------------------------------------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 2026-10-26 -> "26 Oct 2026"; anything that is not a date -> "–". */
export function exDate(iso: string | null | undefined): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return '–';
  const m = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  if (m < 1 || m > 12) return '–';
  return `${d} ${MONTHS[m - 1]} ${iso.slice(0, 4)}`;
}

/** "26 Sep to 26 Oct 2026"-style range; one date when only one is given or both are the same. */
export function exRange(from: string | null | undefined, to: string | null | undefined): string {
  if (from && to && from !== to) return `${exDate(from)} to ${exDate(to)}`;
  return exDate(to ?? from);
}

/** Whole rupees with Indian grouping, no sign: ₹8,03,737. */
export const exInr = (n: number): string => formatInr(Math.round(Math.abs(n)));

/** Whole rupees with an explicit sign: +₹8,03,737 or −₹1,200. */
export const exSigned = (n: number): string =>
  `${Math.round(n) < 0 ? '−' : '+'}${formatInr(Math.abs(Math.round(n)))}`;

/** A fraction as a percentage: 0.187 -> "18.7%". */
export const exPct = (f: number, digits = 1): string => `${(f * 100).toFixed(digits)}%`;

/** A fraction as a signed percentage: +18.7% / −3.2%. */
export const exSignedPct = (f: number, digits = 1): string =>
  `${f < 0 ? '−' : '+'}${Math.abs(f * 100).toFixed(digits)}%`;

export const exPlural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;

/** "12 of 26 funds" / "14 funds". */
export const exCount = (c: ExplainCount): string =>
  c.of !== undefined ? `${c.n} of ${c.of} ${c.noun}` : `${c.n} ${c.noun}`;

// ------------------------------------------------------------------------------------------------
// Building one
// ------------------------------------------------------------------------------------------------
export interface ExplainDraft {
  id: string;
  title: string;
  shown?: string | undefined;
  exact?: string | undefined;
  what: string;
  how: string;
  inputs?: ExplainInput[];
  level: ExplainLevel;
  completeness: string;
  notes?: (string | null | false | undefined)[];
  fix?: { label: string; href: string } | null | undefined;
  also?: ({ label: string; href: string } | null | false | undefined)[];
}

/** Assembles an `Explain`, dropping empty notes. */
export function explain(d: ExplainDraft): Explain {
  const out: Explain = {
    id: d.id,
    title: d.title,
    what: d.what,
    how: d.how,
    inputs: d.inputs ?? [],
    completeness: { level: d.level, text: d.completeness },
    notes: (d.notes ?? []).filter((n): n is string => typeof n === 'string' && n.length > 0),
  };
  if (d.shown !== undefined) out.shown = d.shown;
  if (d.exact !== undefined) out.exact = d.exact;
  // a link with no address (a page the public sample does not have) is left out
  if (d.fix && d.fix.href) out.fix = d.fix;
  const also = (d.also ?? []).filter((x): x is { label: string; href: string } => !!x && !!x.href);
  if (also.length > 0) out.also = also;
  return out;
}

/** A figure whose data is not there at all. */
export function explainMissing(
  id: string,
  title: string,
  what: string,
  needs: string,
  fix?: { label: string; href: string },
): Explain {
  return explain({
    id,
    title,
    what,
    how: `Not worked out: ${needs}`,
    level: 'missing',
    completeness: `Missing: ${needs}`,
    inputs: [{ label: 'Needed', value: needs, basis: 'missing' }],
    fix,
  });
}

/**
 * A share written with both parts: "₹8,03,737 profit ÷ ₹43,01,000 money put in = +18.7%".
 * The denominator is always named, because a percentage without one cannot be checked.
 */
export function ratioHow(
  top: { label: string; amount: number },
  bottom: { label: string; amount: number },
  digits = 1,
  signed = true,
): string {
  const r = bottom.amount !== 0 ? top.amount / bottom.amount : null;
  const fmt = (n: number) => exInr(n);
  const res = r === null ? 'not defined' : signed ? exSignedPct(r, digits) : exPct(r, digits);
  const sign = (n: number) => (n < 0 ? '−' : '');
  return `${sign(top.amount)}${fmt(top.amount)} ${top.label} ÷ ${sign(bottom.amount)}${fmt(bottom.amount)} ${bottom.label} = ${res}`;
}

// ------------------------------------------------------------------------------------------------
// The registry: every headline figure that must have a "?" on its page
// ------------------------------------------------------------------------------------------------
/**
 * The figures that carry a "?", by page. A page builds an `ExplainSet` keyed by exactly these ids (the type forces every id to be
 * present, and the tests build each page's set from a fixture and fail on a missing or empty explainer). A figure added to a page
 * is added here first; the UI guide's coverage list is generated from this object.
 */
export const FIGURES = {
  investments: [
    'invest.value',
    'invest.profit',
    'invest.today',
    'invest.ring',
    'invest.moneyIn',
    'invest.xirr',
    'invest.booked',
    'invest.totalGain',
    'invest.sip',
    'invest.longTerm',
    'invest.statements',
    'invest.projection',
    'invest.dataCheck',
    'invest.valueChart',
    'invest.returns',
    'invest.goals',
    'invest.mix',
    'invest.movers',
    'invest.nextSips',
    'invest.people',
    'invest.pl',
    'invest.monthGrid',
    'invest.growth100',
    'invest.drawdown',
    'invest.risk',
    'invest.rolling',
    'invest.whatIf',
    'invest.chgValue',
    'invest.chgChange',
    'invest.chgNewMoney',
    'invest.chgMarket',
    'invest.contrib',
    'invest.pace',
    'invest.fundsTable',
    'invest.byKind',
    'invest.byHouse',
    'invest.byFund',
    'invest.keyFigures',
    'invest.plans',
    'invest.ageing',
    'invest.gainByFund',
    'invest.longTermCard',
    'invest.sipCard',
    'invest.bookedCard',
  ],
  fund: [
    'fund.value',
    'fund.moneyIn',
    'fund.profit',
    'fund.today',
    'fund.xirr',
    'fund.sip',
    'fund.cagr',
    'fund.units',
    'fund.tax',
    'fund.booked',
    'fund.returns',
  ],
  home: [
    'home.netWorth',
    'home.today',
    'home.month',
    'home.fy',
    'home.invested',
    'home.current',
    'home.maturity',
    'home.profit',
    'home.earnedToday',
    'home.verified',
    'home.cashAndDeposits',
    'home.free30',
    'home.nextMaturity',
    'home.interest',
    'home.fundsStat',
    'home.goalsStat',
    'home.needsStat',
    'home.insured',
    'home.classDeposits',
    'home.classFunds',
    'home.classCash',
    'home.classOthers',
    'home.periods',
    'home.changed',
    'home.trend',
    'home.growth',
    'home.where',
    'home.liquidity',
    'home.banks',
    'home.deposits',
    'home.funds',
    'home.goals',
    'home.risks',
  ],
  accounts: [
    'accounts.total',
    'accounts.profit',
    'accounts.today',
    'accounts.journey',
    'accounts.where',
    'accounts.deposits',
    'accounts.cash',
    'accounts.toEarn',
    'accounts.next',
    'accounts.soon',
    'accounts.largestBank',
    'accounts.cover',
    'accounts.updated',
    'accounts.people',
    'accounts.types',
    'accounts.grand',
  ],
  deposits: [
    'deposits.total',
    'deposits.profit',
    'deposits.today',
    'deposits.journey',
    'deposits.banks',
    'deposits.ladder',
    'deposits.invested',
    'deposits.maturity',
    'deposits.toEarn',
    'deposits.next',
    'deposits.soon',
    'deposits.toConfirm',
    'deposits.largest',
    'deposits.cover',
    'deposits.people',
    'deposits.types',
  ],
  cash: [
    'cash.total',
    'cash.sinceLast',
    'cash.today',
    'cash.earns',
    'cash.banks',
    'cash.interestYear',
    'cash.largestBalance',
    'cash.largestBank',
    'cash.stale',
    'cash.people',
    'cash.types',
  ],
  reports: [
    'reports.fdCount',
    'reports.fdPrincipal',
    'reports.fdMaturity',
    'reports.fdInterest',
    'reports.fdRate',
    'reports.fdNext',
    'reports.fundCount',
    'reports.fundInvested',
    'reports.fundValue',
    'reports.fundGain',
    'reports.fundXirr',
    'reports.fundSip',
    'reports.table',
  ],
  tax: ['tax.allowance', 'tax.sell', 'tax.losses', 'tax.costs', 'tax.refunds', 'tax.simulator'],
  monthly: ['monthly.status', 'monthly.freshness'],
  newmoney: ['newmoney.options', 'newmoney.better', 'newmoney.room'],
  rates: ['rates.freshness', 'rates.best'],
} as const;

export type FigurePage = keyof typeof FIGURES;
export type FigureId<P extends FigurePage = FigurePage> = (typeof FIGURES)[P][number];

/** One explainer for every registered figure of a page. */
export type ExplainSet<P extends FigurePage> = { [K in FigureId<P>]: Explain };

/** The registered figures of a page that have no usable explainer in `set`: empty means the page is covered. */
export function missingFigures<P extends FigurePage>(
  page: P,
  set: Partial<Record<string, Explain>>,
): string[] {
  return (FIGURES[page] as readonly string[]).filter((id) => {
    const e = set[id];
    return (
      !e ||
      e.id !== id ||
      !e.title ||
      !e.what ||
      !e.how ||
      !e.completeness.text ||
      !['complete', 'partly_estimated', 'estimated', 'missing'].includes(e.completeness.level)
    );
  });
}

/** Every registered figure id, flat. */
export const ALL_FIGURE_IDS: string[] = Object.values(FIGURES).flatMap((l) => [...l]);
