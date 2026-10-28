import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, positionAsOf, valueOn } from '@fwos/core';
import { clearNavHistoryCache, loadPortfolioData, loadPositionInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/** A stand-in for the database API: filters, order and ranges, and at most 1,000 rows a request. */
function fakeDb(tables: Record<string, Row[]>, calls: string[] = []): SupabaseClient {
  const API_MAX = 1000;
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let order: { col: string; asc: boolean }[] = [];
    let lo = 0;
    let hi = API_MAX - 1;
    let single = false;
    const q: Record<string, unknown> = {};
    const chain =
      (f: (...a: never[]) => void) =>
      (...a: never[]) => {
        f(...a);
        return q;
      };
    q.select = chain(() => {});
    q.eq = chain(((c: string, v: unknown) => filters.push((r) => r[c] === v)) as never);
    q.neq = chain(((c: string, v: unknown) => filters.push((r) => r[c] !== v)) as never);
    q.is = chain(((c: string, v: unknown) => filters.push((r) => (r[c] ?? null) === v)) as never);
    q.in = chain(((c: string, vs: unknown[]) => filters.push((r) => vs.includes(r[c]))) as never);
    q.gt = chain(((c: string, v: string) => filters.push((r) => String(r[c]) > v)) as never);
    q.gte = chain(((c: string, v: string) => filters.push((r) => String(r[c]) >= v)) as never);
    q.lte = chain(((c: string, v: string) => filters.push((r) => String(r[c]) <= v)) as never);
    q.order = chain(((c: string, o?: { ascending?: boolean }) =>
      order.push({ col: c, asc: o?.ascending !== false })) as never);
    q.limit = chain(((n: number) => {
      lo = 0;
      hi = Math.min(hi, n - 1);
    }) as never);
    q.range = chain(((a: number, b: number) => {
      lo = a;
      hi = b;
    }) as never);
    q.maybeSingle = () => {
      single = true;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      calls.push(table);
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      for (const o of [...order].reverse())
        rows = [...rows].sort(
          (x, y) => String(x[o.col]).localeCompare(String(y[o.col])) * (o.asc ? 1 : -1),
        );
      const page = rows.slice(lo, Math.min(hi, lo + API_MAX - 1) + 1);
      return Promise.resolve({ data: single ? (page[0] ?? null) : page, error: null }).then(
        resolve,
      );
    };
    order = [];
    return q;
  };
  return { from } as unknown as SupabaseClient;
}

const TODAY = '2026-10-28';
const day = (i: number) =>
  new Date(Date.UTC(2026, 1, 20) + i * 86_400_000).toISOString().slice(0, 10);
const navs = Array.from({ length: 250 }, (_, i) => ({
  amfi_code: '111',
  nav_date: day(i),
  nav: 100 * Math.pow(1.0004, i),
})).filter((n) => n.nav_date <= TODAY);

describe('a fund with no units and no ledger: the plan gives the units, and every page gives the same value', () => {
  beforeEach(() => clearNavHistoryCache());
  const tables: Record<string, Row[]> = {
    owners: [{ id: 'o1', display_name: 'Asha' }],
    assets: [
      {
        id: 'fund',
        owner_id: 'o1',
        type: 'mutual_fund',
        status: 'active',
        nickname: 'Invented Fund',
        currency: 'INR',
      },
    ],
    observations: [
      // the monthly sheet: values that disagree with the plan and the prices
      ...['2026-08-31', '2026-09-30'].map((d, k) => ({
        id: `s${k}`,
        asset_id: 'fund',
        kind: 'valuation',
        amount: 90_000 + k * 40_000,
        currency: 'INR',
        fx_rate: null,
        as_of: d,
        confidence: 'imported_unverified',
        source: 'workbook',
        created_at: `${d}T00:00:00Z`,
        superseded_by: null,
        source_ref: `histfund:Sep 2026:F${k}`,
      })),
    ],
    fixed_deposits: [],
    mf_positions: [
      {
        asset_id: 'fund',
        amfi_code: '111',
        sip_monthly: 10_000,
        sip_stopped: false,
        started_on: '2026-03-05',
        units: null,
        units_as_of: null,
        invested: 70_000,
      },
    ],
    institutions: [],
    rate_offers: [],
    mf_sip_changes: [],
    mf_navs: navs,
    mf_transactions: [],
    mf_snapshots: [],
    household_config: [],
    tax_rules: [],
    fx_rates: [],
  };
  const today = new Date(`${TODAY}T00:00:00Z`);

  it('net worth, the unit count Investments shows and the engine’s figure for today are one number: units times the latest price', async () => {
    const db = fakeDb(tables);
    const l = await loadPortfolioData(db, { today });
    const position = await loadPositionInput(db, l, { config: DEFAULT_CONFIG });
    const last = navs[navs.length - 1]!;
    const units = l.fundInfo['fund']!.units!;
    expect(l.assetRows[0]!.units_source).toBe('plan');
    expect(units).toBeGreaterThan(0);
    expect(l.portfolio.netWorth.total).toBeCloseTo(units * last.nav, 1);
    const engine = valueOn(position.assets[0]!, TODAY, position.config, position.current).value!;
    expect(engine).toBeCloseTo(l.portfolio.netWorth.total, 1);
    // the engine without net worth's figure (what any past day uses) gives the same
    const alone = valueOn(position.assets[0]!, TODAY, position.config).value!;
    expect(alone).toBeCloseTo(engine, 4);
    expect(positionAsOf(position, TODAY).total).toBeCloseTo(l.portfolio.netWorth.total, 1);
    expect(position.assets[0]!.fund!.units).toBeNull();
  });

  it('a counted unit count takes over from the plan', async () => {
    const counted = {
      ...tables,
      mf_positions: [{ ...tables.mf_positions![0]!, units: 700, units_as_of: '2026-10-20' }],
    };
    const l = await loadPortfolioData(fakeDb(counted), { today });
    expect(l.assetRows[0]!.units_source ?? null).toBeNull();
    expect(l.assetRows[0]!.units).toBe(700);
  });
});
