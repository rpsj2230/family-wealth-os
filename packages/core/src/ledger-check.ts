/**
 * Does a fund's transaction history add up? Pure: the caller supplies the stored lines and the fund's recorded position, and gets a
 * plain verdict back, so a page never has to show a number without saying whether the history under it is complete.
 *
 * What is checked, for every fund:
 *  - the running balance on the statement: each line's "units held after" must equal the line before it plus the line's own units
 *    (a break means lines are missing, or a line is on file twice);
 *  - the units held before the first line that no line explains (the fund began before the history on file);
 *  - the units the lines lead to against the unit count the fund records for the same date;
 *  - the cost of the units held according to the lines against the invested amount recorded.
 * Lines assumed from a SIP plan (source "estimate") are never evidence: they are counted and named, not trusted.
 * The tolerances come from Settings (AppConfig.funds), never from this file.
 */
import { isEstimatedTxn } from './estimate';
import type { FundTxn } from './performance';

/** Floating-point slack added to every tolerance, so a difference of exactly the tolerance is not read as larger than it. */
const SLACK = 1e-9;

export type LedgerStatus =
  'complete' | 'starts_midway' | 'gap' | 'mismatch' | 'estimated' | 'no_transactions';

/** One stored transaction line. */
export interface LedgerLine {
  id?: string | null;
  date: string;
  kind?: string | null;
  /** units bought are positive, units sold are negative */
  units: number;
  amount: number;
  nav?: number | null;
  /** units held after this line, when the statement says */
  balance?: number | null;
  /** 'cas', 'manual', 'estimate', a file import … */
  source?: string | null;
  description?: string | null;
  /** the folio the line belongs to, when it can be told (each folio keeps its own running balance) */
  folio?: string | null;
}

export interface LedgerTolerance {
  /** units a ledger may be out by (rounding on a statement) */
  units: number;
  /** rupees the money may be out by */
  money: number;
}

export interface LedgerPosition {
  /** the unit count the fund records, and the date it was counted */
  units: number | null;
  unitsAsOf: string | null;
  /** the invested amount (cost of the units held) the fund records */
  invested: number | null;
  startedOn: string | null;
}

/** Two consecutive lines of a folio whose balances do not follow. */
export interface ChainBreak {
  folio: string | null;
  /** the dates of the line before and the line after the break */
  from: string;
  to: string;
  /** units the balance went up by that no line explains (positive), or went down by (negative) */
  unexplained: number;
}

export interface PossibleDuplicate {
  date: string;
  units: number;
  amount: number;
  sources: string[];
}

export type ChipTone = 'ok' | 'warn' | 'bad' | 'info';

export interface LedgerVerdict {
  status: LedgerStatus;
  firstTxnOn: string | null;
  lastTxnOn: string | null;
  /** lines read from statements or typed in (not assumed ones) */
  txnCount: number;
  /** instalments assumed from the SIP plan since the last real line, and their units and money */
  estimatedCount: number;
  estimatedUnits: number;
  estimatedAmount: number;
  sources: string[];
  /** the sum of the signed units of the real lines */
  ledgerUnits: number;
  /** the units the lines add up to by themselves: the units held before the first line (when known) plus every line */
  unitsBySum: number | null;
  /** units held before the first line that no line explains; null when the lines carry no running balance */
  openingUnits: number | null;
  /** where the lines lead to: opening units plus every line, taking each folio's own balance as it stands */
  ledgerClosingUnits: number | null;
  /** the last "units held after" on the statement and its date */
  statementUnits: number | null;
  statementOn: string | null;
  /** the fund's recorded unit count and its date */
  positionUnits: number | null;
  positionUnitsAsOf: string | null;
  /** what the lines say was held on that same date */
  ledgerUnitsAtPositionDate: number | null;
  /** the unit count differs from the lines on that date (more than the tolerance) */
  positionDiffers: boolean;
  /** units that the recorded count has and the lines do not explain (negative: the lines have more) */
  positionDifference: number | null;
  breaks: ChainBreak[];
  folios: number;
  duplicates: PossibleDuplicate[];
  /** money bought and sold on the real lines; net money in is the difference */
  boughtAmount: number;
  soldAmount: number;
  netMoneyIn: number;
  /** cost of the units held by the lines (oldest sold first); null when it cannot be told */
  investedByLedger: number | null;
  positionInvested: number | null;
  /** invested by the lines minus the recorded amount, when they differ by more than the tolerance and the comparison is fair */
  investedDifference: number | null;
  /** the history can be relied on: lots, gains and returns rest on it */
  reliable: boolean;
  /** headline figures of this fund rest partly on an estimate and should carry the "est." mark */
  figuresEstimated: boolean;
  /** how the verdict was reached */
  basis: 'running_balance' | 'unit_count' | 'none';
  notes: string[];
  /** what to do about it, in plain words; null when nothing is needed */
  fix: string | null;
  chip: { icon: '✓' | '⚠' | '✗' | '~' | '–'; label: string; tone: ChipTone; title: string };
}

