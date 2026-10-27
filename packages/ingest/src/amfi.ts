/**
 * AMFI daily NAV file (https://portal.amfiindia.com/spages/NAVAll.txt) parser and a careful fund-name matcher.
 * Public data. Nothing here talks to the network: callers pass the text.
 */
export interface AmfiScheme {
  code: string;
  isinGrowth: string | null;
  isinReinvest: string | null;
  name: string;
  plan: 'Direct' | 'Regular' | 'Other';
  option: 'Growth' | 'IDCW' | 'Other';
  nav: number | null;
  navDate: string | null; // YYYY-MM-DD
  amc: string;
  category: string;
}

const MONTHS: Record<string, string> = {
  jan: '01',
  feb: '02',
  mar: '03',
  apr: '04',
  may: '05',
  jun: '06',
  jul: '07',
  aug: '08',
  sep: '09',
  oct: '10',
  nov: '11',
  dec: '12',
};

function parseDate(s: string): string | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const mm = MONTHS[m[2]!.toLowerCase()];
  return mm ? `${m[3]}-${mm}-${m[1]!.padStart(2, '0')}` : null;
}

/** Parses the whole NAVAll.txt body. Header, blank lines, category lines and AMC lines are tracked, not returned as schemes. */
export function parseNavAll(text: string): AmfiScheme[] {
  const out: AmfiScheme[] = [];
  let category = '';
  let amc = '';
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('Scheme Code')) continue;
    const parts = line.split(';');
    if (parts.length >= 8) {
      const [code, isin1, isin2, name, plan, option, nav, date] = parts.map((p) => p.trim()) as [
        string,
        string,
        string,
        string,
        string,
        string,
        string,
        string,
      ];
      if (!/^\d+$/.test(code)) continue;
      const n = Number(nav);
      out.push({
        code,
        isinGrowth: isin1 && isin1 !== '-' ? isin1 : null,
        isinReinvest: isin2 && isin2 !== '-' ? isin2 : null,
        name,
        plan: /direct/i.test(plan) ? 'Direct' : /regular/i.test(plan) ? 'Regular' : 'Other',
        option: /growth/i.test(option)
          ? 'Growth'
          : /idcw|dividend/i.test(option)
            ? 'IDCW'
            : 'Other',
        nav: Number.isFinite(n) && nav !== '' ? n : null,
        navDate: parseDate(date),
        amc,
        category,
      });
    } else if (/^(Open|Close|Interval)[A-Za-z ]*Schemes?\s*\(/i.test(line)) {
      category = line.replace(/^[^(]*\(/, '').replace(/\)\s*$/, '');
    } else if (
      /mutual fund|asset management|amc/i.test(line) ||
      (parts.length === 1 && !line.includes(';'))
    ) {
      amc = line;
    }
  }
  return out;
}

// -------------------------------------------------------------------------------------------------
// Name matching
// -------------------------------------------------------------------------------------------------
const NOISE = new Set([
  'fund',
  'plan',
  'growth',
  'direct',
  'regular',
  'option',
  'scheme',
  'the',
  'of',
  'in',
  'a',
  'and',
  'stopped',
  'hdfc-held',
  'idcw',
  'dividend',
  'mutual',
]);
const ALIASES: [RegExp, string][] = [
  [/\bmid[\s-]*cap\b/g, 'midcap'],
  [/\bsmall[\s-]*cap\b/g, 'smallcap'],
  [/\blarge[\s-]*cap\b/g, 'largecap'],
  [/\bflexi[\s-]*cap\b/g, 'flexicap'],
  [/\bmulti[\s-]*cap\b/g, 'multicap'],
  [/\bblue[\s-]*chip\b/g, 'bluechip'],
  [/\bsmall and mid\b/g, 'small mid'],
  [/\belss\b/g, 'elss'],
  [/\btax saver\b/g, 'taxsaver'],
  [/\bbalanced advantage\b/g, 'balancedadvantage'],
];

export function coreTokens(name: string): string[] {
  let s = name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ');
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  return s.split(/[\s-]+/).filter((t) => t && !NOISE.has(t));
}

/** Words that only decorate a scheme name on one statement or another. */
const KEY_NOISE = new Set([
  'dir',
  'gr',
  'reg',
  'ltd',
  'limited',
  'erstwhile',
  'formerly',
  'fka',
  'demat',
  'payout',
  'reinvestment',
  'etf',
]);

export interface SchemeKey {
  /** the words that identify the scheme, sorted: "Edelweiss Mid Cap Growth Direct Plan" and "Edelweiss Mid Cap Fund - Direct Plan - Growth" are the same */
  tokens: string[];
  /** Direct and Regular are different funds with different ISINs; null when the name does not say */
  plan: 'direct' | 'regular' | null;
  /** Growth and IDCW (dividend) are different too */
  option: 'growth' | 'idcw' | null;
  key: string;
}

