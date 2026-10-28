import { describe, expect, it } from 'vitest';
import { HISTORY_PRESENT_ROWS, fetchSchemeHistory } from '../src/scheme-history';
import type { NavRow } from '../src/market';

const history = (n: number) => ({
  data: Array.from({ length: n }, (_, i) => ({
    date: `${String((i % 28) + 1).padStart(2, '0')}-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-2024`,
    nav: String(100 + i),
  })),
});

function setup(stored = 0, json: unknown = history(60), fail = false) {
  const urls: string[] = [];
  const saved: { code: string; rows: NavRow[] }[] = [];
  const io = {
    async fetchJson(url: string) {
      urls.push(url);
      if (fail) throw new Error('mfapi.in answered 503');
      return json;
    },
  };
  const store = {
    async navCount() {
      return stored;
    },
    async saveNavs(code: string, rows: NavRow[]) {
      saved.push({ code, rows });
    },
  };
  return { io, store, urls, saved };
}

describe('fetching one scheme history when a fund is matched', () => {
  it('fetches the history once, through the job’s own parser, and stores it', async () => {
    const t = setup();
    const r = await fetchSchemeHistory('120465', t.io, t.store);
    expect(r.status).toBe('fetched');
    expect(r.rows).toBe(60);
    expect(t.urls).toEqual(['https://api.mfapi.in/mf/120465']);
    expect(t.saved.flatMap((s) => s.rows)).toHaveLength(60);
    expect(t.saved[0]!.rows[0]).toMatchObject({ amfi_code: '120465', source: 'mfapi' });
  });
  it('leaves a scheme that already has its history alone, without any network call', async () => {
    const t = setup(HISTORY_PRESENT_ROWS + 1);
    const r = await fetchSchemeHistory('120465', t.io, t.store);
    expect(r.status).toBe('already');
    expect(t.urls).toHaveLength(0);
    expect(t.saved).toHaveLength(0);
  });
  it('stores a long history in chunks', async () => {
    const t = setup(0, history(2500));
    await fetchSchemeHistory('120465', t.io, t.store);
    expect(t.saved.map((s) => s.rows.length)).toEqual([1000, 1000, 500]);
  });
  it('an empty answer and a failed fetch are reported, never thrown, and store nothing', async () => {
    const empty = setup(0, { data: [] });
    expect((await fetchSchemeHistory('120465', empty.io, empty.store)).status).toBe('empty');
    expect(empty.saved).toHaveLength(0);
    const down = setup(0, null, true);
    const r = await fetchSchemeHistory('120465', down.io, down.store);
    expect(r.status).toBe('failed');
    expect(r.message).toContain('tonight');
    expect(down.saved).toHaveLength(0);
  });
  it('refuses something that is not a scheme code', async () => {
    const t = setup();
    expect((await fetchSchemeHistory('../x', t.io, t.store)).status).toBe('failed');
    expect(t.urls).toHaveLength(0);
  });
});
