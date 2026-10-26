/**
 * Keeping stored rates in step with what a bank's page says now, without ever overwriting a rate you typed or corrected, and
 * learning from corrections: when you fix a rate the reader got wrong, the likely reason is worked out and kept as a short rule
 * that the reader is given next time. Pure: the worker reads the rows, calls planSync, and applies the plan.
 */
import type { ParsedOffer } from './rates-ai';

export type CorrectionReason =
  'senior_citizen' | 'wrong_tenure' | 'wrong_slab' | 'nro_nre' | 'outdated' | 'other';

export interface Slot {
  bank: string;
  product: 'savings' | 'fd';
  accountKind: string;
  tenureFromMonths: number;
  tenureToMonths: number;
  balanceFrom: number | null;
  balanceTo: number | null;
}

export interface StoredOffer extends Slot {
  id: string;
  rate: number;
  sourceKind: 'manual' | 'ai';
  /** what the reader had read, when you replaced it with your own figure */
  aiRate: number | null;
  correctionReason: CorrectionReason | null;
  misreadCount: number;
}

const norm = (b: string) => b.toLowerCase().replace(/[^a-z0-9]/g, '');
/** One rate per bank, product, account type, term and balance slab. */
export const slotKey = (s: Slot) =>
  [
    norm(s.bank),
    s.product,
    s.accountKind,
    s.tenureFromMonths,
    s.tenureToMonths,
    s.balanceFrom ?? 0,
    s.balanceTo ?? -1,
  ].join('|');

const same = (a: number, b: number) => Math.abs(a - b) < 0.00005;
const pct = (r: number) => `${(r * 100).toFixed(2).replace(/\.?0+$/, '')}%`;
const lakh = (n: number) =>
  n >= 1e7 ? `₹${+(n / 1e7).toFixed(2)} Cr` : n >= 1e5 ? `₹${+(n / 1e5).toFixed(2)} L` : `₹${n}`;

/** "NRE fixed deposit, 24 months" / "savings, balance above ₹5 L". */
export function slotLabel(s: Slot): string {
  if (s.product === 'fd') {
    const t =
      s.tenureFromMonths === s.tenureToMonths
        ? `${s.tenureFromMonths} months`
        : `${s.tenureFromMonths}–${s.tenureToMonths} months`;
    return `${s.accountKind === 'any' ? '' : `${s.accountKind} `}fixed deposit, ${t}`;
  }
  const from = s.balanceFrom ?? 0;
  const slab =
    from === 0 && s.balanceTo === null
      ? 'any balance'
      : from === 0
        ? `balance up to ${lakh(s.balanceTo!)}`
        : s.balanceTo === null
          ? `balance above ${lakh(from)}`
          : `balance ${lakh(from)} to ${lakh(s.balanceTo)}`;
  return `${s.accountKind === 'any' ? '' : `${s.accountKind} `}savings, ${slab}`;
}

export interface Diagnosis {
  cause: CorrectionReason;
  /** a rule for the reader, one sentence or two */
  hint: string;
}

const HINT: Record<CorrectionReason, (label: string, right: string, wrong: string) => string> = {
  senior_citizen: (l, r, w) =>
    `For ${l}: the right rate is ${r}. ${w} is the senior-citizen rate; read the regular (non-senior) column.`,
  wrong_tenure: (l, r, w) =>
    `For ${l}: the right rate is ${r}. ${w} belongs to a neighbouring tenure band; read the row whose band contains exactly this tenure.`,
  wrong_slab: (l, r, w) =>
    `For ${l}: the right rate is ${r}. ${w} belongs to a neighbouring balance slab; match the rate to the exact balance range.`,
  nro_nre: (l, r, w) =>
    `For ${l}: the right rate is ${r}. ${w} is the rate for the other account type (NRE and NRO differ); use the table for this account type.`,
  outdated: (l, r, w) =>
    `For ${l}: the right rate is ${r}. ${w} comes from an older table on the page; use the table with the latest effective date.`,
  other: (l, r, w) => `For ${l}: the right rate is ${r}; it had been read as ${w}.`,
};

/**
 * Why a rate was read wrongly. A reason you chose is used as it is; otherwise the wrong figure is compared with the rest of the
 * page: a half-point or so above the right one looks like a senior-citizen rate, one that equals another band's rate looks like a
 * neighbouring row, and one that equals the other account type's rate looks like NRE and NRO mixed up.
 */
