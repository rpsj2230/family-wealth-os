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
  /** what the deposit is, so a row of the cover can show what it is made of */
  label?: string;
  kind?: string;
  status?: string;
}

export interface CoverPart {
  id: string;
  label: string;
  kind: string;
  status: string;
  amount: number;
}

export interface CoverRow {
  bankId: string;
  capacityKey: string;
  total: number;
  insured: number;
  uninsured: number;
  depositIds: string[];
  /** every deposit counted in this row: savings, fixed deposits and the rest of the same bank and name are added together */
  parts: CoverPart[];
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
      parts: [] as CoverPart[],
    };
    g.total += d.amountIncludingInterest;
    g.depositIds.push(d.id);
    g.parts.push({
      id: d.id,
      label: d.label ?? d.id,
      kind: d.kind ?? 'Deposit',
      status: d.status ?? 'active',
      amount: d.amountIncludingInterest,
    });
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

/**
 * How much of a cover position is over the limit, counted the way a person reads it: holdings are the rows of the cover (one bank
 * and one name each), so "23 of 27 bank-and-name holdings over ₹5 L"; banks counts the banks with at least one such holding.
 */
export function coverCounts(pos: {
  rows: { bankId: string; uninsured: number }[];
}): { holdings: number; holdingsOver: number; banksOver: number } {
  const over = pos.rows.filter((r) => r.uninsured > 0);
  return {
    holdings: pos.rows.length,
    holdingsOver: over.length,
    banksOver: new Set(over.map((r) => r.bankId)).size,
  };
}

/**
 * The ownership name an account is held in, as written. Cover is counted per bank and per name: "single:A" for one holder,
 * "joint:A+B" for joint holders in that order (A & B and B & A are different names, each insured separately), and "joint:A+?"
 * when the account is joint but the second holder is not recorded yet.
 */
export function capacityKeyFor(a: {
  ownerId: string;
  isJoint: boolean;
  jointHolderId?: string | null;
}): string {
  if (!a.isJoint) return `single:${a.ownerId}`;
  return `joint:${a.ownerId}+${a.jointHolderId ?? '?'}`;
}

/** "Rupash", "Rupash & Ragini", "Rupash & (partner not set)". */
export function capacityLabel(key: string, names: Record<string, string>): string {
  const [kind, who = ''] = key.split(':');
  const name = (id: string) => (id === '?' ? '(partner not set)' : (names[id] ?? '—'));
  return kind === 'joint' ? who.split('+').map(name).join(' & ') : name(who);
}

/** True for a joint capacity whose second holder is not recorded. */
export const partnerMissing = (key: string) => key.startsWith('joint:') && key.endsWith('+?');
