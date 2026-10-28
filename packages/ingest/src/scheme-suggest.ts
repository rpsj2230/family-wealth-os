/**
 * Which official scheme is a fund? A pure ranking of AMFI schemes for a fund that has no price source yet, with the reason for each
 * (docs/UI-GUIDE.md, "Suggest, do not hand back"). Nothing here reads the network or the database: callers pass the schemes.
 *
 * The rules, strongest first:
 *   1. certain: an ISIN known for the fund (saved on it, on a statement on file, or on the statement being previewed) is one of the
 *      scheme's ISINs in the official list (payout / growth, or reinvestment). Exactly one scheme must have it.
 *   2. high: the fund's name, normalised, is the scheme's name, and the name itself says the plan (Direct / Regular) and the option
 *      (Growth / IDCW), and the scheme has that plan and option.
 *   3. medium: same words in the name (the fund house included) and the plan known (from the name, or from the fund's saved plan),
 *      with the option read from the name or taken as Growth when the name does not say IDCW.
 *   4. otherwise nothing is recommended: the best few schemes are listed with how they differ ("Regular instead of Direct",
 *      "IDCW instead of Growth") and the person is asked to choose.
 * A scheme is never recommended across Direct / Regular or Growth / IDCW on the strength of the name alone.
 */
import { coreTokens, schemeKey, type AmfiScheme } from './amfi';

export type SchemeCertainty = 'certain' | 'high' | 'medium' | 'low';

export interface KnownIsin {
  isin: string;
  /** where it was read: saved on the fund, on a statement already on file, or on the statement being previewed */
  source: 'fund' | 'statement' | 'preview';
}

export interface FundToMatch {
  assetId: string;
  name: string;
  isins: KnownIsin[];
  /** the plan saved on the fund when its name does not say */
  planType?: 'direct' | 'regular' | 'regular_or_unknown' | null;
}

export interface SchemeChoice {
  scheme: AmfiScheme;
  certainty: SchemeCertainty;
  /** one sentence: why this scheme */
  reason: string;
  /** how it differs from the first choice ("Regular instead of Direct"); empty for the first choice */
  differences: string[];
  /** the ISIN that matched, when it was matched by ISIN */
  matchedIsin: string | null;
}

export interface SchemeSuggestion {
  assetId: string;
  /** the scheme to recommend, or null when the evidence does not point to exactly one */
  recommended: SchemeChoice | null;
  /** the recommended scheme first, then the other plausible ones */
  choices: SchemeChoice[];
  /** what was found, in a sentence: used when nothing is recommended */
  note: string;
}

export interface SuggestOptions {
  /** how many schemes to list at most (Settings: funds.matchChoices) */
  maxChoices: number;
}

const WHERE: Record<KnownIsin['source'], string> = {
  fund: 'saved on this fund',
  statement: 'on a fund statement already on file',
  preview: 'on the statement being previewed',
};

/** Words that only describe the fund house, never the scheme. */
const HOUSE_NOISE = new Set([
  'asset',
  'management',
  'company',
  'amc',
  'ltd',
  'limited',
  'trustee',
  'private',
  'pvt',
  'mf',
  'mutual',
  'fund',
]);
/** Short forms written in sheets and statements. */
const SYNONYMS: Record<string, string> = { pru: 'prudential', mfs: 'mutual' };

const normIsin = (s: string) => s.trim().toUpperCase();

/** The identifying words of a name, with the short forms spelled out. */
function words(name: string): string[] {
  return [...new Set(schemeKey(tidy(name)).tokens.map((t) => SYNONYMS[t] ?? t))];
}

/** A statement's scheme line can run on into the next column ("… Growth Option Registrar : KFINTECH"): only the name counts. */
const tidy = (name: string) => name.replace(/\bregistrar\b.*$/i, '').trim();

function houseWords(amc: string): string[] {
  return coreTokens(amc).filter((t) => !HOUSE_NOISE.has(t));
}

/** Direct / Regular of a scheme: its own column, else what its name says. */
export function planOf(s: AmfiScheme): 'direct' | 'regular' | null {
  if (s.plan === 'Direct') return 'direct';
  if (s.plan === 'Regular') return 'regular';
  return schemeKey(s.name).plan;
}

