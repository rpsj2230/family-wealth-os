import { GoogleSheetsClient, parseServiceAccountKey } from '../src/gsheet-client';
import type { SyncConfig } from '../src/sheet-sync-run';
import { API_BASE, FakeGoogle, TOKEN_URL, throwawayKey, type FakeCell } from './fake-google';
import { monthRows } from './synthetic';

/** One throwaway key pair for the whole test run: generating an RSA key is the slow part. */
export const KEY = throwawayKey();

export const CONFIG: SyncConfig = {
  timeZone: 'Asia/Singapore',
  firstRow: 3,
  lastRow: 113,
  backupSuffix: ' - before sync',
};

/** 26 October 2026, 14:00 in Singapore. */
export const NOW = new Date('2026-10-26T06:00:00Z');

export function world(opts: { clock?: () => number } = {}) {
  const clock = opts.clock ?? (() => NOW.getTime());
  const google = new FakeGoogle(KEY, 'sheet-id-synthetic-0001', clock);
  const client = new GoogleSheetsClient(parseServiceAccountKey(KEY.file), {
    // a bug inside the fake would otherwise look like a network failure: keep it where a test can see it
    fetch: async (u, i) => {
      try {
        return await google.fetch(u, i);
      } catch (e) {
        google.lastError = e;
        throw e;
      }
    },
    tokenUrl: TOKEN_URL,
    apiBase: API_BASE,
    sleep: async () => {},
    now: clock,
    tokenCache: new Map(),
  });
  return { google, client };
}

/** A workbook the way the household keeps it: a summary tab and one tab per month, newest on the left. */
export function workbook(months: string[] = ['Sep 2026', 'Aug 2026'], rows: () => FakeCell[][] = monthRows) {
  const w = world();
  w.google.add('Notes', [[{ v: 'not a month' }]]);
  for (const m of months) w.google.add(m, rows());
  return w;
}

/** Reads a month's rows back through the client, as the sync does. */
export async function gridOf(rows: FakeCell[][]) {
  const w = world();
  w.google.add('Oct 2026', rows);
  const { tabs } = await w.client.listTabs(w.google.spreadsheetId);
  return w.client.readGrid(w.google.spreadsheetId, tabs[0]!, 200, 'AD');
}
