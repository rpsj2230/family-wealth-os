import { describe, expect, it } from 'vitest';
import {
  parseFx,
  parseHistory,
  refreshMarketData,
  type FxRow,
  type MarketIo,
  type MarketStore,
  type NavRow,
  type SchemeRow,
} from '../src/market';

function amfiText(n: number) {
  const lines = [
    'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date',
    '',
    'Open Ended Schemes(Equity Scheme - Small Cap Fund)',
    '',
    'Test Mutual Fund',
    '',
  ];
  for (let i = 0; i < n; i++)
    lines.push(
      `${100000 + i};INF0000${i};-;Test Fund ${i};Direct Plan;Growth Option;${(10 + i / 100).toFixed(4)};23-Oct-2026`,
    );
  return lines.join('\n');
}

function fakeStore(
  over: Partial<{
    held: string[];
    benchmarks: string[];
    navCounts: Record<string, number>;
    currencies: string[];
    fxCount: number;
  }> = {},
) {
  const calls = { schemes: [] as SchemeRow[], navs: [] as NavRow[], fx: [] as FxRow[] };
  const store: MarketStore = {
    heldCodes: async () => over.held ?? [],
    benchmarkCodes: async () => over.benchmarks ?? [],
    navCount: async (c) => over.navCounts?.[c] ?? 0,
    currencies: async () => over.currencies ?? [],
    fxCount: async () => over.fxCount ?? 0,
    upsertSchemes: async (r) => void calls.schemes.push(...r),
    upsertNavs: async (r) => void calls.navs.push(...r),
    upsertFx: async (r) => void calls.fx.push(...r),
  };
  return { store, calls };
}

const io = (o: { text?: string; json?: (u: string) => unknown } = {}): MarketIo => ({
  fetchText: async () => o.text ?? amfiText(6000),
  fetchJson: async (u) => (o.json ? o.json(u) : {}),
});

describe('parsers', () => {
  it('parses mfapi history, converting dates and dropping rows before 2000 or with bad NAVs', () => {
    const rows = parseHistory(
      {
        data: [
          { date: '23-10-2026', nav: '190.5' },
          { date: '01-12-1999', nav: '50' },
          { date: '01-12-2017', nav: '51' },
          { date: '22-10-2026', nav: '0' },
          { date: 'x', nav: '1' },
        ],
      },
      '118778',
    );
    expect(rows).toEqual([
      { amfi_code: '118778', nav_date: '2026-10-23', nav: 190.5, source: 'mfapi' },
      { amfi_code: '118778', nav_date: '2017-12-01', nav: 51, source: 'mfapi' },
    ]);
    expect(parseHistory(null, 'x')).toEqual([]);
  });
  it('parses FX for both the latest and the range response shapes', () => {
    expect(parseFx({ date: '2026-10-23', rates: { INR: 74.263 } }, 'SGD')).toEqual([
      { currency: 'SGD', rate_date: '2026-10-23', inr_per_unit: 74.263, source: 'frankfurter' },
    ]);
    const r = parseFx(
      { rates: { '2026-10-22': { INR: 74.1 }, '2026-10-23': { INR: 74.2 }, bad: { INR: 1 } } },
      'SGD',
    );
    expect(r.map((x) => x.rate_date)).toEqual(['2026-10-22', '2026-10-23']);
    expect(parseFx({}, 'SGD')).toEqual([]);
  });
});

