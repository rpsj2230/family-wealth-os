/**
 * Daily market-data refresh (pure logic; the database and the network are passed in).
 *  - the AMFI scheme list is refreshed every run
 *  - latest NAVs are stored only for schemes the household holds
 *  - the first time a held scheme is seen its NAV history (from 2018) is back-filled from a community mirror of AMFI data
 *  - FX rates (INR per unit) are stored for each foreign currency the household uses
 * Failures of optional sources are returned as warnings; failure of the AMFI file itself is an error.
 */
import { autoPick, matchFund, parseNavAll, type AmfiScheme } from './amfi';

export interface SchemeRow {
  code: string;
  name: string;
  plan: string;
  option: string;
  amc: string;
  category: string;
  isin_growth: string | null;
  isin_reinvest: string | null;
  updated_on: string;
}
export interface NavRow {
  amfi_code: string;
  nav_date: string;
  nav: number;
  source: string;
}
export interface FxRow {
  currency: string;
  rate_date: string;
  inr_per_unit: number;
  source: string;
}

export interface UnmatchedPosition {
  assetId: string;
  name: string;
  navHint: number | null;
}

export interface MarketStore {
  /** funds with no AMFI scheme chosen yet; optional so older stores keep working */
  unmatchedPositions?(): Promise<UnmatchedPosition[]>;
  setAmfiCode?(assetId: string, code: string): Promise<void>;
  heldCodes(): Promise<string[]>;
  /** the index fund used as the benchmark proxy, set in the household's configuration; its prices are fetched like a held fund's */
  benchmarkCodes?(): Promise<string[]>;
  navCount(code: string): Promise<number>;
  currencies(): Promise<string[]>;
  fxCount(currency: string): Promise<number>;
  upsertSchemes(rows: SchemeRow[]): Promise<void>;
  upsertNavs(rows: NavRow[]): Promise<void>;
  upsertFx(rows: FxRow[]): Promise<void>;
}

export interface MarketIo {
  fetchText(url: string): Promise<string>;
  fetchJson(url: string): Promise<unknown>;
}

export interface MarketReport {
  schemes: number;
  heldCodes: number;
  latestNavs: number;
  historyRows: number;
  fxRows: number;
  autoMatched: number;
  unmatched: string[];
  warnings: string[];
}

export const AMFI_URL = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const HISTORY_FROM = '2018-01-01';
const chunk = <T>(a: T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(a.length / n) }, (_, i) => a.slice(i * n, i * n + n));

/** mfapi.in history: { data: [{ date: 'dd-mm-yyyy', nav: '123.4567' }, ...] } (newest first). */
export function parseHistory(json: unknown, code: string, from = HISTORY_FROM): NavRow[] {
  const data = (json as { data?: { date?: string; nav?: string }[] } | null)?.data;
  if (!Array.isArray(data)) return [];
  const out: NavRow[] = [];
  for (const d of data) {
    const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d.date ?? '');
    const nav = Number(d.nav);
    if (!m || !(nav > 0)) continue;
    const iso = `${m[3]}-${m[2]}-${m[1]}`;
    if (iso >= from) out.push({ amfi_code: code, nav_date: iso, nav, source: 'mfapi' });
  }
  return out;
}

/** Frankfurter (ECB reference rates): { date, rates: { INR: 74.26 } } for latest, or { rates: { 'YYYY-MM-DD': { INR } } } for a range. */
export function parseFx(json: unknown, currency: string): FxRow[] {
  const j = json as { date?: string; rates?: Record<string, unknown> } | null;
  if (!j || !j.rates) return [];
  const rows: FxRow[] = [];
  if (typeof j.date === 'string' && typeof (j.rates as { INR?: unknown }).INR === 'number') {
    rows.push({
      currency,
      rate_date: j.date,
      inr_per_unit: (j.rates as { INR: number }).INR,
      source: 'frankfurter',
    });
  } else {
    for (const [d, v] of Object.entries(j.rates)) {
      const inr = (v as { INR?: unknown } | null)?.INR;
      if (/^\d{4}-\d{2}-\d{2}$/.test(d) && typeof inr === 'number' && inr > 0)
        rows.push({ currency, rate_date: d, inr_per_unit: inr, source: 'frankfurter' });
    }
  }
  return rows.filter((r) => r.inr_per_unit > 0);
}

