/** What the pages show about the Google Sheet connection. Plain data; the key is never part of it. */
export interface SheetSyncInfo {
  /** a spreadsheet id and a key are both saved */
  connected: boolean;
  hasId: boolean;
  keySet: boolean;
  /** the address of the spreadsheet (its id is not a secret) */
  sheetUrl: string | null;
  /** the service account's e-mail: the address the sheet is shared with */
  email: string | null;
  tested: { at: string; ok: boolean; note: string | null } | null;
  last: { at: string; ok: boolean; month: string | null; note: string | null } | null;
}

/** The sheet's id from what was pasted: the whole address, or just the id. Null when it is neither. */
export function sheetIdFrom(input: string): string | null {
  const text = input.trim();
  if (/^[A-Za-z0-9_-]{20,120}$/.test(text)) return text;
  // a published-to-web address (/d/e/2PACX…) is not the sheet itself
  if (/\/spreadsheets\/d\/e\//.test(text)) return null;
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,120})(?:[/?#]|$)/.exec(text);
  return m ? m[1]! : null;
}

/** "last sync Oct 2026 on 26 Oct 2026, 12 rows changed", or why there is none. */
export function lastSyncText(
  last: SheetSyncInfo['last'],
  when: (iso: string) => string,
): string | null {
  if (!last) return null;
  const head = `${last.ok ? 'Last sync' : 'Last sync failed'}${last.month ? `, ${last.month}` : ''}, ${when(last.at)}`;
  return last.note ? `${head}: ${last.note}` : head;
}
