import type { Freshness, SourceTag } from '@fwos/core';

export interface GridRow {
  id: string;
  name: string;
  owner: string;
  type: string;
  group: string;
  currency: string;
  /** 'value' = you type a new amount; 'fd' = contract-valued, only its status can change */
  mode: 'value' | 'fd';
  latestAmount: number | null;
  latestAsOf: string | null;
  freshness: Freshness | 'calculated';
  estimatedToday: number | null;
  fxRate: number | null;
  interestRate: number | null;
  tdsRate: number | null;
  status: string;
  /** how the latest value arrived (email, you, statement, sheet) */
  origin?: SourceTag;
  fd?: { principal: number; rate: number; maturityOn: string };
}

export interface RowEdit {
  amount?: string;
  asOf?: string;
  fxRate?: string;
  interestRate?: string;
  status?: string;
}

export interface Change {
  assetId: string;
  notes?: string;
  fdRate?: number;
  fdMaturityAmount?: number;
  amount?: number;
  asOf?: string;
  fxRate?: number;
  interestRate?: number | null;
  status?: string;
}

/** Accepts "₹1,23,456.50", "1 234,5" is NOT accepted (ambiguous); returns null when it is not a plain number. */
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/[₹\s,]/g, '');
  if (s === '' || !/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** "3", "3%", "3.25 %" -> 0.03 / 0.0325; empty -> null (clear the setting). Returns undefined when invalid. */
export function parsePercent(raw: string): number | null | undefined {
  const s = raw.replace(/[%\s]/g, '');
  if (s === '') return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return undefined;
  const n = Number(s) / 100;
  return n >= 0 && n < 1 ? Math.round(n * 1e6) / 1e6 : undefined;
}

export const FD_STATUSES = [
  ['active', 'Active'],
  ['matured_unconfirmed', 'Matured – not confirmed'],
  ['renewed', 'Renewed (new FD recorded separately)'],
  ['closed', 'Closed / paid out'],
] as const;

/** Convert the edits typed in the grid into validated changes; collects human-readable errors per row. */
export function buildChanges(rows: GridRow[], edits: Record<string, RowEdit>, todayIso: string) {
  const changes: Change[] = [];
  const errors: Record<string, string> = {};
  for (const row of rows) {
    const e = edits[row.id];
    if (!e) continue;
    const c: Change = { assetId: row.id };
    let touched = false;

    if (e.amount !== undefined && e.amount.trim() !== '') {
      const v = parseAmount(e.amount);
      if (v === null || v < 0)
        errors[row.id] = 'Enter a plain positive number, for example 125000.50';
      else {
        c.amount = v;
        touched = true;
      }
      const asOf = e.asOf || todayIso;
      if (asOf > todayIso) errors[row.id] = 'The date cannot be in the future';
      else if (touched) c.asOf = asOf;
      if (row.currency !== 'INR') {
        const fx =
          e.fxRate !== undefined && e.fxRate.trim() !== '' ? parseAmount(e.fxRate) : row.fxRate;
        if (!fx || fx <= 0) errors[row.id] = `Enter the ${row.currency} → INR rate`;
        else c.fxRate = fx;
      }
    }
    if (e.interestRate !== undefined) {
      const p = parsePercent(e.interestRate);
      if (p === undefined) errors[row.id] = 'Interest rate must be between 0 and 100';
      else if (p !== row.interestRate) {
        c.interestRate = p;
        touched = true;
      }
    }
    if (e.status !== undefined && e.status !== row.status) {
      c.status = e.status;
      touched = true;
    }
    if (touched && !errors[row.id]) changes.push(c);
  }
  return { changes, errors };
}
