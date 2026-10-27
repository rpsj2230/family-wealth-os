import { describe, expect, it } from 'vitest';
import { loadPortfolioData, pageAll } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';

type Row = Record<string, unknown>;

/**
 * A stand-in for the database API that behaves like the real one in the way that matters here: it returns at most 1,000 rows a
 * request, whatever limit or range is asked for, and in the order asked (or stored order when none is asked).
 */
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

describe('reading more rows than the API returns in one request', () => {
  it('pageAll collects every page', async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({ id: String(i).padStart(5, '0') }));
    const db = fakeDb({ t: rows });
    const got = await pageAll<{ id: string }>((a, b) =>
      (
        db.from('t') as unknown as {
          select: () => { order: (c: string) => { range: (a: number, b: number) => never } };
        }
      )
        .select()
        .order('id')
        .range(a, b),
    );
    expect(got).toHaveLength(2345);
    expect(got[2344]!.id).toBe('02344');
  });
});

describe('loadPortfolioData with years of prices and values', () => {
  const TODAY = new Date('2026-10-26T00:00:00Z');
  const day = (i: number) =>
    new Date(Date.UTC(2021, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);
  // 2,000 daily prices from 1 Jan 2021: well past the 1,000 a request
  const navs = Array.from({ length: 2000 }, (_, i) => ({
    amfi_code: '111',
    nav_date: day(i),
    nav: 100 + i / 10,
  }));
  const latest = navs[navs.length - 1]!;
  // 60 monthly values for each of 20 accounts: 1,200 rows, also past the limit
  const obs: Row[] = [];
  for (let a = 0; a < 20; a++)
    for (let m = 0; m < 60; m++)
      obs.push({
        id: `o-${String(a).padStart(2, '0')}-${String(m).padStart(2, '0')}`,
        asset_id: a === 0 ? 'fund' : `acct-${a}`,
        kind: 'valuation',
        amount: 1000 + m,
        currency: 'INR',
        fx_rate: null,
        as_of: new Date(Date.UTC(2021, m, 28)).toISOString().slice(0, 10),
        confidence: 'verified',
        source: 'manual',
        created_at: '2021-01-01T00:00:00Z',
        superseded_by: null,
      });
  const tables: Record<string, Row[]> = {
    owners: [{ id: 'o1', display_name: 'Asha' }],
    assets: [
      {
        id: 'fund',
        owner_id: 'o1',
        type: 'mutual_fund',
        status: 'active',
        nickname: 'Sample Fund',
        currency: 'INR',
      },
    ],
    observations: obs,
    fixed_deposits: [],
    mf_positions: [
      {
        asset_id: 'fund',
        amfi_code: '111',
        sip_monthly: null,
        sip_stopped: false,
        started_on: '2021-01-28',
        units: 500,
        units_as_of: '2025-12-31',
      },
    ],
    institutions: [],
    rate_offers: [],
    mf_sip_changes: [],
    mf_navs: navs,
    household_config: [],
    tax_rules: [],
    fx_rates: [],
  };

  it('values the fund at the LATEST price, not the price 1,000 days after the first value on record', async () => {
    const l = await loadPortfolioData(fakeDb(tables), { today: TODAY });
    expect(l.fundInfo['fund']!.nav).toBe(latest.nav);
    expect(l.fundInfo['fund']!.navDate).toBe(latest.nav_date);
    expect(l.marketDates.navLatest).toBe(latest.nav_date);
    expect(l.fundDay['fund']).toBeDefined();
  });

  it('reads every recorded value, not the first 1,000', async () => {
    const l = await loadPortfolioData(fakeDb(tables), { today: TODAY });
    expect(l.obsRows).toHaveLength(1200);
    // the newest value of an account is among them
    expect(l.obsRows.some((o) => o.asset_id === 'acct-3' && o.amount === 1059)).toBe(true);
  });
  it('leaves out a fund value copied from the monthly sheet: it is only for checking, never a valuation', async () => {
    const withSheet = {
      ...tables,
      observations: [
        ...obs,
        {
          id: 'o-sheet',
          asset_id: 'fund',
          kind: 'valuation',
          amount: 123,
          currency: 'INR',
          fx_rate: null,
          as_of: '2026-09-30',
          confidence: 'imported_unverified',
          source: 'workbook',
          created_at: '2026-10-01T00:00:00Z',
          superseded_by: null,
          source_ref: 'histfund:Sep 2026:F12',
        },
        {
          id: 'o-hist',
          asset_id: 'acct-3',
          kind: 'balance',
          amount: 77,
          currency: 'INR',
          fx_rate: null,
          as_of: '2020-01-31',
          confidence: 'imported_unverified',
          source: 'workbook',
          created_at: '2026-10-01T00:00:00Z',
          superseded_by: null,
          source_ref: 'hist:Jan 2020:F5',
        },
      ],
    };
    const l = await loadPortfolioData(fakeDb(withSheet), { today: TODAY });
    expect(l.obsRows.some((o) => o.id === 'o-sheet')).toBe(false);
    // a balance from the monthly sheet for an account is an ordinary dated value
    expect(l.obsRows.some((o) => o.id === 'o-hist')).toBe(true);
  });
});