export interface LedgerCheckInput {
  lines: LedgerLine[];
  position?: LedgerPosition | null;
  /** cost of the units still held worked out from the lines (first in, first out), when the caller has it */
  heldCost?: number | null;
  tolerance: LedgerTolerance;
  /** the date from which histories should be on file (Settings), used in the advice */
  historyFrom?: string;
}

/** A units figure the way a statement prints it. */
export const unitsText = (n: number) =>
  n.toLocaleString('en-IN', { maximumFractionDigits: 3, minimumFractionDigits: 0 });

const niceIso = (iso: string) => {
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(iso.slice(8, 10))} ${m[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
};

/**
 * The folio a CAS line was stored under (its reference is "date|kind|amount|units|folio|n"), or null for lines from anywhere else.
 */
export function folioOfRef(source: string | null | undefined, ref: string | null | undefined) {
  if (source !== 'cas' || !ref) return null;
  const parts = ref.split('|');
  return parts.length >= 6 ? (parts[4] ?? null) : null;
}

/**
 * Puts lines in the order they happened. Lines of one day have no time on them, so the order within a day is recovered from the
 * running balance (each line must start where the one before it ended); lines that cannot be chained are put purchases first.
 */
export function orderLines<T extends { date: string; units: number; balance?: number | null }>(
  lines: T[],
  unitTolerance: number,
): T[] {
  const sorted = [...lines].sort((a, b) => a.date.localeCompare(b.date));
  const out: T[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j < sorted.length && sorted[j]!.date === sorted[i]!.date) j++;
    const day = sorted.slice(i, j);
    i = j;
    if (day.length === 1) {
      out.push(day[0]!);
      continue;
    }
    // the balance each line must start from: the last known balance before this day
    let prev: number | null = null;
    for (let k = out.length - 1; k >= 0; k--) {
      const b = out[k]!.balance;
      if (typeof b === 'number') {
        prev = b;
        break;
      }
    }
    const left = [...day];
    const placed: T[] = [];
    while (left.length > 0) {
      let pick = -1;
      if (prev !== null)
        pick = left.findIndex(
          (l) =>
            typeof l.balance === 'number' &&
            Math.abs(l.balance - l.units - prev!) <= unitTolerance + SLACK,
        );
      if (pick < 0) {
        // nothing chains: the rest go purchases first, then sales, keeping the order given
        const rest = left.map((l, idx) => ({ l, idx }));
        rest.sort((a, b) => (b.l.units > 0 ? 1 : 0) - (a.l.units > 0 ? 1 : 0) || a.idx - b.idx);
        for (const r of rest) placed.push(r.l);
        break;
      }
      const [l] = left.splice(pick, 1);
      placed.push(l!);
      prev = l!.balance as number;
    }
    out.push(...placed);
  }
  return out;
}

