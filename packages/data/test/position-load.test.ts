import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  buildPortfolio,
  fundsOf,
  valueOn,
  type AssetRow,
  type ObservationRow,
} from '@fwos/core';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { LoadedPortfolio } from '../src/index';
import { clearNavHistoryCache } from '../src/nav-history';
import { loadPositionInput } from '../src/position';

type Row = Record<string, unknown>;

/**
 * Just enough of the database client for the position loader: select, eq, in, gte, order, range and the `or` the price reader builds
 * from `and(nav_date.gte.A,nav_date.lte.B)` pieces. It remembers each price request so the test can see what was asked for.
 */
function stub(tables: Record<string, Row[]>) {
  const priceRequests: { codes: unknown[]; from: string | null; ranges: number }[] = [];
  const db = {
    from(table: string) {
      const filters: ((r: Row) => boolean)[] = [];
      let range: [number, number] | null = null;
      const req = { codes: [] as unknown[], from: null as string | null, ranges: 0 };
      const q = {
        select: () => q,
        in: (c: string, v: unknown[]) => {
          if (c === 'amfi_code') req.codes = v;
          filters.push((r) => v.includes(r[c]));
          return q;
        },
        eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
        gt: (c: string, v: string) => (filters.push((r) => (r[c] as string) > v), q),
        gte: (c: string, v: string) => {
          if (c === 'nav_date') req.from = v;
          filters.push((r) => (r[c] as string) >= v);
          return q;
        },
        order: () => q,
        range: (a: number, b: number) => ((range = [a, b]), q),
        or: (spec: string) => {
          const parts = [
            ...spec.matchAll(/and\(nav_date\.gte\.([\d-]+),nav_date\.lte\.([\d-]+)\)/g),
          ];
          req.ranges = parts.length;
          filters.push((r) =>
            parts.some((m) => (r.nav_date as string) >= m[1]! && (r.nav_date as string) <= m[2]!),
          );
          return q;
        },
        then(res: (v: { data: Row[]; error: null }) => unknown) {
          if (table === 'mf_navs') priceRequests.push(req);
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
          if (range) rows = rows.slice(range[0], range[1] + 1);
          return Promise.resolve({ data: rows, error: null }).then(res);
        },
      };
      return q;
    },
  };
  return { db: db as unknown as SupabaseClient, priceRequests };
}

const TODAY = '2026-10-28';
const addDays = (d: string, n: number) => {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};
const dates = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const asset = (id: string, code: string, extra: Partial<AssetRow> = {}) =>
  ({
    id,
    owner_id: 'o1',
    type: 'mutual_fund',
    status: 'active',
    nickname: `Invented ${id}`,
    currency: 'INR',
    amfi_code: code,
    units: null,
    units_as_of: null,
    sip: null,
    ...extra,
  }) as unknown as AssetRow;

const obs = (asset_id: string, as_of: string, amount: number, sheet = false) =>
  ({
    id: `${asset_id}-${as_of}`,
    asset_id,
    kind: 'valuation',
    amount,
    currency: 'INR',
    fx_rate: null,
    as_of,
    confidence: 'high',
    source: 'import',
    created_at: `${as_of}T00:00:00Z`,
    superseded_by: null,
    ...(sheet ? { source_ref: 'histfund:Sep 2026:F1' } : {}),
  }) as unknown as ObservationRow;

