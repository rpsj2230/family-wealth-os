/**
 * "Saved this FY" by tag, from the bank lines: the money that came into the family or left it in a stretch, grouped by what it was
 * (salary, money back, shopping, money given…). Lines that only move money between the family's own holdings (between accounts, into
 * or out of a deposit or a fund) are left out, as are earnings (interest, rent, other earnings, charges and tax), which belong to
 * "Earned". A line still to be answered counts here, as the ledger counts it (money moved in or out, never profit).
 *
 * The bank lines are not the whole picture: money from Singapore with no line, deposits and funds recorded without a line, and
 * balance changes no statement explains. So the result carries the difference to the ledger's figure as its own row, and the rows
 * always add up to "Saved this FY" exactly. Pure: no I/O.
 */
import type { Classified, LineClass } from './statement-classify';

/** The kinds of line that are money crossing the family's edge (and not earnings). */
const OUTSIDE: ReadonlySet<LineClass> = new Set(['outside_in', 'spent', 'ask_in', 'ask_out']);

export interface SavedTagRow {
  /** the category id; null for lines with no tag */
  tag: string | null;
  into: number;
  out: number;
  /** into − out */
  net: number;
  lines: number;
}

export interface SavedByTag {
  rows: SavedTagRow[];
  /** the net of all tagged rows */
  onLines: number;
  /** the ledger's figure less the bank lines: money with no bank line behind it */
  notOnLines: number;
  /** the ledger's figure, which the rows add up to */
  total: number;
  /** lines placed by best guess, of those counted */
  bestGuess: number;
}

export function savedByTag(
  lines: readonly { id: string; date: string; amount: number }[],
  classified: readonly Classified[],
  from: string,
  to: string,
  ledgerSaved: number,
): SavedByTag {
  const cls = new Map(classified.map((c) => [c.id, c]));
  const by = new Map<string | null, SavedTagRow>();
  let bestGuess = 0;
  for (const l of lines) {
    // the ledger's months run from their first day up to the next month's first day (exclusive)
    if (l.date < from || l.date >= to) continue;
    const c = cls.get(l.id);
    if (!c || !OUTSIDE.has(c.cls)) continue;
    const tag = c.category ?? null;
    const row = by.get(tag) ?? { tag, into: 0, out: 0, net: 0, lines: 0 };
    if (l.amount >= 0) row.into += l.amount;
    else row.out -= l.amount;
    row.net = row.into - row.out;
    row.lines++;
    by.set(tag, row);
    if (c.reason.startsWith('Best guess')) bestGuess++;
  }
  const rows = [...by.values()].sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  const onLines = rows.reduce((a, r) => a + r.net, 0);
  return { rows, onLines, notOnLines: ledgerSaved - onLines, total: ledgerSaved, bestGuess };
}