export async function refreshMarketData(
  store: MarketStore,
  io: MarketIo,
  today: string,
): Promise<MarketReport> {
  const report: MarketReport = {
    schemes: 0,
    heldCodes: 0,
    latestNavs: 0,
    historyRows: 0,
    fxRows: 0,
    autoMatched: 0,
    unmatched: [],
    warnings: [],
  };

  // 1. AMFI file (required)
  const text = await io.fetchText(AMFI_URL);
  const all: AmfiScheme[] = parseNavAll(text);
  if (all.length < 5000)
    throw new Error(`AMFI file looks wrong: only ${all.length} schemes parsed`);
  const rows: SchemeRow[] = all.map((s) => ({
    code: s.code,
    name: s.name,
    plan: s.plan,
    option: s.option,
    amc: s.amc,
    category: s.category,
    isin_growth: s.isinGrowth,
    isin_reinvest: s.isinReinvest,
    updated_on: today,
  }));
  for (const c of chunk(rows, 1000)) await store.upsertSchemes(c);
  report.schemes = rows.length;

  // 1b. choose the scheme for funds that have none, only when it is clearly the right one
  if (store.unmatchedPositions && store.setAmfiCode) {
    for (const pos of await store.unmatchedPositions()) {
      const pick = autoPick(matchFund(pos.name, all, pos.navHint));
      if (pick) {
        await store.setAmfiCode(pos.assetId, pick.scheme.code);
        report.autoMatched++;
      } else report.unmatched.push(pos.name);
    }
  }

  // 2. latest NAV for held schemes
  const held = [
    ...new Set([...(await store.heldCodes()), ...((await store.benchmarkCodes?.()) ?? [])]),
  ];
  report.heldCodes = held.length;
  const byCode = new Map(all.map((s) => [s.code, s]));
  const latest: NavRow[] = [];
  for (const code of held) {
    const s = byCode.get(code);
    if (!s || s.nav === null || !s.navDate) {
      report.warnings.push(`No current NAV in the AMFI file for scheme ${code}.`);
      continue;
    }
    latest.push({ amfi_code: code, nav_date: s.navDate, nav: s.nav, source: 'amfi' });
  }
  if (latest.length) await store.upsertNavs(latest);
  report.latestNavs = latest.length;

  // 3. one-time history back-fill for newly held schemes
  for (const code of held) {
    if ((await store.navCount(code)) > 5) continue;
    try {
      const rowsH = parseHistory(await io.fetchJson(`https://api.mfapi.in/mf/${code}`), code);
      if (rowsH.length === 0) report.warnings.push(`No NAV history found for scheme ${code}.`);
      for (const c of chunk(rowsH, 1000)) await store.upsertNavs(c);
      report.historyRows += rowsH.length;
    } catch (e) {
      report.warnings.push(
        `NAV history for scheme ${code} could not be fetched (${(e as Error).message}).`,
      );
    }
  }

  // 4. FX
  for (const cur of [...new Set(await store.currencies())].filter((c) => c !== 'INR')) {
    try {
      const rowsF = parseFx(
        await io.fetchJson(`https://api.frankfurter.dev/v1/latest?base=${cur}&symbols=INR`),
        cur,
      );
      if ((await store.fxCount(cur)) < 5) {
        const start = new Date(today + 'T00:00:00Z');
        start.setUTCDate(start.getUTCDate() - 120);
        rowsF.push(
          ...parseFx(
            await io.fetchJson(
              `https://api.frankfurter.dev/v1/${start.toISOString().slice(0, 10)}..${today}?base=${cur}&symbols=INR`,
            ),
            cur,
          ),
        );
      }
      // one row per currency and day: a repeated day would make the whole save fail
      const uniqueF = [...new Map(rowsF.map((r) => [`${r.currency}|${r.rate_date}`, r])).values()];
      rowsF.length = 0;
      rowsF.push(...uniqueF);
      if (rowsF.length === 0) report.warnings.push(`No ${cur}→INR rate returned.`);
      else await store.upsertFx(rowsF);
      report.fxRows += rowsF.length;
    } catch (e) {
      report.warnings.push(`${cur}→INR rate could not be fetched (${(e as Error).message}).`);
    }
  }
  return report;
}
