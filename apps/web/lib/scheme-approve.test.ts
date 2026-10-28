import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatchView } from './match-data';
import {
  approveAllCertain,
  approveMatch,
  loadHistory,
  setNotListed,
  type ApproveDeps,
} from './scheme-approve';
import { testDb } from './test-db';

/**
 * What approving a scheme does, against an in-memory database and a fake network: the fund's scheme and ISIN are set once, the
 * scheme's price history is fetched once and stored through the member-checked function, saying it again changes nothing, and nothing
 * is deleted.
 */
const HH = 'h-1';
const A1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const A2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

const history = (n: number) => ({
  data: Array.from({ length: n }, (_, i) => ({
    date: `${String(i + 1).padStart(2, '0')}-10-2026`,
    nav: String(100 + i),
  })),
});

function world(opts: { missingColumns?: Record<string, string[]>; storedNavs?: number } = {}) {
  const tables = {
    amfi_schemes: [
      {
        code: '120465',
        name: 'Axis Large Cap Fund',
        plan: 'Direct',
        option: 'Growth',
        amc: 'Axis',
        category: 'x',
        isin_growth: 'INF000A01AA1',
        isin_reinvest: null,
      },
      {
        code: '112277',
        name: 'Axis Large Cap Fund',
        plan: 'Regular',
        option: 'Growth',
        amc: 'Axis',
        category: 'x',
        isin_growth: 'INF000A01AD5',
        isin_reinvest: null,
      },
    ],
    mf_positions: [
      {
        asset_id: A1,
        household_id: HH,
        fund_name: 'Axis Bluechip',
        isin: null,
        amfi_code: null,
        no_price_source: true,
      },
      {
        asset_id: A2,
        household_id: HH,
        fund_name: 'Other Fund',
        isin: 'INF000A01AD5',
        amfi_code: null,
        no_price_source: false,
      },
    ],
    mf_navs: Array.from({ length: opts.storedNavs ?? 0 }, (_, i) => ({
      amfi_code: '120465',
      nav_date: `2026-09-${String(i + 1).padStart(2, '0')}`,
      nav: 1,
    })),
  } as Record<string, Record<string, unknown>[]>;
  const urls: string[] = [];
  const t = testDb({
    tables,
    ...(opts.missingColumns ? { missingColumns: opts.missingColumns } : {}),
    rpcs: {
      confirm_scheme_match: (a, tb) => {
        const code = a.p_code as string | null;
        if (code && !tb.amfi_schemes!.some((s) => s.code === code))
          return { error: { message: 'unknown AMFI scheme code' } };
        const p = tb.mf_positions!.find(
          (x) => x.asset_id === a.p_asset && x.household_id === a.p_household,
        );
        if (!p) return { error: { message: 'unknown fund' } };
        p.amfi_code = code;
        return {};
      },
      store_scheme_navs: (a, tb) => {
        const rows = a.p_rows as { nav_date: string; nav: number }[];
        let n = 0;
        for (const r of rows)
          if (!tb.mf_navs!.some((x) => x.amfi_code === a.p_code && x.nav_date === r.nav_date)) {
            tb.mf_navs!.push({ amfi_code: a.p_code, nav_date: r.nav_date, nav: r.nav });
            n++;
          }
        return { data: n };
      },
    },
  });
  const deps = (json: unknown = history(40)): ApproveDeps => ({
    db: t.db,
    household: HH,
    fetchJson: async (u) => {
      urls.push(u);
      return json;
    },
  });
  return { ...t, tables, urls, deps };
}

beforeEach(() => {
  // the "column exists" answers are remembered for half a minute: each test starts from a clean memory
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 40_000 * Math.floor(Math.random() * 1e6));
});

