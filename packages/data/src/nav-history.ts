/**
 * The price history of the schemes whose funds have their units rebuilt from a plan: every price from a little before the fund's start.
 * That is years of days for a dozen schemes, so it is kept in the server's memory once read: past prices do not change, so a later
 * read asks only for the days after the newest one it has, and the whole history is read again only after half a day. Prices are public
 * data (readable by every signed-in person), so the cache is shared by all requests.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { pageAll } from './paging';

export interface NavPoint {
  date: string;
  nav: number;
}

interface Held {
  from: string;
  rows: NavPoint[];
  readAt: number;
}

const HALF_DAY_MS = 12 * 3_600_000;
const cache = new Map<string, Held>();

/** For tests: forget everything read so far. */
export const clearNavHistoryCache = () => cache.clear();

type Row = { amfi_code?: string; nav_date: string; nav: number | string };

/** The prices of each scheme from its `from` day to the latest, oldest first. Schemes are read side by side. */
export async function loadNavHistory(
  db: SupabaseClient,
  wants: { code: string; from: string }[],
  now = Date.now(),
): Promise<Map<string, NavPoint[]>> {
  const out = new Map<string, NavPoint[]>();
  const earliest = new Map<string, string>();
  for (const w of wants) {
    const have = earliest.get(w.code);
    if (!have || w.from < have) earliest.set(w.code, w.from);
  }
  await Promise.all(
    [...earliest].map(async ([code, from]) => {
      const held = cache.get(code);
      const fresh = held && held.from <= from && now - held.readAt < HALF_DAY_MS;
      let rows: NavPoint[];
      if (fresh && held) {
        const last = held.rows[held.rows.length - 1]?.date ?? from;
        const more = await pageAll<Row>((a, b) =>
          db
            .from('mf_navs')
            .select('nav_date, nav')
            .eq('amfi_code', code)
            .gt('nav_date', last)
            .order('nav_date')
            .range(a, b),
        );
        rows = [...held.rows, ...more.map((r) => ({ date: r.nav_date, nav: Number(r.nav) }))];
        cache.set(code, { from: held.from, rows, readAt: held.readAt });
      } else {
        const all = await pageAll<Row>((a, b) =>
          db
            .from('mf_navs')
            .select('nav_date, nav')
            .eq('amfi_code', code)
            .gte('nav_date', from)
            .order('nav_date')
            .range(a, b),
        );
        rows = all.map((r) => ({ date: r.nav_date, nav: Number(r.nav) }));
        cache.set(code, { from, rows, readAt: now });
      }
      out.set(code, rows);
    }),
  );
  return out;
}
