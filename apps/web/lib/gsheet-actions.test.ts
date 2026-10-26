import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeGoogle, throwawayKey } from '../../../packages/ingest/test/fake-google';
import { appAssets, monthRows, OWNERS } from '../../../packages/ingest/test/synthetic';

/**
 * The server actions behind the buttons, run against the fake Google: the saved key is fetched through the member-only function, used
 * and never returned, logged or put in a message; a sync runs once at a time; the outcome is remembered.
 */
const key = throwawayKey();
const SHEET = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD';
const stored = { sheet: SHEET, key: key.file };

interface Call {
  name: string;
  args: Record<string, unknown>;
}
const calls: Call[] = [];
let claimable = true;
let credsError = false;
let google: FakeGoogle;

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({
  loadContext: async () => ({
    householdId: 'h1',
    supabase: {
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'gsheet_credentials')
          return credsError
            ? { data: null, error: { message: 'x' } }
            : {
                data: stored.sheet ? [{ sheet_id: stored.sheet, service_key: stored.key }] : [],
                error: null,
              };
        if (name === 'claim_gsheet_sync') {
          const ok = claimable;
          claimable = false;
          return { data: ok, error: null };
        }
        return { data: null, error: null };
      },
    },
  }),
}));
vi.mock('@/lib/sheet-sync-data', () => ({
  loadSyncApp: async () => ({
    app: { assets: appAssets(), owners: OWNERS, defaultOwner: 'Asha' },
    config: {
      timeZone: 'Asia/Singapore',
      firstRow: 3,
      lastRow: 113,
      backupSuffix: ' - before sync',
    },
  }),
}));

const { applySheetSync, previewSheetSync, saveGoogleSheet, testGoogleSheet } =
  await import('@/app/(app)/gsheet/actions');

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const secrets = () => [key.privateKey.split('\n')[1]!.slice(0, 40), key.privateKey];

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-26T06:00:00Z'));
  calls.length = 0;
  claimable = true;
  credsError = false;
  google = new FakeGoogle(key, SHEET);
  google.add('Notes', [[{ v: 'x' }]]);
  google.add('Sep 2026', monthRows());
  google.add('Aug 2026', monthRows());
  vi.stubGlobal('fetch', (u: string, i?: Parameters<FakeGoogle['fetch']>[1]) => google.fetch(u, i));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('saving the connection', () => {
  it('stores a minimal key and the account e-mail, and never hands the key back', async () => {
    const r = await saveGoogleSheet(
      null,
      form({ sheet: `https://docs.google.com/spreadsheets/d/${SHEET}/edit#gid=0`, key: key.file }),
    );
    expect(r.ok).toBe(true);
    expect(r.message).toContain(key.email);
    for (const s of secrets()) expect(JSON.stringify(r)).not.toContain(s);
    const save = calls.find((c) => c.name === 'save_gsheet')!;
    expect(save.args).toMatchObject({
      p_household: 'h1',
      p_sheet_id: SHEET,
      p_email: key.email,
      p_clear: false,
    });
    expect(JSON.parse(save.args.p_key as string)).toEqual({
      type: 'service_account',
      client_email: key.email,
      private_key: key.privateKey,
      token_uri: 'https://oauth2.googleapis.com/token',
    });
  });

  it('can change only the link, or remove the connection', async () => {
    await saveGoogleSheet(null, form({ sheet: SHEET }));
    expect(calls.at(-1)!.args).toMatchObject({ p_sheet_id: SHEET, p_key: null, p_email: null });
    await saveGoogleSheet(null, form({ clear: 'on' }));
    expect(calls.at(-1)!.args).toMatchObject({ p_clear: true });
  });

  it('refuses a link that is not a Google Sheet and a key that is not a key file, saying what to do', async () => {
    const a = await saveGoogleSheet(null, form({ sheet: 'https://example.com/hello' }));
    expect(a.ok).toBe(false);
    expect(a.message).toMatch(/not the address of a Google Sheet/);
    const b = await saveGoogleSheet(null, form({ key: '{"private_key": "TOP-SECRET-TEXT"' }));
    expect(b.ok).toBe(false);
    expect(b.message).toMatch(/whole content of the .json file/);
    expect(b.message).not.toContain('TOP-SECRET-TEXT');
    expect(calls.some((c) => c.name === 'save_gsheet')).toBe(false);
  });
});

describe('testing the connection', () => {
  it('reports the steps, remembers the result and returns no secret', async () => {
    const t = await testGoogleSheet();
    expect(t.ok).toBe(true);
    expect(t.target).toBe('Oct 2026');
    expect(t.template).toBe('Sep 2026');
    for (const s of secrets()) expect(JSON.stringify(t)).not.toContain(s);
    expect(calls.find((c) => c.name === 'record_gsheet_test')!.args).toMatchObject({ p_ok: true });
  });

  it('says so when nothing is saved or the saved connection cannot be read', async () => {
    stored.sheet = '';
    const none = await testGoogleSheet();
    stored.sheet = SHEET;
    expect(none.ok).toBe(false);
    expect(none.steps[0]!.text).toMatch(/not connected yet/);
    credsError = true;
    expect(await previewSheetSync()).toMatchObject({ ok: false, code: 'no_connection' });
  });
});

describe('preview and sync', () => {
  it('a preview changes nothing in the spreadsheet', async () => {
    const r = await previewSheetSync();
    expect(r.ok && r.view.stage).toBe('preview');
    expect(
      google.calls.filter((c) => c.method === 'POST' && !c.url.includes('/token')),
    ).toHaveLength(0);
    expect(calls.some((c) => c.name === 'claim_gsheet_sync')).toBe(false);
  });

  it('a sync takes the lock, writes the month, and remembers what it did', async () => {
    const r = await applySheetSync();
    expect(r.ok && r.view.stage).toBe('applied');
    expect(google.tabOrder()).toEqual(['Notes', 'Oct 2026', 'Sep 2026', 'Aug 2026']);
    expect(google.value('Oct 2026', 'F5')).toBe(25_678.12);
    const done = calls.find((c) => c.name === 'record_gsheet_sync')!;
    expect(done.args).toMatchObject({ p_ok: true, p_month: 'Oct 2026' });
    expect(String(done.args.p_note)).toMatch(/changed.*cells written/);
    for (const s of secrets()) expect(JSON.stringify(calls)).not.toContain(s);
  });

  it('a second press while one is running is told to wait, and writes nothing', async () => {
    claimable = false;
    const r = await applySheetSync();
    expect(r).toMatchObject({ ok: false, code: 'busy' });
    expect(google.tabOrder()).toEqual(['Notes', 'Sep 2026', 'Aug 2026']);
  });

  it('a failed sync is remembered with the reason and frees the lock', async () => {
    google.shared = false;
    const r = await applySheetSync();
    expect(r.ok).toBe(false);
    const done = calls.find((c) => c.name === 'record_gsheet_sync')!;
    expect(done.args).toMatchObject({ p_ok: false, p_month: null });
    expect(String(done.args.p_note)).toMatch(/not shared with the service account/);
  });
});