interface FolioRun {
  folio: string | null;
  lines: LedgerLine[];
}

/** One folio's running balance, line by line. */
function chainOf(run: FolioRun, tol: number) {
  const breaks: ChainBreak[] = [];
  let expected: number | null = null;
  let cum = 0;
  let opening: number | null = null;
  let prevDate: string | null = null;
  for (const l of run.lines) {
    cum += l.units;
    if (typeof l.balance === 'number') {
      if (opening === null && expected === null) opening = l.balance - cum;
      else if (expected !== null) {
        const diff = l.balance - (expected + l.units);
        if (Math.abs(diff) > tol + SLACK)
          breaks.push({ folio: run.folio, from: prevDate!, to: l.date, unexplained: diff });
      }
      expected = l.balance;
    } else if (expected !== null) expected += l.units;
    prevDate = l.date;
  }
  return { breaks, opening, closing: expected ?? cum, anchored: expected !== null };
}

/**
 * Where a set of real lines starts and ends, folio by folio: the units held before the first line, and the units held after the
 * last. Either is null when the lines carry no running balance to say so.
 */
export function ledgerEnds(
  lines: LedgerLine[],
  unitTolerance: number,
): { opening: number | null; closing: number | null; breaks: number } {
  const real = orderLines(lines, unitTolerance).filter((l) => !isEstimateLine(l));
  const byFolio = new Map<string, LedgerLine[]>();
  for (const l of real) byFolio.set(l.folio ?? '', [...(byFolio.get(l.folio ?? '') ?? []), l]);
  const chains = [...byFolio.values()].map((ls) =>
    chainOf({ folio: null, lines: ls }, unitTolerance),
  );
  const known = chains.length > 0 && chains.every((c) => c.opening !== null);
  return {
    opening: known
      ? Math.max(
          0,
          chains.reduce((a, c) => a + (c.opening ?? 0), 0),
        )
      : null,
    closing: chains.some((c) => c.anchored) ? chains.reduce((a, c) => a + c.closing, 0) : null,
    breaks: chains.reduce((a, c) => a + c.breaks.length, 0),
  };
}

/** True for a line assumed from a SIP plan rather than read from a statement or typed in. */
export const isEstimateLine = (l: {
  source?: string | null | undefined;
  description?: string | null | undefined;
}) => l.source === 'estimate' || isEstimatedTxn({ description: l.description ?? null });

/** Units held at the end of a date, from the lines up to it: the opening units plus the lines, taking each balance as it stands. */
function closingAt(runs: FolioRun[], date: string, tol: number): number | null {
  let total = 0;
  let any = false;
  for (const r of runs) {
    const upto = r.lines.filter((l) => l.date <= date);
    if (upto.length === 0) continue;
    any = true;
    total += chainOf({ folio: r.folio, lines: upto }, tol).closing;
  }
  return any ? total : null;
}

/** What to do about a history that does not add up, in plain words. */
export function ledgerAdvice(status: LedgerStatus, historyFrom?: string): string | null {
  const since = historyFrom ? ` (or ${niceIso(historyFrom)})` : '';
  const ask = `Ask CAMS or KFintech for a DETAILED (not summary) statement from the first investment${since} to today and forward it to the inbox label, or import it on the Import page.`;
  switch (status) {
    case 'complete':
      return null;
    case 'starts_midway':
      return `${ask} The units held before the first line on file need their purchases.`;
    case 'gap':
      return `${ask} Lines between the dates shown are missing (or one is on file twice): a detailed statement over those dates fills them in.`;
    case 'mismatch':
      return `${ask} If you are sure the history is complete, check the unit count: edit the fund and enter the units on your latest statement.`;
    case 'estimated':
      return `${ask} Until then the figures are worked out from the start date and the monthly investment.`;
    case 'no_transactions':
      return `${ask} Or add the transactions by hand with Add a transaction.`;
  }
}

