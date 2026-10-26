/**
 * DICGC deposit-insurance position. Cover applies per bank, per depositor, per ownership capacity
 * (single name, or a specific joint-holder set), on principal PLUS accrued interest.
 * `limit` is a parameter (₹5,00,000 at the time of writing) because it is a rule that can change.
 */
export interface DepositForCover {
  id: string;
  bankId: string;
  /** e.g. "single:rupash" or "joint:rupash+ragini" — all deposits with the same key are aggregated */
  capacityKey: string;
  /** principal + accrued interest as of the calculation date */
  amountIncludingInterest: number;
}

export interface CoverRow {
  bankId: string;
  capacityKey: string;
  total: number;
  insured: number;
  uninsured: number;
  depositIds: string[];
}

export function dicgcPosition(deposits: DepositForCover[], limit: number) {
  if (!(limit > 0)) throw new RangeError('limit must be positive');
  const groups = new Map<string, CoverRow>();
  for (const d of deposits) {
    if (!(d.amountIncludingInterest >= 0))
      throw new RangeError(`invalid amount for deposit ${d.id}`);
    const key = `${d.bankId}||${d.capacityKey}`;
    const g = groups.get(key) ?? {
      bankId: d.bankId,
      capacityKey: d.capacityKey,
      total: 0,
      insured: 0,
      uninsured: 0,
      depositIds: [],
    };
    g.total += d.amountIncludingInterest;
    g.depositIds.push(d.id);
    groups.set(key, g);
  }
  const rows = [...groups.values()].map((g) => {
    const insured = Math.min(g.total, limit);
    return { ...g, insured, uninsured: g.total - insured };
  });
  const sum = (f: (r: CoverRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const byBank: Record<string, { total: number; uninsured: number }> = {};
  for (const r of rows) {
    const b = (byBank[r.bankId] ??= { total: 0, uninsured: 0 });
    b.total += r.total;
    b.uninsured += r.uninsured;
  }
  return {
    limit,
    rows,
    total: sum((r) => r.total),
    insured: sum((r) => r.insured),
    uninsured: sum((r) => r.uninsured),
    byBank,
  };
}
