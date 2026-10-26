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