describe('the position loader and funds with no ledger', () => {
  beforeEach(() => clearNavHistoryCache());
  const assets = [
    asset('sheetfund', 'C1', {
      sip: { monthly: 10_000, startedOn: '2026-01-05', stopped: false },
    }),
    asset('ledgerfund', 'C2'),
  ];
  const sheet = [
    obs('sheetfund', '2026-08-31', 150_000, true),
    obs('sheetfund', '2026-09-30', 175_000, true),
  ];
  const priceRows = ['C1', 'C2'].flatMap((code) =>
    dates('2026-01-01', TODAY).map((d) => ({ amfi_code: code, nav_date: d, nav: 100 })),
  );
  const tables: Record<string, Row[]> = {
    mf_positions: [
      {
        asset_id: 'sheetfund',
        invested: 0,
        started_on: '2026-01-05',
        sip_monthly: 10_000,
        sip_stopped: false,
      },
      {
        asset_id: 'ledgerfund',
        invested: 100_000,
        started_on: '2026-08-31',
        sip_monthly: null,
        sip_stopped: false,
      },
    ],
    mf_transactions: [
      {
        id: 't1',
        asset_id: 'ledgerfund',
        txn_on: '2026-08-31',
        kind: 'purchase',
        units: 1000,
        amount: 100_000,
        nav: 100,
        balance_units: 1000,
        description: 'Purchase',
        source: 'cas',
      },
    ],
    mf_snapshots: [],
    fx_rates: [],
    mf_navs: priceRows,
  };
  const loaded = {
    today: new Date(`${TODAY}T00:00:00Z`),
    assetRows: assets,
    obsRows: [],
    sheetObs: sheet,
    fdRows: [],
    ownerName: new Map([['o1', 'Invented person']]),
    portfolio: buildPortfolio(assets, [], [], new Date(`${TODAY}T00:00:00Z`)),
  } as unknown as LoadedPortfolio;

  it('reads every price from the first value on for a fund with no ledger, and the boundary days for the rest', async () => {
    const { db, priceRequests } = stub(tables);
    const position = await loadPositionInput(db, loaded, { config: DEFAULT_CONFIG });
    const sheetFund = position.assets.find((a) => a.assetId === 'sheetfund')!;
    const ledgerFund = position.assets.find((a) => a.assetId === 'ledgerfund')!;
    const have = (a: typeof sheetFund) => new Set(a.fund!.navs.map((n) => n.date));
    // 15 Oct is not the edge of any period; the fund with no ledger needs it (and every day), the fund with a ledger does not
    expect(have(sheetFund).has('2026-08-31')).toBe(true);
    expect(have(sheetFund).has('2026-10-15')).toBe(true);
    expect(have(sheetFund).has(TODAY)).toBe(true);
    expect(have(ledgerFund).has('2026-10-15')).toBe(false);
    expect(have(ledgerFund).has('2026-09-30')).toBe(true);
    expect(
      priceRequests.some((r) => r.from === addDays('2026-01-05', -DEFAULT_CONFIG.funds.navGapDays)),
    ).toBe(true);
    // the plan travels with the fund
    expect(sheetFund.fund!.sip).toEqual({
      monthly: 10_000,
      startedOn: '2026-01-05',
      stopped: false,
    });
  });

  it('the fund with no ledger has a value on every day, so its 15 Oct figure is no hole; the ledger fund needs a price for the day', async () => {
    const { db } = stub(tables);
    const position = await loadPositionInput(db, loaded, { config: DEFAULT_CONFIG });
    const [sheetFund, ledgerFund] = position.assets as [
      (typeof position.assets)[number],
      (typeof position.assets)[number],
    ];
    for (const d of ['2026-10-05', '2026-10-15', '2026-10-27'])
      expect(valueOn(sheetFund, d, position.config, position.current)).toMatchObject({
        state: 'held',
      });
    // boundary prices only: a day that is the edge of no period has no price for a fund valued as units times the price. This is what
    // made a probe of 15 Oct read as a dip; every period figure asks for boundary days only.
    expect(valueOn(ledgerFund, '2026-10-15', position.config).state).toBe('no_data');
    expect(valueOn(ledgerFund, '2026-10-01', position.config).state).toBe('held');
    // reading all the prices (the history rebuild, Value by period, the Numbers check) leaves no day without one
    const all = await loadPositionInput(stub(tables).db, loaded, {
      config: DEFAULT_CONFIG,
      allPrices: true,
    });
    for (const d of ['2026-10-05', '2026-10-15', '2026-10-27'])
      for (const a of all.assets)
        expect(valueOn(a, d, all.config, all.current)).toMatchObject({ state: 'held' });
    expect(valueOn(all.assets[1]!, '2026-10-15', all.config).value).toBe(100_000);
  });

  it('feeds the period figures the plan’s instalments as money put in', async () => {
    const { db } = stub(tables);
    const position = await loadPositionInput(db, loaded, { config: DEFAULT_CONFIG });
    const f = fundsOf(position, ['2026-09-27']).find((h) => h.assetId === 'sheetfund')!;
    expect(f.flows.map((x) => x.date)).toEqual(
      ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10'].map((m) => `2026-${m}-05`),
    );
    expect(f.valueFrom).toBe('plan');
    // 10 instalments of 10,000 at a price of 100: 1,000 units
    expect(valueOn(position.assets[0]!, TODAY, position.config).value).toBeCloseTo(100_000, 6);
  });
});
