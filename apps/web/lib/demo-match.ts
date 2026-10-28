import {
  planOptionText,
  schemeLabel,
  schemeProposal,
  searchSchemes,
  suggestSchemes,
  type AmfiScheme,
  type KnownIsin,
} from '@fwos/ingest';
import { DEFAULT_CONFIG } from '@fwos/core';
import type { MatchRow } from './match-data';

/**
 * The public sample of "Funds without a price": an invented official scheme list (invented names and ISINs, nothing real) and three
 * invented funds with no price source, put through the same ranking and wording as the real page: one that only its name can place
 * (the plan is saved on the fund), one whose ISIN settles it although the name changed, and one that cannot be told apart.
 */
const AMC = 'Sample Mutual Fund';
const scheme = (
  code: string,
  name: string,
  plan: AmfiScheme['plan'],
  option: AmfiScheme['option'],
  isin: string,
  reinvest: string | null = null,
): AmfiScheme => ({
  code,
  isinGrowth: isin,
  isinReinvest: reinvest,
  name,
  plan,
  option,
  nav: null,
  navDate: null,
  amc: AMC,
  category: 'Equity Scheme',
});

export const DEMO_SCHEMES: AmfiScheme[] = [
  scheme('918001', 'Sample Hybrid Fund', 'Direct', 'Growth', 'INF999Z01A11'),
  scheme('918002', 'Sample Hybrid Fund', 'Regular', 'Growth', 'INF999Z01A29'),
  scheme('918003', 'Sample Hybrid Fund', 'Direct', 'IDCW', 'INF999Z01A37', 'INF999Z01A45'),
  scheme('918010', 'Sample Large Cap Fund', 'Direct', 'Growth', 'INF999Z01B10'),
  scheme('918011', 'Sample Large Cap Fund', 'Regular', 'Growth', 'INF999Z01B28'),
  scheme('918020', 'Sample Value Fund', 'Direct', 'Growth', 'INF999Z01C19'),
  scheme('918021', 'Sample Value Fund', 'Regular', 'Growth', 'INF999Z01C27'),
  scheme('918022', 'Sample Value Fund', 'Direct', 'IDCW', 'INF999Z01C35', 'INF999Z01C43'),
  scheme('918023', 'Sample Value Fund', 'Regular', 'IDCW', 'INF999Z01C50', 'INF999Z01C68'),
];

interface Fixture {
  assetId: string;
  name: string;
  owner: string;
  folio: string;
  units: number;
  invested: number;
  last: { amount: number; asOf: string };
  isins: KnownIsin[];
  planType: 'direct' | 'regular' | null;
}

const FIXTURES: Fixture[] = [
  {
    assetId: 'f4',
    name: 'Sample Hybrid Fund',
    owner: 'Beena',
    folio: '3304',
    units: 9_952.381,
    invested: 430_000,
    last: { amount: 410_000, asOf: '2026-09-28' },
    isins: [],
    planType: 'direct',
  },
  {
    assetId: 'f9',
    name: 'Sample Bluechip Fund',
    owner: 'Anil',
    folio: '8812',
    units: 1_204.5,
    invested: 150_000,
    last: { amount: 188_000, asOf: '2026-09-28' },
    isins: [{ isin: 'INF999Z01B10', source: 'statement' }],
    planType: null,
  },
  {
    assetId: 'f10',
    name: 'Sample Value Fund',
    owner: 'Anil',
    folio: '2076',
    units: 640.2,
    invested: 90_000,
    last: { amount: 97_500, asOf: '2026-09-28' },
    isins: [],
    planType: null,
  },
];

/** The funds without a price in the sample, with the prompt the ranking produces for each. */
export function demoUnmatched(): MatchRow[] {
  return FIXTURES.map((f) => {
    const fund = {
      assetId: f.assetId,
      name: f.name,
      isins: f.isins,
      planType: f.planType,
      folioLast4: f.folio,
    };
    const s = suggestSchemes(fund, DEMO_SCHEMES, { maxChoices: DEFAULT_CONFIG.funds.matchChoices });
    return {
      assetId: f.assetId,
      name: f.name,
      ownerName: f.owner,
      sipMonthly: null,
      sipStopped: false,
      amfiCode: null,
      schemeName: null,
      lastValue: f.last,
      exitLoadFraction: null,
      exitLoadDays: null,
      folioLast4: f.folio,
      units: f.units,
      invested: f.invested,
      isin: f.isins[0]?.isin ?? null,
      closed: false,
      noPriceSource: false,
      proposal: schemeProposal(fund, s),
      certainty: s.recommended?.certainty ?? null,
    };
  });
}

/** What the sample's search box returns: the best schemes of the invented list. */
export function demoSearch(query: string) {
  return searchSchemes(query, DEMO_SCHEMES, DEFAULT_CONFIG.funds.matchSearchResults).map((s) => ({
    code: s.code,
    name: schemeLabel(s),
    detail: planOptionText(s),
    amc: s.amc,
  }));
}