const emptyVerdict = (
  status: 'estimated' | 'no_transactions',
  input: LedgerCheckInput,
  est: LedgerLine[],
): LedgerVerdict => {
  const pos = input.position ?? null;
  const dates = est.map((l) => l.date).sort();
  const estUnits = est.reduce((a, l) => a + l.units, 0);
  return {
    status,
    firstTxnOn: null,
    lastTxnOn: null,
    txnCount: 0,
    estimatedCount: est.length,
    estimatedUnits: estUnits,
    estimatedAmount: est.reduce((a, l) => a + Math.abs(l.amount), 0),
    sources: est.length > 0 ? ['estimate'] : [],
    ledgerUnits: 0,
    unitsBySum: null,
    openingUnits: null,
    ledgerClosingUnits: null,
    statementUnits: null,
    statementOn: null,
    positionUnits: pos?.units ?? null,
    positionUnitsAsOf: pos?.unitsAsOf ?? null,
    ledgerUnitsAtPositionDate: null,
    positionDiffers: false,
    positionDifference: null,
    breaks: [],
    folios: 0,
    duplicates: [],
    boughtAmount: 0,
    soldAmount: 0,
    netMoneyIn: 0,
    investedByLedger: null,
    positionInvested: pos?.invested ?? null,
    investedDifference: null,
    reliable: false,
    figuresEstimated: true,
    basis: 'none',
    notes:
      status === 'estimated'
        ? [
            `Every line is assumed from the monthly investment plan${dates.length ? ` (${dates.length} instalments from ${niceIso(dates[0]!)} to ${niceIso(dates[dates.length - 1]!)})` : ''}; none is read from a statement.`,
          ]
        : ['No transaction is on file for this fund.'],
    fix: ledgerAdvice(status, input.historyFrom),
    chip:
      status === 'estimated'
        ? {
            icon: '~',
            label: 'Estimated',
            tone: 'info',
            title:
              'The lines are assumed from the monthly investment plan, not read from a statement.',
          }
        : {
            icon: '–',
            label: 'No transactions',
            tone: 'info',
            title: 'No transaction is on file for this fund, so its figures are estimates.',
          },
  };
};