/** Growth / IDCW of a scheme: its own column, else what its name says. */
export function optionOf(s: AmfiScheme): 'growth' | 'idcw' | null {
  if (s.option === 'Growth') return 'growth';
  if (s.option === 'IDCW') return 'idcw';
  return schemeKey(s.name).option;
}

const PLAN_TEXT = { direct: 'Direct', regular: 'Regular' } as const;
const OPTION_TEXT = { growth: 'Growth', idcw: 'IDCW' } as const;

/** "Direct, Growth" for a scheme (what makes two schemes of one fund different). */
export function planOptionText(s: AmfiScheme): string {
  const p = planOf(s);
  const o = optionOf(s);
  return [p ? PLAN_TEXT[p] : 'plan not stated', o ? OPTION_TEXT[o] : 'option not stated'].join(
    ', ',
  );
}

/** The scheme's name as a person would write it: the official name, plus the plan and option when the name leaves them out. */
export function schemeLabel(s: AmfiScheme): string {
  const k = schemeKey(s.name);
  const p = planOf(s);
  const o = optionOf(s);
  const tail = [
    p && !k.plan ? `${PLAN_TEXT[p]} Plan` : null,
    o && !k.option ? `${OPTION_TEXT[o]} Option` : null,
  ].filter((x): x is string => !!x);
  return tail.length > 0 ? `${s.name} - ${tail.join(' - ')}` : s.name;
}

/** The ISINs the official list gives a scheme. */
export const schemeIsins = (s: AmfiScheme): string[] =>
  [s.isinGrowth, s.isinReinvest].filter((x): x is string => !!x).map(normIsin);

/** How `s` differs from `base`, in words ("Regular instead of Direct", "IDCW instead of Growth", "a different scheme name"). */
export function differencesFrom(s: AmfiScheme, base: AmfiScheme): string[] {
  const out: string[] = [];
  const [sp, bp] = [planOf(s), planOf(base)];
  if (sp && bp && sp !== bp) out.push(`${PLAN_TEXT[sp]} instead of ${PLAN_TEXT[bp]}`);
  const [so, bo] = [optionOf(s), optionOf(base)];
  if (so && bo && so !== bo) out.push(`${OPTION_TEXT[so]} instead of ${OPTION_TEXT[bo]}`);
  if (words(s.name).join(' ') !== words(base.name).join(' '))
    out.push(`a different scheme (${s.name})`);
  if (out.length === 0 && s.code !== base.code)
    out.push(
      !planOf(s) && !optionOf(s)
        ? `the official list gives no plan or option for it; only its ISIN (${schemeIsins(s)[0] ?? 'none'}) tells it apart`
        : `the same plan and option, listed under another AMFI code`,
    );
  return out;
}

interface Scored {
  s: AmfiScheme;
  /** the fund's words are the scheme's words exactly */
  exact: boolean;
  /** every one of the fund's words is in the scheme's name or fund house */
  contains: boolean;
  extras: number;
  shared: number;
}

function score(fundWords: string[], s: AmfiScheme): Scored {
  const have = new Set([...words(s.name), ...houseWords(s.amc)]);
  const own = new Set(words(s.name));
  const shared = fundWords.filter((w) => have.has(w)).length;
  const contains = shared === fundWords.length;
  const exact = contains && own.size === fundWords.length && fundWords.every((w) => own.has(w));
  return { s, exact, contains, extras: Math.max(0, own.size - shared), shared };
}

/** Listing order when the choice is the person's: Growth before IDCW, Direct before Regular. */
const pref = (s: AmfiScheme) =>
  (optionOf(s) === 'growth' ? 0 : optionOf(s) === 'idcw' ? 2 : 4) +
  (planOf(s) === 'direct' ? 0 : planOf(s) === 'regular' ? 1 : 3);

/**
 * Ranks the schemes for one fund. `schemes` may be a shortlist (the schemes whose names share words with the fund, plus those with its
 * ISINs): the ranking only needs every plausible scheme to be in it.
 */
