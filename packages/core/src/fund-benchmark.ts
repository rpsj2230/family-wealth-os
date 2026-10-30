/**
 * Which index each fund is measured against: its own official (SEBI tier-1) benchmark, as its scheme documents name it, followed through
 * an index fund or ETF that tracks that index (free daily prices exist for those, not for the index itself). The rules live in Settings,
 * one a line:
 *
 *   words in the fund's name = index name = proxy code            e.g. "nippon india small cap = Nifty Smallcap 250 TRI = 147623"
 *   kind:<kind of fund> = index name = proxy code                 e.g. "kind:mid = Nifty Midcap 150 TRI = 146271" (when no name rule fits)
 *   * = index name = proxy code                                   every other fund
 *
 * A proxy can be a mix rebalanced every day, for an index no fund tracks: "120716*0.5 + 139496*0.5". The first name rule whose words are
 * in the fund's name (spaces and punctuation ignored, so "flexi cap" finds "Flexicap") wins, then the rule for its kind, then "*".
 * Pure: no I/O.
 */
import type { CategoryKey } from './fund-category';
import { pointAtOrBefore, type IndexPoint } from './return-profile';

export interface BenchmarkLeg {
  code: string;
  weight: number;
}

export interface BenchmarkRule {
  /** the words to find in the fund's name, compacted; null for a kind rule or the "*" rule */
  words: string | null;
  kind: string | null;
  any: boolean;
  index: string;
  legs: BenchmarkLeg[];
}

export interface FundBenchmark {
  index: string;
  legs: BenchmarkLeg[];
  /** how the benchmark was chosen: the fund's own rule, the rule for its kind, or the rule for every other fund */
  basis: 'fund' | 'kind' | 'default';
}

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Reads one rule; says what is wrong with a line that is not one. */
export function parseBenchmarkRule(line: string): BenchmarkRule | { error: string } {
  const parts = line.split('=').map((x) => x.trim());
  if (parts.length !== 3 || parts.some((x) => x === ''))
    return {
      error: `“${line.trim()}” should read: words in the fund's name = index name = scheme code`,
    };
  const [who, index, proxy] = parts as [string, string, string];
  if (index.length > 80) return { error: `“${index}” is longer than 80 characters` };
  const legs: BenchmarkLeg[] = [];
  for (const piece of proxy.split('+').map((x) => x.trim())) {
    const m = /^(\d{1,10})(?:\s*\*\s*(\d*\.?\d+))?$/.exec(piece);
    if (!m) return { error: `“${piece}” should be a scheme code, or code*share for a mix` };
    const weight = m[2] === undefined ? 1 : Number(m[2]);
    if (!(weight > 0)) return { error: `the share in “${piece}” should be more than 0` };
    legs.push({ code: m[1]!, weight });
  }
  const total = legs.reduce((a, l) => a + l.weight, 0);
  if (legs.length > 1 && Math.abs(total - 1) > 0.001)
    return { error: `the shares in “${proxy}” should add up to 1` };
  const kindM = /^kind:\s*([a-z_]+)$/i.exec(who);
  if (who === '*') return { words: null, kind: null, any: true, index, legs };
  if (kindM) return { words: null, kind: kindM[1]!.toLowerCase(), any: false, index, legs };
  const words = compact(who);
  if (words.length < 2) return { error: `“${who}” is too short to find a fund by` };
  return { words, kind: null, any: false, index, legs };
}

/** The benchmark of one fund by the rules, or null when no rule fits (and there is no "*" rule). */
export function fundBenchmark(
  names: (string | null | undefined)[],
  kind: CategoryKey | string | null,
  rules: string[],
): FundBenchmark | null {
  const parsed = rules.map(parseBenchmarkRule).filter((r): r is BenchmarkRule => !('error' in r));
  const text = names.filter((x): x is string => !!x).map(compact);
  const byName = parsed.find((r) => r.words !== null && text.some((t) => t.includes(r.words!)));
  if (byName) return { index: byName.index, legs: byName.legs, basis: 'fund' };
  const byKind = kind ? parsed.find((r) => r.kind === kind) : undefined;
  if (byKind) return { index: byKind.index, legs: byKind.legs, basis: 'kind' };
  const rest = parsed.find((r) => r.any);
  return rest ? { index: rest.index, legs: rest.legs, basis: 'default' } : null;
}

/** Every scheme code the rules use, so the daily job fetches their prices. */
export function benchmarkCodes(rules: string[]): string[] {
  const out = new Set<string>();
  for (const line of rules) {
    const r = parseBenchmarkRule(line);
    if (!('error' in r)) for (const l of r.legs) out.add(l.code);
  }
  return [...out];
}

/**
 * Several price lines mixed in fixed shares, rebalanced every day: on each date of the first line on which every line has a price (on
 * or before it), the mix moves by the weighted sum of each line's change since the previous such date. Starts at 100. One line is
 * returned as it is.
 */
export function blendLines(lines: { points: IndexPoint[]; weight: number }[]): IndexPoint[] {
  if (lines.length === 0) return [];
  if (lines.length === 1) return lines[0]!.points;
  const start = lines
    .map((l) => l.points[0]?.date ?? '9999')
    .sort()
    .pop()!;
  const out: IndexPoint[] = [];
  let prev: number[] | null = null;
  let level = 100;
  for (const p of lines[0]!.points) {
    if (p.date < start) continue;
    const now = lines.map((l) => pointAtOrBefore(l.points, p.date)?.value ?? null);
    if (now.some((v) => v === null || !(v > 0))) continue;
    if (prev) level *= 1 + lines.reduce((a, l, i) => a + l.weight * (now[i]! / prev![i]! - 1), 0);
    prev = now as number[];
    out.push({ date: p.date, value: level });
  }
  return out;
}
