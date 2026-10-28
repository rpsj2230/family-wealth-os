/**
 * The price history of one scheme, fetched once when a fund is matched to it, so its value is available at once instead of after
 * tonight's market-data job. It reads the same public history the job reads (mfapi.in, a mirror of AMFI data) through the job's own
 * parser (`parseHistory`) and stores it the way the job does: one row per scheme and day, an existing day never changed.
 * Idempotent: a scheme that already has its history is left alone.
 */
import { parseHistory, type NavRow } from './market';

export interface SchemeHistoryStore {
  navCount(code: string): Promise<number>;
  /** stores rows (a day already stored is kept as it is) */
  saveNavs(code: string, rows: NavRow[]): Promise<void>;
}

export interface SchemeHistoryIo {
  fetchJson(url: string): Promise<unknown>;
}

export type SchemeHistoryStatus = 'fetched' | 'already' | 'empty' | 'failed';

export interface SchemeHistoryResult {
  status: SchemeHistoryStatus;
  rows: number;
  message: string;
}

/** The market-data job treats a scheme with more rows than this as already back-filled. */
export const HISTORY_PRESENT_ROWS = 5;
const CHUNK = 1000;

export async function fetchSchemeHistory(
  code: string,
  io: SchemeHistoryIo,
  store: SchemeHistoryStore,
): Promise<SchemeHistoryResult> {
  if (!/^\d{3,8}$/.test(code)) return { status: 'failed', rows: 0, message: 'Not a scheme code.' };
  try {
    if ((await store.navCount(code)) > HISTORY_PRESENT_ROWS)
      return { status: 'already', rows: 0, message: 'The price history is already stored.' };
    const rows = parseHistory(await io.fetchJson(`https://api.mfapi.in/mf/${code}`), code);
    if (rows.length === 0)
      return {
        status: 'empty',
        rows: 0,
        message: 'No price history was found for this scheme yet; tonight’s update will try again.',
      };
    for (let i = 0; i < rows.length; i += CHUNK)
      await store.saveNavs(code, rows.slice(i, i + CHUNK));
    return { status: 'fetched', rows: rows.length, message: `${rows.length} daily prices stored.` };
  } catch (e) {
    return {
      status: 'failed',
      rows: 0,
      message: `The price history could not be fetched now (${(e as Error).message}); tonight’s update will fetch it.`,
    };
  }
}