describe('refreshMarketData', () => {
  it('stores the scheme list and the latest NAV only for held schemes', async () => {
    const { store, calls } = fakeStore({
      held: ['100001', '100002'],
      navCounts: { '100001': 99, '100002': 99 },
    });
    const rep = await refreshMarketData(store, io(), '2026-10-26');
    expect(rep.schemes).toBe(6000);
    expect(calls.navs.map((n) => n.amfi_code)).toEqual(['100001', '100002']);
    expect(calls.navs[0]).toMatchObject({ nav_date: '2026-10-23', source: 'amfi' });
    expect(rep.warnings).toEqual([]);
  });

  it('also fetches the benchmark index fund, held or not, and its history once', async () => {
    const hist = {
      data: [
        { date: '22-10-2026', nav: '10.1' },
        { date: '21-10-2026', nav: '10.0' },
      ],
    };
    const { store, calls } = fakeStore({
      held: ['100001'],
      benchmarks: ['100002', '100001'],
      navCounts: { '100001': 99 },
    });
    const rep = await refreshMarketData(store, io({ json: () => hist }), '2026-10-26');
    expect(rep.heldCodes).toBe(2);
    expect(calls.navs.filter((n) => n.source === 'amfi').map((n) => n.amfi_code)).toEqual([
      '100001',
      '100002',
    ]);
    expect(rep.historyRows).toBe(2);
  });

  it('back-fills history once for a newly held scheme, and not again afterwards', async () => {
    const hist = {
      data: [
        { date: '22-10-2026', nav: '10.1' },
        { date: '21-10-2026', nav: '10.0' },
      ],
    };
    const fresh = fakeStore({ held: ['100001'], navCounts: { '100001': 1 } });
    const r1 = await refreshMarketData(fresh.store, io({ json: () => hist }), '2026-10-26');
    expect(r1.historyRows).toBe(2);
    const done = fakeStore({ held: ['100001'], navCounts: { '100001': 500 } });
    const r2 = await refreshMarketData(done.store, io({ json: () => hist }), '2026-10-26');
    expect(r2.historyRows).toBe(0);
  });

  it('fetches the history again for a scheme whose stored history was cut short at the old 2018 floor', async () => {
    const hist = {
      data: [
        { date: '22-10-2026', nav: '10.1' },
        { date: '02-01-2018', nav: '8.0' },
        { date: '03-05-2012', nav: '5.0' },
      ],
    };
    const cut = fakeStore({ held: ['100001'], navCounts: { '100001': 500 } });
    cut.store.navFirst = async () => '2018-01-02';
    const r = await refreshMarketData(cut.store, io({ json: () => hist }), '2026-10-26');
    expect(r.historyRows).toBe(3);
    const whole = fakeStore({ held: ['100001'], navCounts: { '100001': 500 } });
    whole.store.navFirst = async () => '2012-05-03';
    expect(
      (await refreshMarketData(whole.store, io({ json: () => hist }), '2026-10-26')).historyRows,
    ).toBe(0);
  });

  it('warns, rather than failing, when an optional source is down or a scheme has no NAV', async () => {
    const { store } = fakeStore({
      held: ['100001', '999999'],
      navCounts: { '100001': 0, '999999': 99 },
      currencies: ['SGD'],
    });
    const boom: MarketIo = {
      fetchText: async () => amfiText(6000),
      fetchJson: async () => {
        throw new Error('503');
      },
    };
    const rep = await refreshMarketData(store, boom, '2026-10-26');
    expect(rep.warnings.some((w) => w.includes('999999'))).toBe(true);
    expect(rep.warnings.some((w) => w.includes('history for scheme 100001'))).toBe(true);
    expect(rep.warnings.some((w) => w.includes('SGD→INR'))).toBe(true);
  });

  it('fails loudly when the AMFI file is missing or malformed', async () => {
    const { store } = fakeStore();
    await expect(
      refreshMarketData(store, io({ text: '<html>blocked</html>' }), '2026-10-26'),
    ).rejects.toThrow(/looks wrong/);
    await expect(
      refreshMarketData(
        store,
        {
          fetchText: async () => {
            throw new Error('down');
          },
          fetchJson: async () => ({}),
        },
        '2026-10-26',
      ),
    ).rejects.toThrow('down');
  });

  it('stores FX for foreign currencies only, with a short back-fill the first time', async () => {
    const urls: string[] = [];
    const { store, calls } = fakeStore({ currencies: ['INR', 'SGD'], fxCount: 0 });
    const rep = await refreshMarketData(
      store,
      io({
        json: (u) => {
          urls.push(u);
          return u.includes('..')
            ? { rates: { '2026-10-22': { INR: 74.1 } } }
            : { date: '2026-10-23', rates: { INR: 74.263 } };
        },
      }),
      '2026-10-26',
    );
    expect(urls.filter((u) => u.includes('base=INR'))).toHaveLength(0);
    expect(urls.some((u) => u.includes('..'))).toBe(true);
    expect(calls.fx.map((r) => r.rate_date).sort()).toEqual(['2026-10-22', '2026-10-23']);
    expect(rep.fxRows).toBe(2);
  });
});

describe('automatic fund matching', () => {
  const scheme = (code: string, name: string, nav: number) =>
    ({
      code,
      name,
      plan: 'Direct',
      option: 'Growth',
      nav,
      navDate: '2026-10-23',
      amc: 'X',
      category: 'Equity',
      isinGrowth: null,
      isinReinvest: null,
    }) as never;
  it('reads a messy NAV note as a number', async () => {
    const { parseNavHint } = await import('../src/amfi');
    expect(parseNavHint('205.56.81')).toBe(205.56);
    expect(parseNavHint('abc')).toBeNull();
    expect(parseNavHint(null)).toBeNull();
  });
  it('picks a candidate only when it is clearly the one', async () => {
    const { autoPick } = await import('../src/amfi');
    const cand = (code: string, gap: number | null) => ({
      scheme: scheme(code, 'n', 1),
      score: 0.5,
      navGap: gap,
    });
    const amb = (c: ReturnType<typeof cand>[]) => ({
      input: 'x',
      confidence: 'ambiguous' as const,
      planWanted: 'unknown' as const,
      candidates: c,
    });
    expect(autoPick(amb([cand('1', 0.01), cand('2', 0.4)]))?.scheme.code).toBe('1');
    expect(autoPick(amb([cand('1', 0.01), cand('2', 0.02)]))).toBeNull();
    expect(autoPick(amb([cand('1', null), cand('2', null)]))).toBeNull();
    expect(autoPick(amb([]))).toBeNull();
  });
});
