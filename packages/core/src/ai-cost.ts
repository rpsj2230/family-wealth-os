/**
 * What the AI has cost. Every call to an AI service is logged with the tokens it used (see packages/ingest ai-usage); the cost is worked
 * out here, when it is shown, from the prices in Settings, so a corrected price re-prices the whole history. A model with no price set is
 * counted in tokens and calls but not in money, and the page says so. Pure: no clock, no database.
 */

/** What the AI was asked to do, in the words of the cost page. The keys are what the usage log stores. */
export const AI_PURPOSE_LABEL = {
  inbox_email: 'Bank emails',
  inbox_statement: 'Bank statements (PDF)',
  rates_refresh: 'Bank rates refresh',
  rates_check: 'Bank rates check',
  rates_paste: 'Pasted rate page',
  tax_file: 'Tax files (26AS, AIS)',
  ai_test: 'Key and chain tests',
  other: 'Other',
} as const;
export type AiPurposeKey = keyof typeof AI_PURPOSE_LABEL;

/** Dollars per million tokens. */
export interface AiPrice {
  /** a model id, or a pattern: "claude-haiku*" (starts with) or "*:free" (ends with) */
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const round6 = (x: number) => Math.round(x * 1e6) / 1e6;

/**
 * One price per line: `model = input / output [/ cache read / cache write]`, in dollars per million tokens. When the cache prices are
 * left out they are the usual multiples of the input price (a cache read costs a tenth of it, a cache write a quarter more).
 */
export function parsePriceLine(line: string): AiPrice | { error: string } {
  const m = /^\s*([^=\s][^=]*?)\s*=\s*([\d.\s/]+)\s*$/.exec(line);
  if (!m)
    return {
      error: `“${line.trim()}” is not written as: model = input / output / cache read / cache write`,
    };
  const nums = m[2]!
    .split('/')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map(Number);
  if (
    nums.length < 2 ||
    nums.length > 4 ||
    nums.some((n) => !Number.isFinite(n) || n < 0 || n > 1000)
  )
    return {
      error: `“${line.trim()}”: give 2 to 4 prices in dollars per million tokens, separated by “/”`,
    };
  const [input, output, cacheRead, cacheWrite] = nums as [number, number, number?, number?];
  return {
    model: m[1]!.trim().toLowerCase(),
    input,
    output,
    cacheRead: cacheRead ?? round6(input * 0.1),
    cacheWrite: cacheWrite ?? round6(input * 1.25),
  };
}

/** Every valid line; a line that cannot be read is left out (Settings refuses to save one, so this only guards old data). */
export function parsePrices(lines: readonly string[]): AiPrice[] {
  return lines.map(parsePriceLine).filter((p): p is AiPrice => !('error' in p));
}

const matches = (pattern: string, model: string): boolean =>
  pattern.startsWith('*')
    ? model.endsWith(pattern.slice(1))
    : pattern.endsWith('*')
      ? model.startsWith(pattern.slice(0, -1))
      : model === pattern;

/** The price that applies to a model: the most specific pattern (the longest) that matches. Null when none does. */
export function priceFor(prices: readonly AiPrice[], model: string | null): AiPrice | null {
  if (!model) return null;
  const id = model.toLowerCase();
  let best: AiPrice | null = null;
  for (const p of prices)
    if (matches(p.model, id) && (!best || p.model.length > best.model.length)) best = p;
  return best;
}

export interface AiTokenCounts {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

/** Dollars for one call's tokens at a price. */
export const costUsd = (t: AiTokenCounts, p: AiPrice): number =>
  (t.input * p.input +
    t.output * p.output +
    t.cacheRead * p.cacheRead +
    t.cacheWrite * p.cacheWrite) /
  1e6;

/** One logged call, as the page reads it from the database. */
export interface AiUsageRow extends AiTokenCounts {
  id: string;
  /** ISO timestamp */
  at: string;
  provider: string;
  model: string | null;
  purpose: string;
  ok: boolean;
  status: number;
  /** the service reported its token counts for this call */
  known: boolean;
  ms: number | null;
  note: string | null;
}

export interface CostLine extends AiTokenCounts {
  calls: number;
  failed: number;
  /** dollars for the calls that have a price */
  usd: number;
  /** calls with no price set, so not in `usd` */
  unpriced: number;
}

const blank = (): CostLine => ({
  calls: 0,
  failed: 0,
  usd: 0,
  unpriced: 0,
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

export interface PricedRow extends AiUsageRow {
  /** null when no price is set for the model (or the service did not report tokens) */
  usd: number | null;
}

export interface CostSummary {
  totals: CostLine;
  /** today, the last 7 and 30 days, this month, and everything */
  periods: { key: string; label: string; line: CostLine }[];
  /** newest first; only days that had calls (UTC days) */
  byDay: (CostLine & { date: string })[];
  byPurpose: (CostLine & { key: string })[];
  byModel: (CostLine & { provider: string; model: string })[];
  cache: {
    /** tokens read from the cache over all the prompt tokens that were sent */
    hitRate: number | null;
    readTokens: number;
    /** dollars not paid because those tokens came from the cache instead of being charged as new input */
    savedUsd: number;
    writeTokens: number;
  };
  /** the most recent calls with their cost, newest first */
  recent: PricedRow[];
  /** models that were used and have no price in Settings */
  unpricedModels: string[];
}

const add = (line: CostLine, r: PricedRow) => {
  line.calls++;
  if (!r.ok) line.failed++;
  line.input += r.input;
  line.output += r.output;
  line.cacheRead += r.cacheRead;
  line.cacheWrite += r.cacheWrite;
  if (r.usd === null) {
    if (r.known || r.ok) line.unpriced++;
  } else line.usd += r.usd;
};

const dayOf = (iso: string) => iso.slice(0, 10);
const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

export function summariseUsage(
  rows: readonly AiUsageRow[],
  prices: readonly AiPrice[],
  today: string,
  opts: { recent?: number } = {},
): CostSummary {
  const priced: PricedRow[] = [...rows]
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((r) => {
      const p = priceFor(prices, r.model);
      return { ...r, usd: p && r.known ? costUsd(r, p) : null };
    });

  const totals = blank();
  const byDay = new Map<string, CostLine>();
  const byPurpose = new Map<string, CostLine>();
  const byModel = new Map<string, CostLine & { provider: string; model: string }>();
  const periodDefs = [
    { key: 'today', label: 'Today', from: today },
    { key: 'last7', label: 'Last 7 days', from: addDays(today, -6) },
    { key: 'last30', label: 'Last 30 days', from: addDays(today, -29) },
    { key: 'month', label: 'This month', from: `${today.slice(0, 7)}-01` },
    { key: 'all', label: 'So far', from: '0000-00-00' },
  ];
  const periods = periodDefs.map((d) => ({
    key: d.key,
    label: d.label,
    from: d.from,
    line: blank(),
  }));
  let readTokens = 0;
  let writeTokens = 0;
  let promptTokens = 0;
  let savedUsd = 0;
  const unpriced = new Set<string>();

  for (const r of priced) {
    add(totals, r);
    const d = dayOf(r.at);
    add(byDay.get(d) ?? byDay.set(d, blank()).get(d)!, r);
    add(byPurpose.get(r.purpose) ?? byPurpose.set(r.purpose, blank()).get(r.purpose)!, r);
    const mk = `${r.provider}|${r.model ?? '—'}`;
    const ml =
      byModel.get(mk) ??
      byModel.set(mk, { ...blank(), provider: r.provider, model: r.model ?? '—' }).get(mk)!;
    add(ml, r);
    for (const p of periods) if (d >= p.from && d <= today) add(p.line, r);
    readTokens += r.cacheRead;
    writeTokens += r.cacheWrite;
    promptTokens += r.input + r.cacheRead + r.cacheWrite;
    const p = priceFor(prices, r.model);
    if (p) savedUsd += (r.cacheRead * (p.input - p.cacheRead)) / 1e6;
    else if (r.known && r.ok) unpriced.add(r.model ?? r.provider);
  }

  const byUsd = (a: CostLine, b: CostLine) => b.usd - a.usd || b.calls - a.calls;
  return {
    totals,
    periods: periods.map(({ key, label, line }) => ({ key, label, line })),
    byDay: [...byDay.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, line]) => ({ date, ...line })),
    byPurpose: [...byPurpose.entries()].map(([key, line]) => ({ key, ...line })).sort(byUsd),
    byModel: [...byModel.values()].sort(byUsd),
    cache: {
      hitRate: promptTokens > 0 ? readTokens / promptTokens : null,
      readTokens,
      savedUsd,
      writeTokens,
    },
    recent: priced.slice(0, opts.recent ?? 100),
    unpricedModels: [...unpriced].sort(),
  };
}

export const formatUsd = (v: number): string =>
  v === 0
    ? '$0.00'
    : v < 0.01
      ? `$${v.toFixed(4)}`
      : v < 100
        ? `$${v.toFixed(2)}`
        : `$${Math.round(v).toLocaleString('en-US')}`;

/** Rupees with two decimals below ₹100 (these amounts are small), whole rupees above. */
export const formatInrSmall = (v: number): string =>
  v < 100
    ? `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `₹${Math.round(v).toLocaleString('en-IN')}`;
