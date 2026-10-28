import { searchSchemes, shortlistWords, type AmfiScheme } from '@fwos/ingest';
import type { Ctx } from './data';

type Db = Ctx['supabase'];

export interface SchemeRowDb {
  code: string;
  name: string;
  plan: string | null;
  option: string | null;
  amc: string | null;
  category: string | null;
  isin_growth: string | null;
  isin_reinvest: string | null;
}

export const SCHEME_COLUMNS = 'code, name, plan, option, amc, category, isin_growth, isin_reinvest';

/** The stored scheme list holds the plan and option as text; the matcher reads them as the AMFI file's. */
export function schemeFromRow(r: SchemeRowDb): AmfiScheme {
  const plan = /direct/i.test(r.plan ?? '')
    ? 'Direct'
    : /regular/i.test(r.plan ?? '')
      ? 'Regular'
      : 'Other';
  const option = /growth/i.test(r.option ?? '')
    ? 'Growth'
    : /idcw|dividend/i.test(r.option ?? '')
      ? 'IDCW'
      : 'Other';
  return {
    code: r.code,
    isinGrowth: r.isin_growth,
    isinReinvest: r.isin_reinvest,
    name: r.name,
    plan,
    option,
    nav: null,
    navDate: null,
    amc: r.amc ?? '',
    category: r.category ?? '',
  };
}

/** "midcap" is written "Mid Cap", "Midcap" or "Mid-Cap" in the list: a pattern that finds every spelling. */
const SPLIT: Record<string, string> = {
  midcap: 'mid%cap',
  smallcap: 'small%cap',
  largecap: 'large%cap',
  flexicap: 'flexi%cap',
  multicap: 'multi%cap',
  taxsaver: 'tax%saver',
  balancedadvantage: 'balanced%advantage',
};
export const likePattern = (word: string) => `%${SPLIT[word] ?? word}%`;

/** The words to look a fund up by: the most telling two (the longest), so a stray extra word in a sheet does not hide the scheme. */
export function lookupWords(name: string, take: number): string[] {
  return [...shortlistWords(name)]
    .filter((w) => /^[a-z0-9]+$/.test(w))
    .sort((a, b) => b.length - a.length || a.localeCompare(b))
    .slice(0, take);
}

const POOL = 400;
/** How many telling words a fund is looked up by. */
const LOOKUP_WORDS = 2;

/** The schemes that could be this fund: those with its ISINs, and those whose names have its most telling words. */
export async function schemesForFund(
  db: Db,
  fund: { name: string; isins: string[] },
  take = LOOKUP_WORDS,
): Promise<AmfiScheme[]> {
  const out = new Map<string, AmfiScheme>();
  const isins = [
    ...new Set(
      fund.isins.map((i) => i.trim().toUpperCase()).filter((i) => /^INF[0-9A-Z]{9}$/.test(i)),
    ),
  ];
  if (isins.length > 0) {
    const list = isins.join(',');
    const r = await db
      .from('amfi_schemes')
      .select(SCHEME_COLUMNS)
      .or(`isin_growth.in.(${list}),isin_reinvest.in.(${list})`)
      .limit(POOL);
    for (const row of (r.data ?? []) as unknown as SchemeRowDb[])
      out.set(row.code, schemeFromRow(row));
  }
  const words = lookupWords(fund.name, take);
  if (words.length > 0) {
    let q = db.from('amfi_schemes').select(SCHEME_COLUMNS);
    for (const w of words) q = q.ilike('name', likePattern(w));
    const r = await q.limit(POOL);
    for (const row of (r.data ?? []) as unknown as SchemeRowDb[])
      out.set(row.code, schemeFromRow(row));
  }
  return [...out.values()];
}

/** Schemes by what a person types: words of the name, an ISIN or an AMFI code. The best `limit`, ranked. */
export async function searchSchemeList(
  db: Db,
  query: string,
  limit: number,
): Promise<AmfiScheme[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  let rows: SchemeRowDb[];
  if (/^\d{3,8}$/.test(q)) {
    const r = await db.from('amfi_schemes').select(SCHEME_COLUMNS).eq('code', q).limit(1);
    rows = (r.data ?? []) as unknown as SchemeRowDb[];
  } else if (/^INF[0-9A-Z]{9}$/i.test(q)) {
    const i = q.toUpperCase();
    const r = await db
      .from('amfi_schemes')
      .select(SCHEME_COLUMNS)
      .or(`isin_growth.eq.${i},isin_reinvest.eq.${i}`)
      .limit(5);
    rows = (r.data ?? []) as unknown as SchemeRowDb[];
  } else {
    const words = lookupWords(q, 4);
    if (words.length === 0) return [];
    let b = db.from('amfi_schemes').select(SCHEME_COLUMNS);
    for (const w of words) b = b.ilike('name', likePattern(w));
    const r = await b.limit(POOL);
    rows = (r.data ?? []) as unknown as SchemeRowDb[];
  }
  return searchSchemes(q, rows.map(schemeFromRow), limit);
}

/** One scheme by AMFI code, from the stored list (null when it is not there). */
export async function schemeByCode(db: Db, code: string): Promise<AmfiScheme | null> {
  const r = await db.from('amfi_schemes').select(SCHEME_COLUMNS).eq('code', code).limit(1);
  const row = ((r.data ?? []) as unknown as SchemeRowDb[])[0];
  return row ? schemeFromRow(row) : null;
}
