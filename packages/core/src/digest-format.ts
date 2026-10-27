/**
 * Small text helpers shared by the daily summary's pieces: rupees in lakh/crore form with a real minus sign, signed figures,
 * dates, and HTML escaping. Pure. Exact figures always stay available (title attributes, plain text).
 */
import { formatInr, formatInrCompact } from './money';

export const MINUS = '−';

/** Rupees, compact where large (₹1.25 Cr, ₹82.40 L), a true minus sign for a negative figure. */
export function inr(n: number): string {
  if (!Number.isFinite(n)) return '–';
  const abs = Math.abs(n);
  // a figure that would round up to "100.00 L" reads as the next unit
  // from 1,000 crore the crore figure is grouped too: ₹1,234.50 Cr
  const body =
    abs >= 1e10
      ? `₹${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(abs / 1e7)} Cr`
      : formatInrCompact(abs >= 9_999_500 && abs < 1e7 ? 1e7 : abs);
  return `${n < 0 && Math.round(abs) !== 0 ? MINUS : ''}${body}`;
}

/** The exact figure with Indian grouping, for a title attribute or the plain text. */
export const inrExact = (n: number): string =>
  `${n < 0 && Math.round(Math.abs(n)) !== 0 ? MINUS : ''}${formatInr(Math.abs(Math.round(n)))}`;

/** "+₹1.2 L" / "−₹3,400": always carries its sign, zero reads "₹0". */
export function signedInr(n: number): string {
  if (Math.round(Math.abs(n)) === 0) return '₹0';
  return `${n < 0 ? MINUS : '+'}${inr(Math.abs(n))}`;
}

/** "+1.2%" / "−0.4%" / "0.0%". */
export function signedPct(fraction: number | null, decimals = 1): string {
  if (fraction === null || !Number.isFinite(fraction)) return '';
  const v = Math.round(Math.abs(fraction) * 10 ** (decimals + 2)) / 10 ** decimals;
  if (fraction === 0) return `${(0).toFixed(decimals)}%`;
  return `${fraction < 0 ? MINUS : '+'}${v.toFixed(decimals)}%`;
}

export const plainPct = (fraction: number, decimals = 0): string =>
  `${(fraction * 100).toFixed(decimals)}%`;

/** Direction of a figure, for colour and arrow: zero (to the rupee) is flat. */
export const tone = (n: number): 'up' | 'down' | 'flat' =>
  Math.round(n) === 0 ? 'flat' : n > 0 ? 'up' : 'down';

export const ARROW = { up: '▲', down: '▼', flat: '▬' } as const;

export const niceDate = (d: string): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const dayMonth = (d: string): string =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const dayGap = (a: string, b: string): number =>
  Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);

/** 5 -> "5 months", 14 -> "1 year 2 months", 24 -> "2 years". */
export function monthsText(months: number): string {
  const m = Math.max(1, Math.round(months));
  if (m < 12) return `${m} month${m === 1 ? '' : 's'}`;
  const y = Math.floor(m / 12);
  const r = m % 12;
  return `${y} year${y === 1 ? '' : 's'}${r ? ` ${r} month${r === 1 ? '' : 's'}` : ''}`;
}