/** The verdict on one fund's history. */
export function ledgerCheck(input: LedgerCheckInput): LedgerVerdict {
  const tol = input.tolerance.units;
  const money = input.tolerance.money;
  const pos = input.position ?? null;
  const all = orderLines(input.lines, tol);
  const real = all.filter((l) => !isEstimateLine(l));
  const est = all.filter(isEstimateLine);
  if (all.length === 0) return emptyVerdict('no_transactions', input, []);
  if (real.length === 0) return emptyVerdict('estimated', input, est);

  // one running balance per folio
  const byFolio = new Map<string, LedgerLine[]>();
  for (const l of real) byFolio.set(l.folio ?? '', [...(byFolio.get(l.folio ?? '') ?? []), l]);
  const runs: FolioRun[] = [...byFolio.entries()].map(([f, lines]) => ({
    folio: f === '' ? null : f,
    lines,
  }));
  const chains = runs.map((r) => chainOf(r, tol));
  const breaks = chains.flatMap((c) => c.breaks).sort((a, b) => a.from.localeCompare(b.from));
  const openingKnown = chains.every((c) => c.opening !== null);
  const openingUnits = openingKnown
    ? Math.max(
        0,
        chains.reduce((a, c) => a + (c.opening ?? 0), 0),
      )
    : null;
  const openingNegative = openingKnown && chains.some((c) => (c.opening ?? 0) < -tol - SLACK);
  const ledgerUnits = real.reduce((a, l) => a + l.units, 0);
  const closing = chains.reduce((a, c) => a + c.closing, 0);
  const anchored = chains.some((c) => c.anchored);

  const withBalance = real.filter((l) => typeof l.balance === 'number');
  const lastBal = withBalance[withBalance.length - 1] ?? null;
  const dates = real.map((l) => l.date);
  const firstTxnOn = dates[0]!;
  const lastTxnOn = dates[dates.length - 1]!;
  const sources = [...new Set(real.map((l) => l.source ?? 'unknown'))].sort();

  const bought = real.filter((l) => l.units > 0).reduce((a, l) => a + Math.abs(l.amount), 0);
  const sold = real.filter((l) => l.units < 0).reduce((a, l) => a + Math.abs(l.amount), 0);

  // possible duplicates: the same day, units and money on lines that came from different places
  const dupMap = new Map<string, { l: LedgerLine; sources: Set<string> }>();
  for (const l of real) {
    if (l.units === 0) continue;
    const k = `${l.date}|${l.units}|${Math.abs(l.amount)}`;
    const cur = dupMap.get(k) ?? { l, sources: new Set<string>() };
    cur.sources.add(l.source ?? 'unknown');
    dupMap.set(k, cur);
  }
  const duplicates: PossibleDuplicate[] = [...dupMap.values()]
    .filter((d) => d.sources.size > 1)
    .map((d) => ({
      date: d.l.date,
      units: d.l.units,
      amount: Math.abs(d.l.amount),
      sources: [...d.sources].sort(),
    }));

  // the recorded unit count against what the lines say was held on that date
  let ledgerAtPos: number | null = null;
  let positionDifference: number | null = null;
  if (pos && pos.units !== null && pos.unitsAsOf && pos.unitsAsOf >= firstTxnOn) {
    ledgerAtPos = closingAt(runs, pos.unitsAsOf, tol);
    if (ledgerAtPos !== null) positionDifference = pos.units - ledgerAtPos;
  }
  const positionDiffers = positionDifference !== null && Math.abs(positionDifference) > tol + SLACK;

  const folios = runs.length;
  const notes: string[] = [];
  const dateRange = `${niceIso(firstTxnOn)} to ${niceIso(lastTxnOn)}`;
  notes.push(`${real.length} line${real.length === 1 ? '' : 's'} on file, ${dateRange}.`);
  if (folios > 1)
    notes.push(
      `The lines come from ${folios} folios, each with its own running balance. The unit count on file may hold only one of them.`,
    );
  if (openingUnits !== null && openingUnits > tol + SLACK)
    notes.push(
      `${unitsText(openingUnits)} units were already held before the first line (${niceIso(firstTxnOn)}); their purchases are not on file.`,
    );
  if (openingNegative)
    notes.push(
      'The first balance is lower than the first purchase: the statement lines overlap or repeat.',
    );
  if (!anchored)
    notes.push(
      'The lines carry no running balance, so only the unit count can be used to check them.',
    );
  if (positionDiffers && pos && pos.units !== null)
    notes.push(
      `The lines lead to ${unitsText(ledgerAtPos ?? 0)} units on ${niceIso(pos.unitsAsOf!)}, but the fund records ${unitsText(pos.units)} (${positionDifference! > 0 ? 'more' : 'fewer'} by ${unitsText(Math.abs(positionDifference!))}).`,
    );
  else if (pos && pos.units !== null && pos.unitsAsOf && pos.unitsAsOf < firstTxnOn)
    notes.push('The unit count on file is older than the first line, so it cannot be compared.');
  else if (!pos || pos.units === null)
    notes.push('No unit count is recorded for this fund to compare the lines with.');
  else if (ledgerAtPos !== null && pos.unitsAsOf && breaks.length === 0)
    notes.push(
      `The lines lead to ${unitsText(ledgerAtPos)} units on ${niceIso(pos.unitsAsOf)}, the same as the unit count on file.`,
    );
  if (duplicates.length > 0)
    notes.push(
      `${duplicates.length} line${duplicates.length === 1 ? '' : 's'} may be on file twice (same day, units and amount from different sources).`,
    );
  if (est.length > 0)
    notes.push(
      `${est.length} monthly investment${est.length === 1 ? '' : 's'} since the last line ${est.length === 1 ? 'is' : 'are'} assumed from the plan, not read from a statement.`,
    );
  if (
    pos?.startedOn &&
    pos.startedOn < firstTxnOn &&
    openingUnits !== null &&
    openingUnits <= tol + SLACK
  )
    notes.push(`The fund's start date (${niceIso(pos.startedOn)}) is earlier than its first line.`);

  // the cost of the units held by the lines against the recorded invested amount
  const investedByLedger = input.heldCost ?? null;
  const fairCost = openingUnits !== null && openingUnits <= tol + SLACK && breaks.length === 0;
  let investedDifference: number | null = null;
  if (
    fairCost &&
    investedByLedger !== null &&
    pos &&
    pos.invested !== null &&
    pos.invested !== undefined
  ) {
    const d = investedByLedger - pos.invested;
    if (Math.abs(d) > money) {
      investedDifference = d;
      notes.push(
        `The lines say ₹${Math.round(investedByLedger).toLocaleString('en-IN')} is the cost of the units held; the fund records ₹${Math.round(pos.invested).toLocaleString('en-IN')}.`,
      );
    }
  }

  let status: LedgerStatus;
  if (breaks.length > 0) status = 'gap';
  else if (positionDiffers) status = 'mismatch';
  else if (openingUnits !== null && openingUnits > tol + SLACK) status = 'starts_midway';
  else if (!anchored && (!pos || pos.units === null || ledgerAtPos === null)) status = 'estimated';
  else status = 'complete';
  if (status === 'estimated')
    notes.push('There is nothing to check these lines against, so they are treated as unverified.');

  const basis: LedgerVerdict['basis'] = anchored
    ? 'running_balance'
    : ledgerAtPos !== null
      ? 'unit_count'
      : 'none';

  const first = breaks[0];
  const chip: LedgerVerdict['chip'] =
    status === 'complete'
      ? {
          icon: '✓',
          label: 'Reconciled',
          tone: 'ok',
          title: `${real.length} lines from ${niceIso(firstTxnOn)} add up to the units held.`,
        }
      : status === 'starts_midway'
        ? {
            icon: '⚠',
            label: `Starts midway: ${unitsText(openingUnits ?? 0)} units before first line`,
            tone: 'warn',
            title: `${unitsText(openingUnits ?? 0)} units were held before ${niceIso(firstTxnOn)}; their purchases are not on file.`,
          }
        : status === 'gap'
          ? {
              icon: '⚠',
              label: first
                ? `Gap: ${first.from === first.to ? niceIso(first.to) : `${niceIso(first.from)} to ${niceIso(first.to)}`}${breaks.length > 1 ? ` +${breaks.length - 1} more` : ''}`
                : 'Gap',
              tone: 'warn',
              title: 'Lines are missing (or repeated) between these dates.',
            }
          : status === 'mismatch'
            ? {
                icon: '✗',
                label: `Doesn't match: ledger ${unitsText(ledgerAtPos ?? 0)} vs statement ${unitsText(pos?.units ?? 0)}`,
                tone: 'bad',
                title: 'The lines lead to a different number of units than the fund records.',
              }
            : {
                icon: '~',
                label: 'Not verifiable',
                tone: 'info',
                title:
                  'The lines carry no running balance and the fund has no unit count to compare with.',
              };

  return {
    status,
    firstTxnOn,
    lastTxnOn,
    txnCount: real.length,
    estimatedCount: est.length,
    estimatedUnits: est.reduce((a, l) => a + l.units, 0),
    estimatedAmount: est.reduce((a, l) => a + Math.abs(l.amount), 0),
    sources,
    ledgerUnits,
    unitsBySum: (openingUnits ?? 0) + ledgerUnits,
    openingUnits,
    ledgerClosingUnits: anchored ? closing : null,
    statementUnits: lastBal ? (lastBal.balance as number) : null,
    statementOn: lastBal ? lastBal.date : null,
    positionUnits: pos?.units ?? null,
    positionUnitsAsOf: pos?.unitsAsOf ?? null,
    ledgerUnitsAtPositionDate: ledgerAtPos,
    positionDiffers,
    positionDifference,
    breaks,
    folios,
    duplicates,
    boughtAmount: bought,
    soldAmount: sold,
    netMoneyIn: bought - sold,
    investedByLedger,
    positionInvested: pos?.invested ?? null,
    investedDifference,
    reliable: status === 'complete',
    figuresEstimated: status !== 'complete',
    basis,
    notes,
    fix: ledgerAdvice(status, input.historyFrom),
    chip,
  };
}

