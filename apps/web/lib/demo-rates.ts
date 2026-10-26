import {
  DEFAULT_CONFIG,
  personStyles,
  type BoardOffer,
  type RateEventRow,
  type RateHolding,
  type RateSourceRow,
} from '@fwos/core';
import type { RateHint } from './rates-view';

/**
 * Invented banks, rates, change log and holdings for the public /demo/rates and /demo/new-money pages. Nothing here is real;
 * the bank names are made up and the page addresses end in .invalid.
 */
export const DEMO_RATES_TODAY = '2026-10-26';
export const DEMO_RATE_PREFS = DEFAULT_CONFIG.rates;
export const DEMO_LIMIT = DEFAULT_CONFIG.deposits.insuranceLimit;
export const DEMO_PEOPLE = [
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
];
export const DEMO_STYLES = personStyles(DEMO_PEOPLE);

const JAN = 'Sample Jan Bank';
const EQ = 'Sample Equity Bank';
const ESAF = 'Sample Esaf Bank';
const YES = 'Sample Yes Bank';
const AU = 'Sample AU Bank';
const IDF = 'Sample IDF Bank';

let n = 0;
const base = (o: Partial<BoardOffer> & Pick<BoardOffer, 'bank' | 'rate'>): BoardOffer => ({
  id: `o${++n}`,
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  conditions: null,
  sourceKind: 'ai',
  checkedOn: '2026-10-21',
  sourceNote: 'Read from rates.sample-jan.invalid',
  sourceUrl: 'https://rates.sample-jan.invalid/deposits',
  ...o,
});
const sav = (
  bank: string,
  rate: number,
  from: number | null,
  to: number | null,
  o: Partial<BoardOffer> = {},
) =>
  base({
    bank,
    rate,
    product: 'savings',
    accountKind: 'any',
    tenureFrom: 0,
    tenureTo: 0,
    balanceFrom: from,
    balanceTo: to,
    ...o,
  });

const jan = (o: Partial<BoardOffer>) => o;
const notes = {
  sourceKind: 'manual' as const,
  sourceNote: 'Pasted notes',
  sourceUrl: null,
  checkedOn: '2026-10-03',
};

export const DEMO_OFFERS: BoardOffer[] = [
  // Jan: read from its page, one figure corrected by hand after the reader took the senior-citizen column
  sav(JAN, 0.025, null, 100_000, jan({})),
  sav(JAN, 0.035, 100_000, 500_000, jan({})),
  sav(JAN, 0.045, 500_000, 1_000_000, jan({})),
  sav(JAN, 0.0675, 1_000_000, 5_000_000, jan({})),
  sav(JAN, 0.07, 5_000_000, null, jan({})),
  base({ bank: JAN, rate: 0.08 }),
  base({ bank: JAN, rate: 0.0775, tenureFrom: 12, tenureTo: 12 }),
  base({
    bank: JAN,
    rate: 0.076,
    tenureFrom: 36,
    tenureTo: 36,
    sourceKind: 'manual',
    sourceNote: 'Edited by you',
    sourceUrl: null,
    aiRate: 0.081,
    correctionReason: 'senior_citizen',
    pageRate: 0.081,
    pageSeenOn: '2026-10-21',
    misreadCount: 1,
  }),
  base({ bank: JAN, rate: 0.07, accountKind: 'NRO' }),
  // Equity: pasted from notes; the page now says a little more on one deposit
  sav(EQ, 0.025, null, 300_000, notes),
  sav(EQ, 0.05, 300_000, 500_000, notes),
  sav(EQ, 0.06, 500_000, 1_000_000, notes),
  sav(EQ, 0.065, 1_000_000, null, notes),
  base({
    bank: EQ,
    rate: 0.08,
    tenureFrom: 12,
    tenureTo: 36,
    ...notes,
    pageRate: 0.0825,
    pageSeenOn: '2026-10-21',
  }),
  // Esaf: old
  sav(ESAF, 0.025, null, 100_000, { ...notes, checkedOn: '2026-08-30' }),
  sav(ESAF, 0.03, 100_000, 200_000, { ...notes, checkedOn: '2026-08-30' }),
  sav(ESAF, 0.05, 200_000, 500_000, { ...notes, checkedOn: '2026-08-30' }),
  base({
    bank: ESAF,
    rate: 0.08,
    tenureFrom: 12,
    tenureTo: 27,
    tenureDays: 800,
    ...notes,
    checkedOn: '2026-08-30',
  }),
  // Yes: its page could not be read
  sav(YES, 0.025, null, 100_000, {
    sourceNote: 'Read from rates.sample-yes.invalid',
    checkedOn: '2026-10-05',
  }),
  base({
    bank: YES,
    rate: 0.0725,
    tenureFrom: 12,
    tenureTo: 30,
    sourceNote: 'Read from rates.sample-yes.invalid',
    checkedOn: '2026-10-05',
  }),
  // AU
  sav(AU, 0.0275, 300_000, 500_000, { sourceNote: 'Read from rates.sample-au.invalid' }),
  sav(AU, 0.035, 500_000, 1_000_000, { sourceNote: 'Read from rates.sample-au.invalid' }),
  base({
    bank: AU,
    rate: 0.074,
    tenureFrom: 12,
    tenureTo: 30,
    sourceNote: 'Read from rates.sample-au.invalid',
  }),
  // IDF: not a bank the family uses
  sav(IDF, 0.07, 300_000, 2_500_000, { sourceNote: 'Read from rates.sample-idf.invalid' }),
  base({
    bank: IDF,
    rate: 0.071,
    tenureFrom: 12,
    tenureTo: 24,
    tenureDays: 500,
    sourceNote: 'Read from rates.sample-idf.invalid',
  }),
];