export function suggestSchemes(
  fund: FundToMatch,
  schemes: AmfiScheme[],
  opts: SuggestOptions,
): SchemeSuggestion {
  const max = Math.max(1, opts.maxChoices);
  const base = { assetId: fund.assetId };
  const finish = (
    recommended: SchemeChoice | null,
    rest: SchemeChoice[],
    note: string,
  ): SchemeSuggestion => {
    const first = recommended ?? rest[0] ?? null;
    const list = (recommended ? [recommended, ...rest] : rest).slice(0, max);
    return {
      ...base,
      recommended,
      choices: list.map((c) => ({
        ...c,
        differences:
          first && c.scheme.code !== first.scheme.code
            ? differencesFrom(c.scheme, first.scheme)
            : [],
      })),
      note,
    };
  };

  // 1. ISIN
  const isins = fund.isins.map((i) => ({ ...i, isin: normIsin(i.isin) }));
  const byIsin = new Map<string, { s: AmfiScheme; isin: KnownIsin }>();
  for (const s of schemes)
    for (const k of isins)
      if (schemeIsins(s).includes(k.isin) && !byIsin.has(s.code))
        byIsin.set(s.code, { s, isin: k });
  const missed = isins.filter((k) => !schemes.some((s) => schemeIsins(s).includes(k.isin)));
  let isinNote = '';
  if (byIsin.size === 1) {
    const { s, isin } = [...byIsin.values()][0]!;
    const certain: SchemeChoice = {
      scheme: s,
      certainty: 'certain',
      reason: `The ISIN ${isin.isin} (${WHERE[isin.source]}) is this scheme's ISIN in the official list, so it is the same scheme.`,
      differences: [],
      matchedIsin: isin.isin,
    };
    return finish(certain, byName(fund, schemes, max, new Set([s.code])), '');
  }
  if (byIsin.size > 1) {
    const hits = [...byIsin.values()].map(({ s, isin }): SchemeChoice => ({
      scheme: s,
      certainty: 'low',
      reason: `The ISIN ${isin.isin} (${WHERE[isin.source]}) is listed for this scheme.`,
      differences: [],
      matchedIsin: isin.isin,
    }));
    return finish(
      null,
      hits,
      `The ISIN on file is listed for ${hits.length} schemes in the official list, so it does not tell which one.`,
    );
  }
  if (missed.length > 0)
    isinNote = `The ISIN ${missed[0]!.isin} (${WHERE[missed[0]!.source]}) is not in today's official list (the scheme may have been merged or closed), so the name is used instead. `;

  // 2-4. the name
  const named = nameChoice(fund, schemes, max);
  if (named.recommended) {
    named.recommended = { ...named.recommended, reason: isinNote + named.recommended.reason };
    return finish(named.recommended, named.rest, '');
  }
  return finish(null, named.rest, isinNote + named.note);
}

/** The schemes (other than `skip`) that the name alone makes plausible, as alternatives to an ISIN match. */
function byName(
  fund: FundToMatch,
  schemes: AmfiScheme[],
  max: number,
  skip: Set<string>,
): SchemeChoice[] {
  return nameChoice(
    fund,
    schemes.filter((s) => !skip.has(s.code)),
    max,
  ).rest.filter((c) => !skip.has(c.scheme.code));
}

