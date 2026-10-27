/**
 * Which record wins when two sources disagree about a fund. One table, used by the statement comparison (`diffFundImport`) and written
 * out in docs/USER-GUIDE.md ("Which record wins"), so the rule is the same everywhere and is read from one place.
 *
 * The rule: a detailed fund statement (CAS) is the most accurate record there is, so for every fund on it the statement decides the
 * units held, the amount invested, the first purchase, the value on its date, the SIP facts and the transaction lines inside the period
 * it covers. Anything lower in this table that disagrees is replaced: not deleted, but set aside in a hidden list the person can open.
 * A source never replaces something from a source ranked above it, and an older statement never replaces a newer one.
 */

/** Where a stored transaction line came from (mf_transactions.source). */
export type LineSource = 'cas' | 'csv' | 'workbook' | 'estimate' | 'manual';

export interface PrecedenceRow {
  source: LineSource;
  /** higher wins */
  rank: number;
  /** words for a person */
  label: string;
  /** one line: what it is */
  what: string;
}

/** Highest first. */
export const SOURCE_PRECEDENCE: readonly PrecedenceRow[] = [
  {
    source: 'cas',
    rank: 5,
    label: 'Fund statement',
    what: 'a detailed statement (CAS) from CAMS, KFintech or MF Central',
  },
  {
    source: 'csv',
    rank: 4,
    label: 'App export',
    what: 'a transactions file exported from an investment app (Kuvera and others)',
  },
  { source: 'workbook', rank: 3, label: 'Excel workbook', what: 'the family workbook' },
  {
    source: 'estimate',
    rank: 2,
    label: 'Estimated',
    what: 'worked out from the start date and the monthly investment',
  },
  { source: 'manual', rank: 1, label: 'Typed by hand', what: 'entered by hand' },
];

const BY_SOURCE = new Map<string, PrecedenceRow>(SOURCE_PRECEDENCE.map((r) => [r.source, r]));
/** older spellings of a source that may be stored */
const ALIAS: Record<string, LineSource> = { file: 'csv', excel: 'workbook', sheet: 'workbook' };

const rowOf = (source: string | null | undefined): PrecedenceRow | null =>
  BY_SOURCE.get(ALIAS[source ?? ''] ?? source ?? '') ?? null;

/** The rank of a stored source. A source nobody knows ranks with typed-by-hand, the lowest. */
export const sourceRank = (source: string | null | undefined): number => rowOf(source)?.rank ?? 1;

/** "Fund statement", "App export", … for a stored source. */
export const sourceLabel = (source: string | null | undefined): string =>
  rowOf(source)?.label ?? 'Other';

/** True when a statement outranks this source, so the statement may replace a line from it. */
export const statementOutranks = (source: string | null | undefined): boolean =>
  sourceRank(source) < sourceRank('cas');

/** A statement dated `periodTo` is not allowed to change what a statement dated `appliedTo` decided: only newer or equal ones win. */
export const olderThanApplied = (periodTo: string | null, appliedTo: string | null): boolean =>
  !!periodTo && !!appliedTo && periodTo < appliedTo;

/** CAMS prints 1 Oct 1986 for "from the beginning"; any period starting before this is read that way. */
export const INCEPTION_BEFORE = '1990-01-01';
export const fromInception = (periodFrom: string | null): boolean =>
  !!periodFrom && periodFrom < INCEPTION_BEFORE;

/** The one sentence shown above a preview. */
export const PRIORITY_SENTENCE =
  'The statement is the most accurate record. Where it differs from what you have, the statement wins; your older lines are kept in a hidden list, not deleted.';
