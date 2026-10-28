/**
 * Cash held in another currency (a Singapore dollar savings account), shown beside the rupee Cash figure and never instead of it.
 *
 * The Cash figure everywhere is the rupee total of ALL cash: rupee accounts plus every foreign account at today's rupee value, exactly
 * as net worth counts them. This module only answers "how much of that is in each foreign currency?": the balance in its own currency
 * (from the latest recorded balance), what it is worth in rupees today (the figure net worth already uses, taken from the valued
 * asset, never worked out again here), and the rate that implies (rupees / balance). Nothing here changes a total.
 *
 * Which rate and which date: the rupee value comes from `buildPortfolio`, which uses the latest exchange rate on file (the `fx_rates`
 * table, refreshed every day) and, with none, the rate recorded with the balance. `datedForeignCash` tells which of the two a figure
 * rests on by comparing the implied rate with the rate on file, and gives that rate's date (or the date of the recorded balance).
 */
import type { BankRow } from './accounts-view';
import { formatInrCompact } from './money';
import { isCounted, type ValuedAsset } from './networth';
import { latestObservations, type AssetRow, type ObservationRow } from './portfolio';

/** One foreign-currency account, before it is added to the others of its currency. */
export interface ForeignCashItem {
  currency: string;
  /** the balance in its own currency */
  native: number;
  /** what it is worth in rupees today, as net worth counts it */
  inr: number;
  /** the date the balance was recorded (YYYY-MM-DD) */
  asOf?: string | null;
}

/** All the accounts of one foreign currency added together. */
export interface ForeignCashPart {
  currency: string;
  native: number;
  inr: number;
  /** rupees per unit of that currency: inr / native */
  rate: number;
  accounts: number;
  /** the latest date a balance of this currency was recorded */
  asOf: string | null;
}

/** A foreign-currency part with the date of the rate behind its rupee value. */
export interface ForeignCash extends ForeignCashPart {
  /** date of the exchange rate used; the date of the recorded balance when no rate on file was used */
  rateDate: string | null;
  /** the rupee value rests on the daily rate on file (true) or on the rate recorded with the balance (false) */
  rateLive: boolean;
}

/** The latest exchange rate on file per currency (rupees per unit and its date), as the data layer loads it. */
export type FxOnFile = Record<string, { rate: number; date: string }>;

/** Add the accounts of each currency together, the currency with most rupees first. Empty balances are left out. */
export function sumForeignCash(items: ForeignCashItem[]): ForeignCashPart[] {
  const by = new Map<
    string,
    { native: number; inr: number; accounts: number; asOf: string | null }
  >();
  for (const it of items) {
    if (!it.currency || it.currency === 'INR') continue;
    if (!Number.isFinite(it.native) || !Number.isFinite(it.inr) || it.native === 0) continue;
    const cur = by.get(it.currency) ?? { native: 0, inr: 0, accounts: 0, asOf: null };
    cur.native += it.native;
    cur.inr += it.inr;
    cur.accounts++;
    if (it.asOf && (!cur.asOf || it.asOf > cur.asOf)) cur.asOf = it.asOf;
    by.set(it.currency, cur);
  }
  return [...by.entries()]
    .map(([currency, v]) => ({
      currency,
      native: v.native,
      inr: v.inr,
      rate: v.native !== 0 ? v.inr / v.native : 0,
      accounts: v.accounts,
      asOf: v.asOf,
    }))
    .filter((p) => p.native !== 0)
    .sort((a, b) => b.inr - a.inr || a.currency.localeCompare(b.currency));
}

/** Parts of two groups (two people of a bank, two banks of a household) added together again, by currency. */
export function mergeForeignCash(...groups: ForeignCashPart[][]): ForeignCashPart[] {
  const raw: ForeignCashItem[] = [];
  const counts = new Map<string, number>();
  for (const g of groups)
    for (const p of g) {
      raw.push({ currency: p.currency, native: p.native, inr: p.inr, asOf: p.asOf });
      counts.set(p.currency, (counts.get(p.currency) ?? 0) + p.accounts);
    }
  return sumForeignCash(raw).map((p) => ({ ...p, accounts: counts.get(p.currency) ?? p.accounts }));
}

/** What a savings row of the accounts view adds, or null when it is not foreign cash that counts. */
export function rowForeignItem(r: BankRow): ForeignCashItem | null {
  if (r.kind !== 'cash' || r.currency === 'INR') return null;
  if (r.status === 'closed' || r.status === 'stopped') return null;
  if (r.current === null || r.recorded === null) return null;
  return { currency: r.currency, native: r.recorded, inr: r.current, asOf: r.asOf };
}

/**
 * Say which exchange rate each part rests on. A part rests on the rate on file when the rate it implies equals that rate (the
 * rupee value is the balance times today's rate); otherwise the portfolio fell back to the rate recorded with the balance.
 */
export function datedForeignCash(parts: ForeignCashPart[], fx: FxOnFile = {}): ForeignCash[] {
  return parts.map((p) => {
    const onFile = fx[p.currency];
    const live = !!onFile && Math.abs(onFile.rate - p.rate) <= 1e-6 * Math.max(1, onFile.rate);
    return { ...p, rateLive: live, rateDate: live ? onFile!.date : p.asOf };
  });
}