/**
 * The units a fund's value should be worked out from: the units the lines lead to when the history reconciles and is newer than
 * the recorded count, otherwise the recorded count. Says which one it used.
 */
export function valuationUnits(v: LedgerVerdict): {
  units: number | null;
  from: 'ledger' | 'recorded' | 'none';
} {
  if (
    v.reliable &&
    v.ledgerClosingUnits !== null &&
    v.lastTxnOn &&
    (v.positionUnits === null || !v.positionUnitsAsOf || v.positionUnitsAsOf < v.lastTxnOn)
  )
    return { units: v.ledgerClosingUnits, from: 'ledger' };
  if (v.positionUnits !== null) return { units: v.positionUnits, from: 'recorded' };
  return { units: null, from: 'none' };
}

/**
 * Money the units held before the first line are counted as having cost: their value at the first line's price on that day, so a
 * return is never read as a gain on units whose purchase is unknown. Null when there are no such units or no price to value them.
 */
export function openingFlow(
  lines: {
    date: string;
    units: number;
    amount: number;
    nav?: number | null;
    balance?: number | null;
  }[],
  unitTolerance: number,
): FundTxn | null {
  const sorted = orderLines(lines, unitTolerance);
  const first = sorted[0];
  if (!first || typeof first.balance !== 'number') return null;
  const opening = first.balance - first.units;
  if (!(opening > unitTolerance + SLACK)) return null;
  const nav =
    first.nav && first.nav > 0
      ? first.nav
      : first.units !== 0
        ? Math.abs(first.amount / first.units)
        : 0;
  return nav > 0 ? { date: first.date, units: opening, amount: opening * nav } : null;
}

