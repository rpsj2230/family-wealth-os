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