/**
 * The foreign cash of a household (or of one person or bank) from the same inputs net worth uses: the valued assets give the rupee
 * value, the latest balance gives the amount in its own currency. Only bank accounts that count in net worth are included, so the
 * rupee figures here are always a part of the Cash figure and the total itself is untouched.
 */
export function foreignCash(
  assets: Pick<AssetRow, 'id' | 'owner_id' | 'type' | 'currency' | 'institution_id'>[],
  valued: ValuedAsset[],
  observations: ObservationRow[],
  fx: FxOnFile = {},
  scope: { ownerId?: string; institutionId?: string } = {},
): ForeignCash[] {
  const latest = latestObservations(observations);
  const val = new Map(valued.map((v) => [v.assetId, v]));
  const items: ForeignCashItem[] = [];
  for (const a of assets) {
    if (a.type !== 'bank_account' || a.currency === 'INR') continue;
    if (scope.ownerId && a.owner_id !== scope.ownerId) continue;
    if (scope.institutionId && (a.institution_id ?? null) !== scope.institutionId) continue;
    const v = val.get(a.id);
    const o = latest.get(a.id);
    if (!v || !o || !isCounted(v)) continue;
    items.push({
      currency: a.currency,
      native: o.amount,
      inr: v.estimate!.estimatedAmount,
      asOf: o.as_of,
    });
  }
  return datedForeignCash(sumForeignCash(items), fx);
}

// ------------------------------------------------------------------------------------------------
// Words
// ------------------------------------------------------------------------------------------------
/** Symbols for the currencies a household is likely to hold. Any other currency is written with its three-letter code. */
const SYMBOL: Record<string, string> = {
  SGD: 'S$',
  USD: 'US$',
  EUR: '€',
  GBP: '£',
  AUD: 'A$',
  CAD: 'C$',
  NZD: 'NZ$',
  HKD: 'HK$',
  JPY: '¥',
  CHF: 'CHF',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "27 Oct" from 2026-10-27. */
export function shortDay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim();
}

/** A balance in its own currency: "S$ 41,250" (the symbol, or the code when there is none), thousands grouped the usual way. */
export function formatForeign(amount: number, currency: string): string {
  const sign = amount < 0 ? '-' : '';
  const body = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(
    Math.abs(Math.round(amount)),
  );
  return `${sign}${SYMBOL[currency] ?? currency} ${body}`;
}

/** The rate with as many places as it needs and no trailing zeros: 56.1, 83.52, 0.5612. */
export function formatRate(rate: number): string {
  const places = rate >= 10 ? 2 : rate >= 1 ? 3 : 4;
  return String(Number(rate.toFixed(places)));
}

/** "1 SGD = ₹56.1, rate of 27 Oct": the rate used and where it is from ("rate recorded 30 Sep" when it is the one saved with the balance). */
export function foreignRateWords(f: ForeignCash): string {
  const when = f.rateDate
    ? f.rateLive
      ? `, rate of ${shortDay(f.rateDate)}`
      : `, rate recorded ${shortDay(f.rateDate)}`
    : '';
  return `1 ${f.currency} = ₹${formatRate(f.rate)}${when}`;
}

/** "≈ ₹23.10 L at 1 SGD = ₹56.1, rate of 27 Oct": the small second line under the foreign balance. */
export function foreignRupeeLine(f: ForeignCash): string {
  return `≈ ${formatInrCompact(f.inr)} at ${foreignRateWords(f)}`;
}

/** The two figures in one short phrase, for a header or a message: "S$ 41,250 ≈ ₹23.10 L". */
export function foreignShort(f: Pick<ForeignCashPart, 'currency' | 'native' | 'inr'>): string {
  return `${formatForeign(f.native, f.currency)} ≈ ${formatInrCompact(f.inr)}`;
}

/** The same in the exact words a hover or a screen reader gets: balance, rupees, the rate and its date. */
export function foreignTitle(f: ForeignCash): string {
  return `${formatForeign(f.native, f.currency)} ${foreignRupeeLine(f)}`;
}

/**
 * What the "?" says about foreign cash: one sentence that tells how it sits inside the Cash figure and how its rate was chosen, and one
 * line per currency for the list of inputs. Null when there is no foreign cash.
 */
export function foreignExplain(list: ForeignCash[]): {
  sentence: string;
  lines: { label: string; value: string; to: string | null; note: string; live: boolean }[];
} | null {
  if (list.length === 0) return null;
  const total = list.reduce((s, f) => s + f.inr, 0);
  const each = list
    .map(
      (f) =>
        `${foreignShort(f)} (${f.accounts === 1 ? '1 account' : `${f.accounts} accounts`}, ${foreignRateWords(f)})`,
    )
    .join('; ');
  return {
    sentence:
      `Part of this cash is held in ${list.map((f) => f.currency).join(', ')} and is shown on its own in small type under the figure: ${each}. ` +
      `That ${formatInrCompact(total)} is already inside the figure, counted at the latest exchange rate on file (refreshed every day from a public source); ` +
      'with no rate on file the rate recorded with the balance is used, and the line says so. ' +
      'The rate shown is the rupee value divided by the balance. A change in the rate moves the rupee value, not the balance, and is not counted as interest.',
    lines: list.map((f) => ({
      label: `Held in ${f.currency}`,
      value: foreignShort(f),
      to: f.rateDate,
      note: foreignRateWords(f),
      live: f.rateLive,
    })),
  };
}