export interface FundForSummary {
  assetId: string;
  name: string;
  startedOn: string | null;
  verdict: LedgerVerdict;
}

export interface FundNeed {
  assetId: string;
  name: string;
  status: LedgerStatus;
  why: string;
  fix: string;
}

export interface PersonLedgerSummary {
  ownerId: string;
  name: string;
  funds: number;
  complete: number;
  byStatus: Record<LedgerStatus, number>;
  /** the earliest transaction on file for any of the person's funds */
  earliestTxnOn: string | null;
  historyFrom: string;
  /** the earliest transaction is later than the date histories should start from, and funds started earlier */
  startsLate: boolean;
  headline: string;
  /** funds whose history needs something, with the plain reason */
  need: FundNeed[];
  /** one fix for the whole person, null when everything reconciles */
  fix: string | null;
  lateNote: string | null;
}

const WHY: Record<LedgerStatus, (v: LedgerVerdict) => string> = {
  complete: () => 'Reconciled.',
  starts_midway: (v) =>
    `Starts midway: ${unitsText(v.openingUnits ?? 0)} units were held before ${v.firstTxnOn ? niceIso(v.firstTxnOn) : 'the first line'}.`,
  gap: (v) => {
    const b = v.breaks[0];
    return b
      ? `Gap: lines missing ${b.from === b.to ? `on ${niceIso(b.to)}` : `between ${niceIso(b.from)} and ${niceIso(b.to)}`}${v.breaks.length > 1 ? ` (and ${v.breaks.length - 1} more place${v.breaks.length === 2 ? '' : 's'})` : ''}.`
      : 'Gap in the lines.';
  },
  mismatch: (v) =>
    `Doesn't match: the lines lead to ${unitsText(v.ledgerUnitsAtPositionDate ?? 0)} units, the fund records ${unitsText(v.positionUnits ?? 0)}.`,
  estimated: () => 'Only assumed monthly investments, no statement lines.',
  no_transactions: () => 'No transactions on file.',
};

