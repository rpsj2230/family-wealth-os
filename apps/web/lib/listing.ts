/**
 * The rules behind search, filter, sort and export on every listing. Pure, so they are tested without a browser.
 * A cell's text is read as a number when it looks like one (₹1,23,456 · +4.2% · −500 · 12.5), as a date when it looks like one,
 * and as text otherwise; empty cells and dashes always sort last.
 */
export type CellValue =
  | { kind: 'num'; n: number }
  | { kind: 'date'; t: number }
  | { kind: 'text'; s: string }
  | { kind: 'empty' };

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

export function parseCell(raw: string): CellValue {
  const t = raw.replace(/\s+/g, ' ').trim();
  if (t === '' || /^[–—-]+$/.test(t)) return { kind: 'empty' };
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (iso) return { kind: 'date', t: Date.UTC(+iso[1]!, +iso[2]! - 1, +iso[3]!) };
  const dmy = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})/.exec(t);
  if (dmy && MONTHS.includes(dmy[2]!.toLowerCase()))
    return { kind: 'date', t: Date.UTC(+dmy[3]!, MONTHS.indexOf(dmy[2]!.toLowerCase()), +dmy[1]!) };
  // a number, possibly with a currency sign, thousands marks, sign, % or a short unit; text after it is ignored
  const m =
    /^([+−-]?)\s*(?:₹|Rs\.?|INR|SGD|S\$|\$)?\s*([+−-]?)\s*(\d[\d,]*(?:\.\d+)?)\s*(%|L|Cr|k|d|mo|days?)?\b/.exec(
      t,
    );
  if (m) {
    let n = Number(m[3]!.replace(/,/g, ''));
    if (m[4] === 'L') n *= 1e5;
    if (m[4] === 'Cr') n *= 1e7;
    if (m[4] === 'k') n *= 1e3;
    return {
      kind: 'num',
      n: m[1] === '−' || m[1] === '-' || m[2] === '−' || m[2] === '-' ? -n : n,
    };
  }
  return { kind: 'text', s: t.toLowerCase() };
}

/** Ascending order; empty values are last in both directions (the caller flips only non-empty ones). */
export function compareCells(a: CellValue, b: CellValue): number {
  if (a.kind === 'empty' || b.kind === 'empty')
    return a.kind === b.kind ? 0 : a.kind === 'empty' ? 1 : -1;
  if (a.kind === 'num' && b.kind === 'num') return a.n - b.n;
  if (a.kind === 'date' && b.kind === 'date') return a.t - b.t;
  const sa = a.kind === 'text' ? a.s : String('n' in a ? a.n : (a as { t: number }).t);
  const sb = b.kind === 'text' ? b.s : String('n' in b ? b.n : (b as { t: number }).t);
  return sa.localeCompare(sb, 'en', { numeric: true });
}

export function sortKeyed<T>(items: T[], key: (x: T) => CellValue, dir: 1 | -1): T[] {
  return items
    .map((x, i) => ({ x, i, v: key(x) }))
    .sort((p, q) => {
      if (p.v.kind === 'empty' || q.v.kind === 'empty') return compareCells(p.v, q.v) || p.i - q.i;
      return compareCells(p.v, q.v) * dir || p.i - q.i;
    })
    .map((p) => p.x);
}

/**
 * A column filter. Plain text: contains. For numbers and dates: ">100000", "<=5", "=0", a range "10..20", or "2026-11..2027-03".
 * Several conditions can be joined with a comma (all must hold). An empty expression matches everything.
 */
export function matchesFilter(raw: string, expr: string): boolean {
  const e = expr.trim();
  if (e === '') return true;
  const v = parseCell(raw);
  return e.split(',').every((part) => matchPart(raw, v, part.trim()));
}

function numOrDate(s: string): number | null {
  const c = parseCell(s);
  return c.kind === 'num' ? c.n : c.kind === 'date' ? c.t : null;
}

function matchPart(raw: string, v: CellValue, p: string): boolean {
  if (p === '') return true;
  const range = /^(.+?)\.\.(.+)$/.exec(p);
  if (range) {
    const a = numOrDate(range[1]!.trim());
    const b = numOrDate(range[2]!.trim());
    const x = v.kind === 'num' ? v.n : v.kind === 'date' ? v.t : null;
    return x !== null && a !== null && b !== null && x >= Math.min(a, b) && x <= Math.max(a, b);
  }
  const op = /^(>=|<=|>|<|=|!=)\s*(.+)$/.exec(p);
  if (op) {
    const rhs = numOrDate(op[2]!);
    const x = v.kind === 'num' ? v.n : v.kind === 'date' ? v.t : null;
    if (rhs === null || x === null) {
      // not numeric: = and != compare the text
      if (op[1] === '=') return raw.trim().toLowerCase() === op[2]!.trim().toLowerCase();
      if (op[1] === '!=') return raw.trim().toLowerCase() !== op[2]!.trim().toLowerCase();
      return false;
    }
    switch (op[1]) {
      case '>':
        return x > rhs;
      case '<':
        return x < rhs;
      case '>=':
        return x >= rhs;
      case '<=':
        return x <= rhs;
      case '=':
        return x === rhs;
      default:
        return x !== rhs;
    }
  }
  if (p.startsWith('!')) return !raw.toLowerCase().includes(p.slice(1).trim().toLowerCase());
  return raw.toLowerCase().includes(p.toLowerCase());
}

/** Every word typed must appear somewhere in the row. */
export function matchesSearch(rowText: string, q: string): boolean {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const t = rowText.toLowerCase();
  return words.every((w) => t.includes(w));
}

const csvCell = (v: string) => {
  const t = v.replace(/\s+/g, ' ').trim();
  // a spreadsheet would run a cell that starts with = + @ or a dash followed by a letter
  const safe = /^[=+@]/.test(t) || /^-[^\d₹.\s]/.test(t) ? `'${t}` : t;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows: string[][]): string {
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
