import { describe, expect, it } from 'vitest';
import { lastSyncText, sheetIdFrom } from './sheet-sync-status';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-aBcD';

describe('the spreadsheet id', () => {
  it('is taken from the whole address or from the bare id', () => {
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
    expect(sheetIdFrom(`  https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing `)).toBe(
      ID,
    );
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/${ID}`)).toBe(ID);
    expect(sheetIdFrom(ID)).toBe(ID);
  });

  it('is refused when it is something else', () => {
    expect(sheetIdFrom('')).toBeNull();
    expect(sheetIdFrom('my sheet')).toBeNull();
    expect(sheetIdFrom('https://example.com/spreadsheets/d/short')).toBeNull();
    // a link published to the web is not the sheet itself
    expect(sheetIdFrom(`https://docs.google.com/spreadsheets/d/e/${ID}/pubhtml`)).toBeNull();
  });
});

describe('the last sync line', () => {
  const when = (iso: string) => iso.slice(0, 10);
  it('says when, which month and how it went', () => {
    expect(lastSyncText(null, when)).toBeNull();
    expect(
      lastSyncText(
        { at: '2026-10-26T06:00:00Z', ok: true, month: 'Oct 2026', note: '12 rows changed' },
        when,
      ),
    ).toBe('Last sync, Oct 2026, 2026-10-26: 12 rows changed');
    expect(
      lastSyncText({ at: '2026-10-26T06:00:00Z', ok: false, month: null, note: null }, when),
    ).toBe('Last sync failed, 2026-10-26');
  });
});