/**
 * A tolerant key for a scheme name: the identifying words (case, order, "Fund", "Plan", "Option", hyphens and brackets do not matter;
 * "Mid Cap" is "Midcap", "Bluechip" is "Large Cap"), plus the plan and the option kept apart, because those change the fund.
 */
export function schemeKey(name: string): SchemeKey {
  const bare = name.toLowerCase().replace(/\(.*?\)/g, ' ');
  const plan = /\bdirect\b|\bdir\b/.test(bare)
    ? 'direct'
    : /\bregular\b|\breg\b/.test(bare)
      ? 'regular'
      : null;
  const option = /\b(idcw|dividend|payout|reinvest\w*)\b/.test(bare)
    ? 'idcw'
    : /\bgrowth\b|\bgr\b/.test(bare)
      ? 'growth'
      : null;
  const tokens = [
    ...new Set(
      coreTokens(name)
        .filter((t) => !KEY_NOISE.has(t))
        .map((t) => (t === 'bluechip' ? 'largecap' : t)),
    ),
  ].sort();
  return { tokens, plan, option, key: tokens.join(' ') };
}

/** False when the two names say different things about the plan or the option (so they cannot be the same fund). */
export function schemeKeysCompatible(a: SchemeKey, b: SchemeKey): boolean {
  return (
    (!a.plan || !b.plan || a.plan === b.plan) && (!a.option || !b.option || a.option === b.option)
  );
}

export interface Candidate {
  scheme: AmfiScheme;
  score: number;
  /** |NAV today - NAV in the sheet's note| / that NAV, when the sheet gave one (a weak sanity check, NAV moves) */
  navGap: number | null;
}

export interface MatchResult {
  input: string;
  /** 'confident' = one clear Direct-Growth candidate with no extra words; otherwise a person should choose */
  confidence: 'confident' | 'ambiguous' | 'none';
  planWanted: 'direct' | 'unknown';
  candidates: Candidate[];
}

/** Funds are sometimes renamed (e.g. "Bluechip" became "Large Cap"); try both spellings. */
function wantedSets(name: string): string[][] {
  const base = coreTokens(name);
  const sets = [base];
  if (base.includes('bluechip')) sets.push(base.map((t) => (t === 'bluechip' ? 'largecap' : t)));
  return sets;
}

/**
 * Suggests AMFI schemes for a fund name from a spreadsheet. A candidate must contain every meaningful word of the name.
 * Direct vs Regular is taken from the name; when the name says neither, both are offered and the match is never "confident".
 * `navHint` (the NAV written in the sheet's note) is only shown as a sanity check; it never decides a match.
 */
export function matchFund(
  name: string,
  schemes: AmfiScheme[],
  navHint: number | null = null,
): MatchResult {
  const sets = wantedSets(name);
  const planWanted: 'direct' | 'unknown' = /direct/i.test(name) ? 'direct' : 'unknown';
  if (sets[0]!.length === 0) return { input: name, confidence: 'none', planWanted, candidates: [] };
  const pool = schemes.filter(
    (s) =>
      s.option === 'Growth' && (planWanted === 'direct' ? s.plan === 'Direct' : s.plan !== 'Other'),
  );
  const cands = new Map<string, Candidate>();
  for (const want of sets) {
    for (const s of pool) {
      const have = new Set(coreTokens(s.name));
      if (!want.every((t) => have.has(t))) continue;
      const extra = have.size - want.length;
      const score = 1 / (1 + Math.max(0, extra));
      const prev = cands.get(s.code);
      if (!prev || score > prev.score) {
        cands.set(s.code, {
          scheme: s,
          score,
          navGap: navHint && s.nav ? Math.abs(s.nav - navHint) / navHint : null,
        });
      }
    }
  }
  const top = [...cands.values()]
    .sort((a, b) => b.score - a.score || a.scheme.name.length - b.scheme.name.length)
    .slice(0, 4);
  if (top.length === 0) return { input: name, confidence: 'none', planWanted, candidates: [] };
  const clear =
    planWanted === 'direct' && top[0]!.score === 1 && (top.length === 1 || top[1]!.score < 1);
  return {
    input: name,
    confidence: clear ? 'confident' : 'ambiguous',
    planWanted,
    candidates: top,
  };
}

/** The NAV note in the sheet is free text ("205.56.81"); read the first plausible number, or null. */
export function parseNavHint(raw: string | null | undefined): number | null {
  const m = /(\d+(?:\.\d+)?)/.exec(raw ?? '');
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Pick a scheme without asking: either the matcher is confident, or exactly one candidate has a NAV within 5% of the
 * NAV written in the sheet while no other candidate does. Anything else stays unmatched and is listed in the report.
 */
export function autoPick(m: MatchResult): Candidate | null {
  if (m.candidates.length === 0) return null;
  if (m.confidence === 'confident') return m.candidates[0]!;
  const close = m.candidates.filter((c) => c.navGap !== null && c.navGap <= 0.05);
  return close.length === 1 ? close[0]! : null;
}
