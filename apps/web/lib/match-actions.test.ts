import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { testDb } from './test-db';

/**
 * The server actions behind the buttons of "Funds without a price", run against an in-memory database and a fake network: one decision
 * sets the scheme and ISIN once and fetches that scheme's prices once; "approve all certain" matches only the ISIN-certain funds and
 * leaves the prices to one call per scheme; the pages are refreshed.
 */
const HH = 'h-1';
const A1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const A2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const A3 = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const A4 = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const row = (code: string, name: string, plan: string, option: string, isin: string) => ({
  code,
  name,
  plan,
  option,
  amc: 'Axis Mutual Fund',
  category: 'x',
  isin_growth: isin,
  isin_reinvest: null,
});

const w = testDb({
  tables: {
    amfi_schemes: [
      row('120465', 'Axis Large Cap Fund', 'Direct Plan', 'Growth Option', 'INF000A01AA1'),
      row('112277', 'Axis Large Cap Fund', 'Regular Plan', 'Growth Option', 'INF000A01AD5'),
    ],
    owners: [{ id: 'o1', display_name: 'Rupash' }],
    assets: [A1, A2, A3, A4].map((id) => ({ id, owner_id: 'o1', status: 'active' })),
    observations: [],
    fund_folio_links: [],
    mf_navs: [],
    mf_positions: [
      {
        asset_id: A1,
        household_id: HH,
        fund_name: 'Axis Bluechip',
        amfi_code: null,
        isin: 'INF000A01AA1',
        plan_type: 'direct',
        no_price_source: false,
      },
      {
        asset_id: A2,
        household_id: HH,
        fund_name: 'Another name',
        amfi_code: null,
        isin: 'INF000A01AD5',
        plan_type: 'regular_or_unknown',
        no_price_source: false,
      },
      // only the name: likely, never certain
      {
        asset_id: A3,
        household_id: HH,
        fund_name: 'Axis Large Cap Fund Direct',
        amfi_code: null,
        isin: null,
        plan_type: 'direct',
        no_price_source: false,
      },
      {
        asset_id: A4,
        household_id: HH,
        fund_name: 'Axis Large Cap Fund Regular',
        amfi_code: null,
        isin: null,
        plan_type: 'regular',
        no_price_source: false,
      },
    ],
  },
  rpcs: {
    confirm_scheme_match: (a, tb) => {
      const p = tb.mf_positions!.find(
        (x) => x.asset_id === a.p_asset && x.household_id === a.p_household,
      );
      if (!p) return { error: { message: 'unknown fund' } };
      p.amfi_code = a.p_code;
      return {};
    },
    store_scheme_navs: (a, tb) => {
      for (const r of a.p_rows as { nav_date: string; nav: number }[])
        if (!tb.mf_navs!.some((x) => x.amfi_code === a.p_code && x.nav_date === r.nav_date))
          tb.mf_navs!.push({ amfi_code: a.p_code, nav_date: r.nav_date, nav: r.nav });
      return {};
    },
  },
});

const initial = structuredClone(w.tables);
const revalidated: string[] = [];
vi.mock('next/cache', () => ({ revalidatePath: (p: string) => revalidated.push(p) }));
vi.mock('@/lib/data', () => ({
  loadContext: async () => ({ supabase: w.db, householdId: HH }),
}));

const fetched: { url: string; ua: string | undefined }[] = [];
const history = {
  data: Array.from({ length: 20 }, (_, i) => ({
    date: `${String(i + 1).padStart(2, '0')}-10-2026`,
    nav: String(100 + i),
  })),
};

const actions = await import('@/app/(app)/investments/match-actions');
const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const pos = (id: string) => w.tables.mf_positions!.find((p) => p.asset_id === id)!;

beforeEach(() => {
  // every test starts from the same funds and no stored prices
  for (const [k, rows] of Object.entries(initial))
    w.tables[k]!.splice(0, w.tables[k]!.length, ...structuredClone(rows));
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 40_000 * Math.floor(Math.random() * 1e6));
  fetched.length = 0;
  revalidated.length = 0;
  vi.stubGlobal('fetch', async (url: string, init?: { headers?: Record<string, string> }) => {
    fetched.push({ url, ua: init?.headers?.['user-agent'] });
    return { ok: true, status: 200, json: async () => history };
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('one decision', () => {
  it('matches the fund, sets the ISIN, fetches the scheme’s prices once with the honest user-agent, and refreshes the pages', async () => {
    const r = await actions.decideFund(null, form({ asset: A3, choice: '120465' }));
    expect(r.ok).toBe(true);
    expect(pos(A3).amfi_code).toBe('120465');
    expect(pos(A3).isin).toBe('INF000A01AA1');
    expect(fetched).toEqual([
      { url: 'https://api.mfapi.in/mf/120465', ua: 'family-wealth-os/1.0 (+personal use)' },
    ]);
    expect(w.tables.mf_navs).toHaveLength(20);
    expect(revalidated).toContain('/investments');
    expect(revalidated).toContain('/');
    // saying it again changes nothing and does not fetch again
    const again = await actions.decideFund(null, form({ asset: A3, choice: '120465' }));
    expect(again.ok).toBe(true);
    expect(fetched).toHaveLength(1);
    expect(w.tables.mf_navs).toHaveLength(20);
  });

  it('"not a listed fund" marks the fund, fetches nothing, and "look again" takes the mark off', async () => {
    const r = await actions.decideFund(null, form({ asset: A2, choice: 'none' }));
    expect(r.ok).toBe(true);
    expect(pos(A2).no_price_source).toBe(true);
    expect(pos(A2).amfi_code).toBeNull();
    expect(fetched).toHaveLength(0);
    expect((await actions.lookAgain(null, form({ asset: A2 }))).ok).toBe(true);
    expect(pos(A2).no_price_source).toBe(false);
  });

  it('a bad answer changes nothing and refreshes nothing', async () => {
    const r = await actions.decideFund(null, form({ asset: 'x', choice: '120465' }));
    expect(r.ok).toBe(false);
    expect(revalidated).toHaveLength(0);
    expect(fetched).toHaveLength(0);
  });
});

describe('approve all certain matches', () => {
  it('matches the funds whose ISIN is the scheme’s, not the one only the name points to, then fetches prices one scheme per call', async () => {
    const out = await actions.approveCertain();
    expect(out.ok).toBe(true);
    expect(out.codes.sort()).toEqual(['112277', '120465']);
    expect(pos(A1).amfi_code).toBe('120465');
    expect(pos(A2).amfi_code).toBe('112277');
    expect(pos(A4).amfi_code).toBeNull(); // name only: it is still a question
    expect(fetched).toHaveLength(0);
    expect(revalidated).toHaveLength(0); // the page shows progress until the end
    for (const c of out.codes) expect((await actions.fetchPrices(c)).ok).toBe(true);
    expect(fetched.map((f) => f.url).sort()).toEqual([
      'https://api.mfapi.in/mf/112277',
      'https://api.mfapi.in/mf/120465',
    ]);
    await actions.finishMatching();
    expect(revalidated).toContain('/investments');
    // a second press has nothing certain left to do
    const again = await actions.approveCertain();
    expect(again.codes).toEqual([]);
  });
});

describe('the search box', () => {
  it('returns the best schemes for what was typed, with their plan and option', async () => {
    const hits = await actions.searchOfficialSchemes('axis large cap regular');
    expect(hits).toEqual([
      {
        code: '112277',
        name: 'Axis Large Cap Fund - Regular Plan - Growth Option',
        detail: 'Regular, Growth',
        amc: 'Axis Mutual Fund',
      },
    ]);
  });
});
