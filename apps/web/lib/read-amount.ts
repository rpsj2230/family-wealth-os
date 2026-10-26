import { parseAmount } from '@fwos/core';

/** "2500000", "₹25,00,000" and "25 lakh" all read as an amount in rupees; anything else is no amount (0). */
export function readAmount(s: string | undefined | null): number {
  const raw = String(s ?? '').trim();
  if (!raw || raw.startsWith('-')) return 0;
  const plain = Number(raw.replace(/[₹,\s]/g, ''));
  if (Number.isFinite(plain) && plain > 0) return Math.round(plain);
  return parseAmount(raw) ?? 0;
}