const h = (
  bank: string,
  p: 'p1' | 'p2',
  product: 'savings' | 'fd',
  current: number,
  kind: 'NRE' | 'NRO' = 'NRE',
  extra: Partial<RateHolding> = {},
): RateHolding => ({
  assetId: `a${n++}`,
  ownerId: p,
  ownerName: p === 'p1' ? 'Anil' : 'Beena',
  bank,
  product,
  kind,
  joint: false,
  current,
  rate: product === 'fd' ? 0.07 : 0.03,
  maturityOn: product === 'fd' ? '2027-03-15' : null,
  needsConfirmation: false,
  ...extra,
});

export const DEMO_HOLDINGS: RateHolding[] = [
  h(JAN, 'p1', 'savings', 420_000),
  h(JAN, 'p1', 'fd', 3_200_000),
  h(JAN, 'p2', 'fd', 1_800_000),
  h(EQ, 'p1', 'savings', 250_000),
  h(EQ, 'p2', 'fd', 4_900_000),
  h(ESAF, 'p1', 'fd', 900_000),
  h(YES, 'p2', 'savings', 150_000),
  h(AU, 'p1', 'savings', 310_000),
];

export const DEMO_SOURCES: RateSourceRow[] = [
  {
    bank: JAN,
    url: 'https://rates.sample-jan.invalid/deposits',
    enabled: true,
    lastRunOn: '2026-10-21',
    lastResult:
      'read 8 rates: 0 new, 1 changed, 6 unchanged; 1 still read wrongly (rule saved for next time)',
  },
  {
    bank: EQ,
    url: 'https://rates.sample-equity.invalid/nre',
    enabled: true,
    lastRunOn: '2026-10-21',
    lastResult: 'read 6 rates: 0 new, 0 changed, 5 unchanged; 1 typed rates differ from the page',
  },
  {
    bank: YES,
    url: 'https://rates.sample-yes.invalid/rates',
    enabled: true,
    lastRunOn: '2026-10-21',
    lastResult: 'could not refresh: page answered 403',
  },
  {
    bank: AU,
    url: 'https://rates.sample-au.invalid/rates',
    enabled: true,
    lastRunOn: '2026-10-21',
    lastResult: 'read 3 rates: 0 new, 0 changed, 3 unchanged',
  },
];

const ev = (o: Partial<RateEventRow> & Pick<RateEventRow, 'at' | 'kind'>): RateEventRow => ({
  bank: JAN,
  product: 'fd',
  accountKind: 'NRE',
  tenureFrom: 24,
  tenureTo: 24,
  balanceFrom: null,
  balanceTo: null,
  oldRate: null,
  newRate: null,
  source: 'ai',
  reason: null,
  ...o,
});

/** Newest first, like the real log. */
export const DEMO_EVENTS: RateEventRow[] = [
  ev({
    at: '2026-10-21T04:10:00Z',
    kind: 'corrected',
    tenureFrom: 36,
    tenureTo: 36,
    oldRate: 0.081,
    newRate: 0.076,
    source: 'manual',
    reason: 'senior_citizen',
  }),
  ev({ at: '2026-10-14T04:10:00Z', kind: 'changed', oldRate: 0.0775, newRate: 0.08 }),
  ev({
    at: '2026-09-12T04:10:00Z',
    kind: 'changed',
    product: 'savings',
    accountKind: 'any',
    tenureFrom: 0,
    tenureTo: 0,
    balanceFrom: 5_000_000,
    oldRate: 0.0675,
    newRate: 0.07,
  }),
  ev({
    at: '2026-08-10T04:10:00Z',
    kind: 'added',
    product: 'savings',
    accountKind: 'any',
    tenureFrom: 0,
    tenureTo: 0,
    balanceFrom: 5_000_000,
    newRate: 0.0675,
  }),
  ev({ at: '2026-08-10T04:09:00Z', kind: 'added', tenureFrom: 36, tenureTo: 36, newRate: 0.081 }),
  ev({ at: '2026-08-10T04:08:00Z', kind: 'added', tenureFrom: 12, tenureTo: 12, newRate: 0.0775 }),
  ev({ at: '2026-08-10T04:07:00Z', kind: 'added', newRate: 0.0775 }),
];

export const DEMO_HINTS: RateHint[] = [
  {
    id: 'h1',
    bank: JAN,
    cause: 'senior_citizen',
    hint: 'For NRE fixed deposit, 36 months: the right rate is 7.6%. 8.1% is the senior-citizen rate; read the regular (non-senior) column.',
    createdOn: '2026-10-21',
    active: true,
  },
  {
    id: 'h2',
    bank: JAN,
    cause: 'Written by you',
    hint: 'Ignore the table headed Special Deposits.',
    createdOn: '2026-09-02',
    active: false,
  },
];
