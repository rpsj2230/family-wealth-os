/**
 * The kind of a mutual fund, for the allocation graphs: large, mid or small cap, flexi cap, ELSS, index, sector, hybrid, debt, gold,
 * international. Worked out from the official category (AMFI scheme list) when the fund is matched, otherwise from its name, and
 * marked as a guess in the second case. This is about what the fund holds; the tax treatment lives in fund-class.ts.
 */
export type CategoryKey =
  | 'large'
  | 'mid'
  | 'small'
  | 'flexi'
  | 'elss'
  | 'index'
  | 'sector'
  | 'hybrid'
  | 'debt'
  | 'gold'
  | 'international'
  | 'other_equity'
  | 'unknown';

export interface FundCategory {
  key: CategoryKey;
  label: string;
  /** false when the kind is a guess from the fund's name only */
  certain: boolean;
}

/** The fixed order of the kinds: each keeps its colour on every graph, whatever else is on the page. */
export const CATEGORY_ORDER: CategoryKey[] = [
  'large',
  'flexi',
  'mid',
  'small',
  'index',
  'elss',
  'sector',
  'hybrid',
  'debt',
  'gold',
  'international',
  'other_equity',
  'unknown',
];

export const CATEGORY_LABEL: Record<CategoryKey, string> = {
  large: 'Large cap',
  mid: 'Mid cap',
  small: 'Small cap',
  flexi: 'Flexi and multi cap',
  elss: 'Tax saver (ELSS)',
  index: 'Index and ETF',
  sector: 'Sector and theme',
  hybrid: 'Hybrid',
  debt: 'Debt and liquid',
  gold: 'Gold and silver',
  international: 'International',
  other_equity: 'Other equity',
  unknown: 'Kind not known',
};

const make = (key: CategoryKey, certain: boolean): FundCategory => ({
  key,
  label: CATEGORY_LABEL[key],
  certain,
});

/** Order matters: the more specific words come first ("large and mid cap" is a mid-cap blend, "gold" before "fund of funds"). */
const RULES: [CategoryKey, RegExp][] = [
  ['elss', /\b(elss|tax saver|tax saving|tax plan)\b/i],
  ['gold', /\b(gold|silver|commodit)/i],
  [
    'international',
    /\b(overseas|international|global|us equity|nasdaq|s&p ?500|fang|world|emerging markets?|china|japan|europe)\b/i,
  ],
  [
    'debt',
    /\b(debt|liquid|overnight|money market|gilt|bond|income|credit risk|duration|ultra short|low duration|short term|corporate bond|banking and psu|floater|fixed maturity|fmp|target maturity|g-?sec|sdl|treasury|conservative hybrid)\b/i,
  ],
  [
    'hybrid',
    /\b(hybrid|balanced|multi ?asset|asset allocation|equity savings|dynamic asset|arbitrage|retirement|children)\b/i,
  ],
  ['index', /\b(index|etf|nifty|sensex|passive)\b/i],
  [
    'sector',
    /\b(sector|thematic|infrastructure|pharma|healthcare|technology|banking|psu equity|consumption|manufacturing|energy|fmcg|auto|digital|innovation|esg)\b/i,
  ],
  ['small', /\bsmall ?cap\b/i],
  ['mid', /\b(mid ?cap|large (?:and|&) mid ?cap)\b/i],
  ['large', /\b(large ?cap|blue ?chip|top 100|large)\b/i],
  ['flexi', /\b(flexi ?cap|multi ?cap|focused|flexi)\b/i],
  [
    'other_equity',
    /\b(equity|opportunities|value|contra|dividend yield|momentum|quality|alpha|growth)\b/i,
  ],
];

export function fundCategory(name: string, amfiCategory?: string | null): FundCategory {
  const cat = (amfiCategory ?? '').trim();
  if (cat) {
    // "Equity Scheme - Large Cap Fund" -> test the part after the dash first, then the whole text
    const kind = cat.replace(/^[^-]*-\s*/, '');
    // the scheme family (debt / hybrid / other) decides first for debt and hybrid schemes
    if (/^debt/i.test(cat)) return make('debt', true);
    if (/^hybrid/i.test(cat)) return make(/conservative/i.test(kind) ? 'debt' : 'hybrid', true);
    for (const [key, re] of RULES) {
      if (key === 'other_equity') continue;
      if (re.test(kind)) return make(key, true);
    }
    if (/^equity/i.test(cat)) return make('other_equity', true);
  }
  for (const [key, re] of RULES) if (re.test(name)) return make(key, false);
  return make('unknown', false);
}

/** Tidies an AMC name from the official list ("SBI Mutual Fund" and "SBI Funds Management Ltd" both become "SBI"). */
export function amcLabel(amc: string | null | undefined): string | null {
  const t = (amc ?? '')
    .replace(
      /\b(mutual fund|funds? management|asset management|investment managers?|amc|limited|ltd|private|pvt|company|co)\b\.?/gi,
      ' ',
    )
    .replace(/[,.]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t ? t : null;
}