function nameChoice(
  fund: FundToMatch,
  schemes: AmfiScheme[],
  max: number,
): { recommended: SchemeChoice | null; rest: SchemeChoice[]; note: string } {
  const fk = schemeKey(tidy(fund.name));
  const fw = words(fund.name);
  if (fw.length === 0)
    return { recommended: null, rest: [], note: 'The fund name has no words to look up.' };
  const renamed = coreTokens(tidy(fund.name)).includes('bluechip');
  const scored = schemes
    .map((s) => score(fw, s))
    .filter((x) => x.contains || x.shared >= Math.min(2, fw.length))
    .sort(
      (a, b) =>
        Number(b.exact) - Number(a.exact) ||
        Number(b.contains) - Number(a.contains) ||
        b.shared - a.shared ||
        a.extras - b.extras ||
        pref(a.s) - pref(b.s) ||
        a.s.name.length - b.s.name.length,
    );
  if (scored.length === 0)
    return {
      recommended: null,
      rest: [],
      note: `No scheme in the official list has the words of “${fund.name}”.`,
    };

  const savedPlan =
    fund.planType === 'direct' || fund.planType === 'regular' ? fund.planType : null;
  const wantPlan = fk.plan ?? savedPlan;
  const wantOption = fk.option ?? 'growth';
  const mk = (x: Scored, certainty: SchemeCertainty, reason: string): SchemeChoice => ({
    scheme: x.s,
    certainty,
    reason,
    differences: [],
    matchedIsin: null,
  });
  const renameNote = (s: AmfiScheme) =>
    renamed !== coreTokens(s.name).includes('bluechip')
      ? ' “Bluechip” funds were renamed “Large Cap”, so the two names are the same fund.'
      : '';

  let recommended: SchemeChoice | null = null;
  if (wantPlan) {
    const eligible = scored.filter(
      (x) => x.contains && planOf(x.s) === wantPlan && optionOf(x.s) === wantOption,
    );
    const exact = eligible.filter((x) => x.exact);
    const pick =
      exact.length === 1
        ? exact[0]!
        : exact.length === 0 && eligible.length === 1
          ? eligible[0]!
          : null;
    if (pick) {
      const planWords = `${PLAN_TEXT[wantPlan]} plan`;
      const optWords = fk.option
        ? `${OPTION_TEXT[wantOption]} option`
        : `${OPTION_TEXT[wantOption]} option (the name does not say IDCW, so Growth is taken)`;
      const planFrom = fk.plan ? 'the name' : 'the plan saved on the fund';
      if (pick.exact && fk.plan && fk.option)
        recommended = mk(
          pick,
          'high',
          `The name matches the official name word for word, including ${planWords} and ${optWords}.${renameNote(pick.s)}`,
        );
      else if (pick.exact)
        recommended = mk(
          pick,
          'medium',
          `The name matches the official name word for word; ${planWords} is from ${planFrom} and ${optWords}.${renameNote(pick.s)}`,
        );
      else
        recommended = mk(
          pick,
          'medium',
          `It is the only ${planWords}, ${OPTION_TEXT[wantOption]} scheme from ${pick.s.amc || 'that fund house'} with all the words of the name (${fw.join(', ')}); ${planWords} is from ${planFrom}.${renameNote(pick.s)}`,
        );
    }
  }

  const rest: SchemeChoice[] = [];
  const seen = new Set<string>(recommended ? [recommended.scheme.code] : []);
  for (const x of scored) {
    if (rest.length + (recommended ? 1 : 0) >= max) break;
    if (seen.has(x.s.code)) continue;
    seen.add(x.s.code);
    rest.push(
      mk(
        x,
        'low',
        x.contains
          ? `The name fits (${planOptionText(x.s)}).${renameNote(x.s)}`
          : `Only some words of the name fit (${x.shared} of ${fw.length}).`,
      ),
    );
  }
  if (recommended) return { recommended, rest, note: '' };

  const top = rest.length;
  const why = !wantPlan
    ? `The name does not say Direct or Regular, and they are different funds with different prices.`
    : `More than one scheme fits the name and ${PLAN_TEXT[wantPlan]} plan, ${OPTION_TEXT[wantOption]}.`;
  return {
    recommended: null,
    rest,
    note:
      top === 0
        ? why
        : `${why} ${top === 1 ? 'The closest scheme is' : `The closest ${top} are`} listed.`,
  };
}

/**
 * Looks schemes up by what a person types in a search box: words of the name (any order, Mid Cap = Midcap), an ISIN, or an AMFI code.
 * The best `limit` come first (exact words, then Direct Growth).
 */
export function searchSchemes(query: string, schemes: AmfiScheme[], limit: number): AmfiScheme[] {
  const q = query.trim();
  if (q.length < 2) return [];
  if (/^\d{3,8}$/.test(q)) return schemes.filter((s) => s.code === q).slice(0, limit);
  if (/^INF[0-9A-Z]{9}$/i.test(q))
    return schemes.filter((s) => schemeIsins(s).includes(normIsin(q))).slice(0, limit);
  const qw = words(q);
  if (qw.length === 0) return [];
  const wantsPlan = schemeKey(q).plan;
  const wantsOption = schemeKey(q).option;
  return schemes
    .map((s) => ({ x: score(qw, s), s }))
    .filter(
      ({ x, s }) =>
        x.contains &&
        (!wantsPlan || planOf(s) === wantsPlan) &&
        (!wantsOption || optionOf(s) === wantsOption),
    )
    .sort(
      (a, b) =>
        Number(b.x.exact) - Number(a.x.exact) ||
        a.x.extras - b.x.extras ||
        pref(a.s) - pref(b.s) ||
        a.s.name.localeCompare(b.s.name),
    )
    .slice(0, limit)
    .map((r) => r.s);
}

/** The words used to shortlist schemes from a big list or a database for one fund name (the plan and option words are left out). */
export function shortlistWords(name: string): string[] {
  return words(name);
}