describe('approving a scheme for a fund', () => {
  it('sets the scheme and the ISIN, clears the "not listed" mark and stores the price history once', async () => {
    const w = world();
    const r = await approveMatch(w.deps(), A1, '120465');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('Matched “Axis Bluechip” to Axis Large Cap Fund');
    expect(r.message).toContain('price history is stored');
    const p = w.tables.mf_positions!.find((x) => x.asset_id === A1)!;
    expect(p.amfi_code).toBe('120465');
    expect(p.isin).toBe('INF000A01AA1');
    expect(p.no_price_source).toBe(false);
    expect(w.urls).toEqual(['https://api.mfapi.in/mf/120465']);
    expect(w.tables.mf_navs).toHaveLength(40);
    expect(w.rpcLog.map((c) => c.fn)).toEqual(['confirm_scheme_match', 'store_scheme_navs']);
    expect(w.rpcLog[0]!.args).toEqual({ p_household: HH, p_asset: A1, p_code: '120465' });
  });

  it('is idempotent: approving again changes nothing and fetches nothing', async () => {
    const w = world();
    await approveMatch(w.deps(), A1, '120465');
    const before = JSON.stringify(w.tables);
    const again = await approveMatch(w.deps(), A1, '120465');
    expect(again.ok).toBe(true);
    expect(again.message).toContain('already stored');
    expect(JSON.stringify(w.tables)).toBe(before);
    expect(w.urls).toHaveLength(1);
  });

  it('never replaces an ISIN already read from a statement', async () => {
    const w = world();
    await approveMatch(w.deps(), A2, '112277');
    expect(w.tables.mf_positions!.find((x) => x.asset_id === A2)!.isin).toBe('INF000A01AD5');
    // a different scheme chosen by hand does not overwrite the statement's ISIN either
    await approveMatch(w.deps(), A2, '120465');
    expect(w.tables.mf_positions!.find((x) => x.asset_id === A2)!.isin).toBe('INF000A01AD5');
  });

  it('with the history switched off it only matches, and says which scheme still needs its prices', async () => {
    const w = world();
    const r = await approveMatch(w.deps(), A1, '120465', { history: false });
    expect(r).toMatchObject({ ok: true, historyFor: '120465' });
    expect(w.urls).toHaveLength(0);
    expect(w.rpcLog.map((c) => c.fn)).toEqual(['confirm_scheme_match']);
  });

  it('a failed price fetch still leaves the fund matched, and says tonight’s update will do it', async () => {
    const w = world();
    const deps: ApproveDeps = {
      ...w.deps(),
      fetchJson: async () => {
        throw new Error('mfapi.in answered 503');
      },
    };
    const r = await approveMatch(deps, A1, '120465');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('tonight');
    expect(w.tables.mf_positions!.find((x) => x.asset_id === A1)!.amfi_code).toBe('120465');
    expect(w.tables.mf_navs).toHaveLength(0);
  });

  it('works before the database update that stores prices has run', async () => {
    const w = world();
    const noFn = testDb({
      tables: w.tables,
      rpcs: {
        confirm_scheme_match: (a) => {
          w.tables.mf_positions!.find((x) => x.asset_id === a.p_asset)!.amfi_code = a.p_code;
          return {};
        },
      },
    });
    const r = await approveMatch({ ...w.deps(), db: noFn.db }, A1, '120465');
    expect(r.ok).toBe(true);
    expect(r.message).toContain('tonight');
  });

  it('refuses a bad id, an unknown scheme and an unknown fund, and changes nothing', async () => {
    const w = world();
    const before = JSON.stringify(w.tables);
    expect((await approveMatch(w.deps(), 'nope', '120465')).ok).toBe(false);
    expect((await approveMatch(w.deps(), A1, 'x1')).ok).toBe(false);
    expect((await approveMatch(w.deps(), A1, '999999')).message).toContain(
      'not in the official list',
    );
    expect(
      (await approveMatch(w.deps(), 'cccccccc-cccc-cccc-cccc-cccccccccccc', '120465')).message,
    ).toContain('could not be found');
    expect(JSON.stringify(w.tables)).toBe(before);
    expect(w.urls).toHaveLength(0);
  });

  it('deletes nothing: no table loses a row', async () => {
    const w = world({ storedNavs: 2 });
    const rows = () => Object.values(w.tables).reduce((n, t) => n + t.length, 0);
    const before = rows();
    await approveMatch(w.deps(), A1, '120465');
    expect(rows()).toBeGreaterThanOrEqual(before);
    expect(w.log.filter((l) => l.op === 'delete')).toHaveLength(0);
  });

  it('fetches a scheme’s history on its own (one scheme per call) and skips it when it is stored', async () => {
    const w = world({ storedNavs: 30 });
    expect((await loadHistory(w.deps(), '120465')).status).toBe('already');
    expect(w.urls).toHaveLength(0);
  });
});

