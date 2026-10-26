/**
 * Reads rates the way people jot them down, one bank per line:
 *   1. JanaBank - Saving [2.5%-1Lk, 3.50% - 1Lk to 5Lk, 7% - above 50 lk], NRE FD[8% -2 Yr]
 * Savings slabs: "2.5%-1Lk" = up to 1 lakh, "3.5% - 1Lk to 5Lk" = between, "7% - above 50 lk" or "7% > 50Lk" = more than.
 * Deposits: "8% -2 Yr", "8% -800 days (2.2 Yrs)", "7.4% -2.5 yrs". Pure; every line that cannot be read is reported, never guessed.
 */
export interface NoteOffer {
  bank: string;
  product: 'savings' | 'fd';
  accountKind: 'NRE' | 'NRO' | 'resident' | 'any';
  tenureFromMonths: number;
  tenureToMonths: number;
  tenureDays: number | null;
  /** yearly rate as a fraction: 0.0725 */
  rate: number;
  balanceFrom: number | null;
  balanceTo: number | null;
}

const UNIT: Record<string, number> = {
  lk: 1e5,
  lac: 1e5,
  lacs: 1e5,
  lakh: 1e5,
  lakhs: 1e5,
  l: 1e5,
  cr: 1e7,
  crore: 1e7,
  crores: 1e7,
  k: 1e3,
  '': 1,
};

/** "1Lk" → 100000, "2.5 lakh" → 250000, "10 cr" → 100000000. Null when there is no amount. */
export function parseAmount(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*(lakhs?|lacs?|lk|l|crores?|cr|k)?\b/i.exec(text);
  if (!m) return null;
  return Math.round(Number(m[1]) * (UNIT[(m[2] ?? '').toLowerCase()] ?? 1));
}

function parseSlab(rest: string): { from: number | null; to: number | null } | null {
  const r = rest.replace(/^[\s\-–—:]+/, '').trim();
  if (r === '') return { from: null, to: null };
  const range = /^>?\s*(.+?)\s*(?:\bto\b|[-–])\s*(.+)$/i.exec(r);
  if (range) {
    const unitOf = (t: string) => /(lakhs?|lacs?|lk|l|crores?|cr|k)\b/i.exec(t)?.[1] ?? '';
    // "5-10lk": the first figure shares the unit of the second
    const first = /[a-z]/i.test(range[1]!) ? range[1]! : `${range[1]!}${unitOf(range[2]!)}`;
    const a = parseAmount(first);
    const b = parseAmount(range[2]!);
    return a === null || b === null || b <= a ? null : { from: a, to: b };
  }
  const above = /^(?:>=?|above|over|more than)\s*(.+)$/i.exec(r);
  if (above) {
    const a = parseAmount(above[1]!);
    return a === null ? null : { from: a, to: null };
  }
  const upto = /^(?:up\s*to|upto|<=?|below|under)?\s*(.+)$/i.exec(r);
  const b = parseAmount(upto?.[1] ?? '');
  return b === null ? null : { from: null, to: b };
}

function parseTerm(rest: string): { months: number; days: number | null } | null {
  const r = rest.replace(/\(.*?\)/g, ' ');
  const m = /(\d+(?:\.\d+)?)\s*(years?|yrs?|y|months?|mos?|m|days?|d)\b/i.exec(r);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2]!.toLowerCase();
  if (u.startsWith('d'))
    return { months: Math.max(1, Math.round(n / 30.4375)), days: Math.round(n) };
  if (u.startsWith('y')) return { months: Math.round(n * 12), days: null };
  return { months: Math.round(n), days: null };
}

export function parseRateNotes(text: string): { offers: NoteOffer[]; problems: string[] } {
  const offers: NoteOffer[] = [];
  const problems: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const head = /^(?:\d+\s*[.)]\s*)?(.+?)\s+[-–—:]\s+(.*)$/.exec(line);
    if (!head) {
      problems.push(`Could not find a bank name in: ${line.slice(0, 60)}`);
      continue;
    }
    const bank = head[1]!.trim();
    const body = head[2]!;
    let found = 0;
    for (const g of body.matchAll(
      /(?:\b(NRE|NRO)\s*)?\b(savings?|fd|fixed\s*deposit)\s*\[([^\]]*)\]/gi,
    )) {
      const kind = (g[1]?.toUpperCase() as 'NRE' | 'NRO' | undefined) ?? 'any';
      const product = /^s/i.test(g[2]!) ? 'savings' : 'fd';
      for (const entry of g[3]!.split(',')) {
        const e = entry.trim();
        if (!e) continue;
        const m = /^(\d+(?:\.\d+)?)\s*%\s*(.*)$/.exec(e);
        if (!m) {
          problems.push(`${bank}: could not read "${e}"`);
          continue;
        }
        const pct = Number(m[1]);
        if (!(pct >= 0.5 && pct <= 20)) {
          problems.push(`${bank}: ${pct}% looks wrong`);
          continue;
        }
        const rate = Math.round(pct * 100) / 10_000;
        if (product === 'savings') {
          const slab = parseSlab(m[2]!);
          if (!slab) {
            problems.push(`${bank}: could not read the balance in "${e}"`);
            continue;
          }
          offers.push({
            bank,
            product,
            accountKind: kind,
            tenureFromMonths: 0,
            tenureToMonths: 0,
            tenureDays: null,
            rate,
            balanceFrom: slab.from,
            balanceTo: slab.to,
          });
        } else {
          const term = parseTerm(m[2]!);
          if (!term) {
            problems.push(`${bank}: could not read the term in "${e}"`);
            continue;
          }
          offers.push({
            bank,
            product,
            accountKind: kind,
            tenureFromMonths: term.months,
            tenureToMonths: term.months,
            tenureDays: term.days,
            rate,
            balanceFrom: null,
            balanceTo: null,
          });
        }
        found++;
      }
    }
    if (found === 0) problems.push(`${bank}: no rates found in the line`);
  }
  return { offers, problems };
}