/** For each person: how many funds reconcile, the earliest transaction on file and the funds that need history. */
export function ledgerSummary(
  owners: { ownerId: string; name: string; funds: FundForSummary[] }[],
  opts: { historyFrom: string; unitTolerance: number },
): PersonLedgerSummary[] {
  return owners.map((o) => {
    const byStatus: Record<LedgerStatus, number> = {
      complete: 0,
      starts_midway: 0,
      gap: 0,
      mismatch: 0,
      estimated: 0,
      no_transactions: 0,
    };
    for (const f of o.funds) byStatus[f.verdict.status]++;
    const firsts = o.funds.map((f) => f.verdict.firstTxnOn).filter((d): d is string => !!d);
    const earliest = firsts.length > 0 ? firsts.sort()[0]! : null;
    const need: FundNeed[] = o.funds
      .filter((f) => f.verdict.status !== 'complete')
      .map((f) => ({
        assetId: f.assetId,
        name: f.name,
        status: f.verdict.status,
        why: WHY[f.verdict.status](f.verdict),
        fix: f.verdict.fix ?? '',
      }));
    const startedEarlier = o.funds.some(
      (f) =>
        (earliest !== null && f.startedOn !== null && f.startedOn < earliest) ||
        (f.verdict.openingUnits ?? 0) > opts.unitTolerance,
    );
    const startsLate =
      o.funds.length > 0 &&
      (earliest === null ? true : earliest > opts.historyFrom && startedEarlier);
    const n = o.funds.length;
    const parts: string[] = [];
    if (byStatus.starts_midway > 0) parts.push(`${byStatus.starts_midway} need earlier history`);
    if (byStatus.gap > 0)
      parts.push(`${byStatus.gap} ${byStatus.gap === 1 ? 'has' : 'have'} missing lines`);
    if (byStatus.mismatch > 0)
      parts.push(
        `${byStatus.mismatch} ${byStatus.mismatch === 1 ? "doesn't" : "don't"} match the unit count`,
      );
    const none = byStatus.estimated + byStatus.no_transactions;
    if (none > 0) parts.push(`${none} ${none === 1 ? 'has' : 'have'} no statement lines yet`);
    const headline =
      n === 0
        ? 'No funds.'
        : `${byStatus.complete} of ${n} fund${n === 1 ? '' : 's'} reconcile${byStatus.complete === 1 ? 's' : ''} with their statements.${parts.length > 0 ? ` ${parts.join('; ')}.` : ''}`;
    const lateNote = startsLate
      ? earliest === null
        ? `No transaction is on file yet. Histories should start from ${niceIso(opts.historyFrom)}.`
        : `The earliest transaction on file is ${niceIso(earliest)}, later than ${niceIso(opts.historyFrom)}, and some funds started earlier.`
      : null;
    return {
      ownerId: o.ownerId,
      name: o.name,
      funds: n,
      complete: byStatus.complete,
      byStatus,
      earliestTxnOn: earliest,
      historyFrom: opts.historyFrom,
      startsLate,
      headline,
      need,
      fix:
        need.length > 0 || startsLate
          ? (ledgerAdvice(need[0]?.status ?? 'starts_midway', opts.historyFrom) ?? null)
          : null,
      lateNote,
    };
  });
}