describe('"this is not a listed fund"', () => {
  it('marks the fund, and the mark can be taken off again', async () => {
    const w = world();
    const on = await setNotListed(w.deps(), A2, true);
    expect(on.ok).toBe(true);
    expect(on.message).toContain('labelled “no price source”');
    expect(w.tables.mf_positions!.find((x) => x.asset_id === A2)!.no_price_source).toBe(true);
    expect((await setNotListed(w.deps(), A2, false)).ok).toBe(true);
    expect(w.tables.mf_positions!.find((x) => x.asset_id === A2)!.no_price_source).toBe(false);
  });
  it('does not mark a fund that already has a scheme', async () => {
    const w = world();
    await approveMatch(w.deps(), A2, '112277');
    const r = await setNotListed(w.deps(), A2, true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('already matched');
  });
  it('says so when the database update that adds the mark has not run', async () => {
    const w = world({ missingColumns: { mf_positions: ['no_price_source'] } });
    const r = await setNotListed(w.deps(), A2, true);
    expect(r.ok).toBe(false);
    expect(r.message).toContain('database update');
  });
});

describe('approve all certain matches', () => {
  const view = (rows: Partial<MatchView['rows'][number]>[]): MatchView => ({
    haveList: true,
    canMark: true,
    rows: rows.map(
      (r) =>
        ({
          certainty: null,
          proposal: null,
          amfiCode: null,
          name: 'x',
          ...r,
        }) as MatchView['rows'][number],
    ),
  });
  const certainRow = (assetId: string, code: string, name: string) => ({
    assetId,
    name,
    certainty: 'certain' as const,
    proposal: { recommended: code } as MatchView['rows'][number]['proposal'],
  });
  it('matches every certain fund, no other, and leaves the prices to one call per scheme', async () => {
    const w = world();
    const out = await approveAllCertain(
      w.deps(),
      view([
        certainRow(A1, '120465', 'Axis Bluechip'),
        certainRow(A2, '112277', 'Other Fund'),
        {
          assetId: 'x3',
          name: 'Medium one',
          certainty: 'medium',
          proposal: { recommended: '120465' } as never,
        },
        {
          assetId: 'x4',
          name: 'Already',
          amfiCode: '120465',
          certainty: 'certain',
          proposal: { recommended: '120465' } as never,
        },
      ]),
    );
    expect(out).toMatchObject({ ok: true, matched: 2, codes: ['120465', '112277'] });
    expect(out.message).toBe('2 funds matched by ISIN.');
    expect(w.tables.mf_positions!.map((p) => p.amfi_code)).toEqual(['120465', '112277']);
    expect(w.urls).toHaveLength(0); // no prices yet: the page fetches them one scheme at a time
    // then each scheme once
    for (const c of out.codes) await loadHistory(w.deps(), c);
    expect(w.urls).toEqual(['https://api.mfapi.in/mf/120465', 'https://api.mfapi.in/mf/112277']);
  });
  it('says so when nothing is certain', async () => {
    const w = world();
    const out = await approveAllCertain(w.deps(), view([{ assetId: A1, certainty: 'medium' }]));
    expect(out).toMatchObject({ ok: true, matched: 0, codes: [] });
    expect(out.message).toContain('no certain match');
    expect(w.rpcLog).toHaveLength(0);
  });
  it('one that fails is named and the rest are still matched', async () => {
    const w = world();
    const out = await approveAllCertain(
      w.deps(),
      view([
        certainRow(A1, '999999', 'Unknown scheme fund'),
        certainRow(A2, '112277', 'Other Fund'),
      ]),
    );
    expect(out.ok).toBe(false);
    expect(out.matched).toBe(1);
    expect(out.message).toContain('Unknown scheme fund');
  });
});