export function diagnoseMisread(args: {
  slot: Slot;
  wrong: number;
  right: number;
  fetched: ParsedOffer[];
  reason?: CorrectionReason | null;
}): Diagnosis {
  const { slot, wrong, right, fetched } = args;
  const mk = (cause: CorrectionReason): Diagnosis => ({
    cause,
    hint: HINT[cause](slotLabel(slot), pct(right), pct(wrong)),
  });
  if (args.reason && args.reason !== 'other') return mk(args.reason);
  const key = slotKey(slot);
  const others = fetched.filter(
    (f) => slotKey({ ...f, bank: slot.bank }) !== key && f.product === slot.product,
  );
  const diff = wrong - right;
  if (diff >= 0.0024 && diff <= 0.0076) return mk('senior_citizen');
  if (
    others.some(
      (o) =>
        o.accountKind !== slot.accountKind &&
        o.accountKind !== 'any' &&
        slot.accountKind !== 'any' &&
        same(o.rate, wrong),
    )
  )
    return mk('nro_nre');
  const sameKind = others.filter(
    (o) =>
      o.accountKind === slot.accountKind || o.accountKind === 'any' || slot.accountKind === 'any',
  );
  if (slot.product === 'fd' && sameKind.some((o) => same(o.rate, wrong))) return mk('wrong_tenure');
  if (slot.product === 'savings' && sameKind.some((o) => same(o.rate, wrong)))
    return mk('wrong_slab');
  return mk('other');
}

export interface SyncPlan {
  /** slots on the page that are not stored yet */
  insert: ParsedOffer[];
  /** rates the reader owns whose figure changed on the page */
  change: { id: string; from: number; to: number }[];
  /** rates the reader owns that are unchanged: only the check date moves */
  confirm: string[];
  /** a rate you typed that the page now disagrees with: shown to you, never applied */
  pageDiffers: { id: string; pageRate: number }[];
  /** a rate you typed that the page now agrees with: the difference marker is cleared */
  pageAgrees: string[];
  /** your correction is now what the page says, so the reader owns the rate again */
  resolved: string[];
  /** the reader still reads the old wrong figure: your correction stays, with a reason and a rule for next time */
  stillMisread: { id: string; wrong: number; right: number; diagnosis: Diagnosis }[];
  /** the page has moved on from both the wrong figure and your correction */
  pageMoved: { id: string; pageRate: number }[];
  /** reader-owned rates no longer on the page */
  remove: string[];
}

export function planSync(
  existing: StoredOffer[],
  fetched: ParsedOffer[],
  opts: { replaceAbsent: boolean },
): SyncPlan {
  const plan: SyncPlan = {
    insert: [],
    change: [],
    confirm: [],
    pageDiffers: [],
    pageAgrees: [],
    resolved: [],
    stillMisread: [],
    pageMoved: [],
    remove: [],
  };
  const byKey = new Map(existing.map((e) => [slotKey(e), e]));
  const seen = new Set<string>();
  for (const f of fetched) {
    const k = slotKey(f);
    if (seen.has(k)) continue;
    seen.add(k);
    const ex = byKey.get(k);
    if (!ex) {
      plan.insert.push(f);
    } else if (ex.sourceKind === 'ai') {
      if (same(ex.rate, f.rate)) plan.confirm.push(ex.id);
      else plan.change.push({ id: ex.id, from: ex.rate, to: f.rate });
    } else if (ex.aiRate !== null) {
      if (same(f.rate, ex.rate)) plan.resolved.push(ex.id);
      else if (same(f.rate, ex.aiRate))
        plan.stillMisread.push({
          id: ex.id,
          wrong: ex.aiRate,
          right: ex.rate,
          diagnosis: diagnoseMisread({
            slot: ex,
            wrong: ex.aiRate,
            right: ex.rate,
            fetched,
            reason: ex.correctionReason,
          }),
        });
      else plan.pageMoved.push({ id: ex.id, pageRate: f.rate });
    } else if (same(f.rate, ex.rate)) plan.pageAgrees.push(ex.id);
    else plan.pageDiffers.push({ id: ex.id, pageRate: f.rate });
  }
  if (opts.replaceAbsent)
    for (const e of existing)
      if (e.sourceKind === 'ai' && !seen.has(slotKey(e))) plan.remove.push(e.id);
  return plan;
}
