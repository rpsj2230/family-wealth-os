import Decimal from 'decimal.js';

/** Exact decimal sum (avoids floating-point drift when adding many balances). */
export function sumExact(values: number[]): number {
  return values
    .reduce((s, v) => s.plus(v), new Decimal(0))
    .toDecimalPlaces(2)
    .toNumber();
}

export function round2(v: number): number {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

/** Indian digit grouping: 19179860 -> "1,91,79,860". */
export function formatInr(
  amount: number,
  opts: { decimals?: number; symbol?: boolean } = {},
): string {
  const decimals = opts.decimals ?? 0;
  const body = new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount);
  return (opts.symbol === false ? '' : '₹') + body;
}

/** Compact lakh/crore form used on small screens: 19179860 -> "₹1.92 Cr", 465453 -> "₹4.65 L". */
export function formatInrCompact(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return `${sign}₹${new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 }).format(abs)}`;
}

/** A share as a percentage: 0.1234 -> "12.3%". Small non-zero shares never read as 0 ("<0.1%"). */
export function formatPct(fraction: number, decimals = 1): string {
  if (!Number.isFinite(fraction)) return '–';
  const v = fraction * 100;
  const min = 10 ** -decimals;
  if (v !== 0 && Math.abs(v) < min) return `${v < 0 ? '-' : ''}<${min.toFixed(decimals)}%`;
  return `${v.toFixed(decimals)}%`;
}
