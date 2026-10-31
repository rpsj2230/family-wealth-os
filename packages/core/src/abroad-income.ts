/**
 * Money that arrives in, or leaves, the family's accounts abroad (Singapore) with no transfer on file to explain it: by its nature
 * the family's income (salary) when the balance rises, and money spent abroad when it falls. Those accounts have balances but no
 * statements, so without this rule every salary would stay "not yet explained" forever.
 *
 * Between two balances of an account abroad, in its own currency: the change, less the transfers on file into and out of it (Wise to
 * India, between the family's accounts), is money from outside, dated the later balance and valued at its exchange rate. Exchange
 * rate moves are left to earnings, as they are worked out in the account's currency. Pure: no I/O.
 */
import type { LedgerMove } from './capital';
import type { PositionInput } from './position';

export interface AbroadMove {
  movedOn: string;
  amount: number;
  currency: string;
  fromAssetId: string | null;
  toAssetId: string | null;
  status: string;
}

export function abroadIncomeMoves(
  position: PositionInput,
  moves: readonly AbroadMove[],
  /** Settings: a change smaller than this many rupees is left as it is */
  minimum = 1,
): LedgerMove[] {
  const out: LedgerMove[] = [];
  const confirmed = moves.filter((m) => m.status === 'confirmed');
  for (const a of position.assets) {
    if (a.type !== 'bank_account' || a.currency === 'INR' || a.status === 'gifted') continue;
    const recs = [
      ...new Map(a.records.filter((r) => !r.sheet).map((r) => [r.date, r])).values(),
    ].sort((x, y) => x.date.localeCompare(y.date));
    // the rate on the record, else the latest on file on or before its day
    const series = position.config.fx?.[a.currency] ?? [];
    const rate = (r: (typeof recs)[number]) =>
      r.fxRate ?? series.filter((x) => x.date <= r.date).pop()?.rate ?? series[0]?.rate ?? null;
    for (let i = 1; i < recs.length; i++) {
      const r1 = recs[i - 1]!;
      const r2 = recs[i]!;
      const fx = rate(r2);
      if (!fx || !(fx > 0)) continue;
      // the transfers on file in the stretch, in the account's own currency
      let moved = 0;
      for (const m of confirmed) {
        if (m.movedOn <= r1.date || m.movedOn > r2.date) continue;
        const sign = m.toAssetId === a.assetId ? 1 : m.fromAssetId === a.assetId ? -1 : 0;
        if (!sign) continue;
        moved += sign * (m.currency === a.currency ? m.amount : m.amount / fx);
      }
      const rest = r2.amount - r1.amount - moved;
      const inr = Math.round(rest * fx * 100) / 100;
      if (Math.abs(inr) < minimum) continue;
      out.push({ date: r2.date, amount: inr, kind: 'external' });
    }
  }
  return out;
}
