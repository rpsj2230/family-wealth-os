import type { Change } from './monthly';
import { parseAmount } from './monthly';

export interface GridEdit {
  amount?: string;
  fx?: string;
  status?: string;
  notes?: string;
  fdRate?: string;
  fdMaturityAmount?: string;
}

export interface GridRowInfo {
  id: string;
  kind: 'cash' | 'fd' | 'held';
  currency: string;
  notes: string;
  status: string;
  fd: { ratePct: string; maturityAmount: number } | null;
}

/** Turns what was typed into validated changes; one error message per row so the cell can show it. */
export function buildGridChanges(
  rows: GridRowInfo[],
  edits: Record<string, GridEdit>,
  asOf: string,
  today: string,
  fxHint: Record<string, number>,
): { changes: Change[]; errors: Record<string, string> } {
  const changes: Change[] = [];
  const errors: Record<string, string> = {};
  for (const r of rows) {
    const e = edits[r.id];
    if (!e) continue;
    const c: Change = { assetId: r.id };
    let touched = false;

    if (e.amount !== undefined && e.amount.trim() !== '') {
      const v = parseAmount(e.amount);
      if (v === null || v < 0) errors[r.id] = 'Enter a plain number, for example 125000.50';
      else if (asOf > today) errors[r.id] = 'The date cannot be in the future';
      else {
        c.amount = v;
        c.asOf = asOf;
        touched = true;
        if (r.currency !== 'INR') {
          const fx = e.fx && e.fx.trim() !== '' ? parseAmount(e.fx) : (fxHint[r.currency] ?? null);
          if (!fx || fx <= 0) errors[r.id] = `Enter the ${r.currency} to INR rate`;
          else c.fxRate = fx;
        }
      }
    }
    if (e.status !== undefined && e.status !== r.status) {
      c.status = e.status;
      touched = true;
    }
    if (e.notes !== undefined && e.notes.trim() !== r.notes.trim()) {
      c.notes = e.notes.trim();
      touched = true;
    }
    if (
      r.fd &&
      e.fdRate !== undefined &&
      e.fdRate.trim() !== '' &&
      e.fdRate.trim() !== r.fd.ratePct
    ) {
      const p = parseAmount(e.fdRate.replace('%', ''));
      if (p === null || p <= 0 || p >= 30)
        errors[r.id] = 'Rate must be between 0 and 30, for example 7.5';
      else {
        c.fdRate = Math.round(p * 1e4) / 1e6;
        touched = true;
      }
    }
    if (r.fd && e.fdMaturityAmount !== undefined && e.fdMaturityAmount.trim() !== '') {
      const m = parseAmount(e.fdMaturityAmount);
      if (m === null || m <= 0) errors[r.id] = 'Enter the maturity amount as a plain number';
      else if (Math.round(m) !== Math.round(r.fd.maturityAmount)) {
        c.fdMaturityAmount = m;
        touched = true;
      }
    }
    if (touched && !errors[r.id]) changes.push(c);
  }
  return { changes, errors };
}

export interface CarryRow {
  id: string;
  kind: 'cash' | 'fd' | 'held';
  status: string;
  /** the last recorded balance, in the account's own currency */
  recorded: number | null;
}

/**
 * "Nothing changed": fills the new-balance box of each typed line with its last recorded balance, so saving dates it today.
 * Lines that already have something typed, deposits (valued from their terms), closed lines and lines with no earlier
 * balance are left alone.
 */
export function carryForward(
  rows: CarryRow[],
  edits: Record<string, GridEdit>,
  only?: ReadonlySet<string>,
): { edits: Record<string, GridEdit>; filled: number } {
  const next = { ...edits };
  let filled = 0;
  for (const r of rows) {
    if (only && !only.has(r.id)) continue;
    if (r.kind === 'fd' || r.status === 'closed' || r.status === 'stopped') continue;
    if (r.recorded === null) continue;
    if ((next[r.id]?.amount ?? '').trim() !== '') continue;
    next[r.id] = { ...next[r.id], amount: String(r.recorded) };
    filled++;
  }
  return { edits: next, filled };
}

export interface PasteTarget {
  id: string;
}

/**
 * A column pasted from Excel or a bank app: one value per line, dropping into the boxes from the one pasted into.
 * Blank lines at the end are ignored; a blank line in the middle skips that box. Only the first column is used.
 * Returns null when it is a single value (which should paste normally).
 */
export function spreadPaste(
  text: string,
  boxes: PasteTarget[],
  startId: string,
  edits: Record<string, GridEdit>,
): Record<string, GridEdit> | null {
  const cells = text
    .split(/\r?\n/)
    .map((x) => x.split('\t')[0]!.trim())
    .filter((x, i, a) => x !== '' || i < a.length - 1);
  if (cells.length <= 1) return null;
  const start = boxes.findIndex((b) => b.id === startId);
  if (start < 0) return null;
  const next = { ...edits };
  cells.forEach((v, k) => {
    const box = boxes[start + k];
    if (box && v !== '') next[box.id] = { ...next[box.id], amount: v };
  });
  return next;
}

/** A typed balance this many times bigger or smaller than the last one is flagged as a likely typing slip (the bank-email reader uses the same range). */
export const TYPO_RATIO = 10;

export interface ChangeHint {
  text: string;
  warn: boolean;
}

const plain = (n: number, currency: string) =>
  `${currency === 'INR' ? '\u20b9' : `${currency} `}${Math.round(Math.abs(n)).toLocaleString('en-IN')}`;

/** What a typed balance means against the last one: "+\u20b91,200 (3.2%) since last", or a warning when it is very far off. */
export function changeHint(
  recorded: number | null,
  typed: string | undefined,
  currency = 'INR',
): ChangeHint | null {
  if (recorded === null || recorded <= 0 || typed === undefined || typed.trim() === '') return null;
  const v = parseAmount(typed);
  if (v === null || v < 0) return null;
  if (v === recorded) return { text: 'Same as last', warn: false };
  const ratio = v / recorded;
  if (ratio >= TYPO_RATIO)
    return {
      text: `About ${Math.round(ratio)} times the last balance. Check the digits.`,
      warn: true,
    };
  if (ratio <= 1 / TYPO_RATIO)
    return {
      text: `Less than a tenth of the last balance (${plain(recorded, currency)}). Check the digits.`,
      warn: true,
    };
  const diff = v - recorded;
  const pct = Math.abs(diff / recorded) * 100;
  return {
    text: `${diff < 0 ? '\u2212' : '+'}${plain(diff, currency)} (${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%) since last`,
    warn: false,
  };
}

/**
 * A typed balance against what the account's bank lines reach, while it is typed: the same (it follows from the lines), or how much
 * more or less, which is money that moved after the last line or a movement not on file. Null when there is nothing to compare.
 */
export function feedHint(
  check: { reach: number | null; on: string | null; ask: unknown[] } | undefined,
  typed: string | undefined,
): { text: string; warn: boolean } | null {
  if (!check || check.reach === null || !check.on || typed === undefined || typed.trim() === '')
    return null;
  const v = parseAmount(typed);
  if (v === null || v < 0) return null;
  const diff = Math.round((v - check.reach) * 100) / 100;
  const when = new Date(`${check.on}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
  if (Math.abs(diff) < 1) return { text: `Matches the bank lines (to ${when})`, warn: false };
  return {
    text: `${plain(Math.abs(diff), 'INR')} ${diff > 0 ? 'more' : 'less'} than the bank lines reach (${when}): money ${diff > 0 ? 'in' : 'out'} not on file yet. Check it below.`,
    warn: true,
  };
}
