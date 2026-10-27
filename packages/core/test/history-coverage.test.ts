import { describe, expect, it } from 'vitest';
import {
  buildCoverage,
  coverageSentence,
  describeMonths,
  monthsBetween,
  type CoverageAccount,
} from '../src/history-coverage';

const acct = (o: Partial<CoverageAccount> & Pick<CoverageAccount, 'id'>): CoverageAccount => ({
  label: o.id,
  owner: 'Asha',
  bank: 'Sample Bank',
  kind: 'cash',
  status: 'active',
  ...o,
});
const obs = (asset_id: string, as_of: string, superseded_by: string | null = null) => ({
  asset_id,
  as_of,
  superseded_by,
});

describe('buildCoverage', () => {
  it('marks months with a value, the gaps between the first and last month, and the months an open account is late', () => {
    const c = buildCoverage(
      [acct({ id: 'a' })],
      [obs('a', '2026-03-31'), obs('a', '2026-04-20'), obs('a', '2026-07-05')],
      '2026-10-27',
    );
    expect(c.months[0]).toBe('2026-03');
    expect(c.months[c.months.length - 1]).toBe('2026-10');
    const r = c.rows[0]!;
    expect(r.cells.map((x) => x.state)).toEqual([
      'value', // Mar
      'value', // Apr
      'gap', // May
      'gap', // Jun
      'value', // Jul
      'late', // Aug
      'late', // Sep
      'none', // Oct: this month is not late yet
    ]);
    expect(r.gapMonths).toEqual(['2026-05', '2026-06']);
    expect(r.lateMonths).toEqual(['2026-08', '2026-09']);
    expect(r.first).toBe('2026-03');
    expect(r.last).toBe('2026-07');
    expect(c.totals).toMatchObject({ accounts: 1, withGaps: 1, gaps: 2, complete: 0 });
  });

  it('ignores a value that was replaced, and a closed account has no late months', () => {
    const c = buildCoverage(
      [acct({ id: 'a', status: 'closed' })],
      [obs('a', '2026-01-31'), obs('a', '2026-02-28', 'newer'), obs('a', '2026-03-31')],
      '2026-06-10',
    );
    const r = c.rows[0]!;
    expect(r.gapMonths).toEqual(['2026-02']);
    expect(r.lateMonths).toEqual([]);
    expect(r.cells.slice(-3).map((x) => x.state)).toEqual(['none', 'none', 'none']);
  });

  it('covers a deposit by its terms from its booking month to the month it ended', () => {
    const c = buildCoverage(
      [
        acct({
          id: 'fd',
          kind: 'fd',
          status: 'matured',
          from: '2026-02-10',
          to: '2026-05-20',
        }),
        acct({ id: 'run', kind: 'fd', from: '2026-04-01', to: '2027-04-01' }),
      ],
      [obs('a', '2026-01-31')],
      '2026-07-15',
    );
    expect(c.months[0]).toBe('2026-02');
    expect(c.rows[0]!.cells.map((x) => x.state)).toEqual([
      'terms',
      'terms',
      'terms',
      'terms',
      'none',
      'none',
    ]);
    expect(c.rows[1]!.cells.map((x) => x.state)).toEqual([
      'none',
      'none',
      'terms',
      'terms',
      'terms',
      'terms',
    ]);
    expect(c.rows[0]!.gapMonths).toEqual([]);
  });

  it('says it in words', () => {
    const c = buildCoverage(
      [acct({ id: 'a' })],
      [obs('a', '2026-01-31'), obs('a', '2026-04-30')],
      '2026-04-30',
    );
    expect(coverageSentence(c.rows[0]!)).toBe(
      'Balances from Jan 2026 to Apr 2026 (2 months). Missing: Feb to Mar 2026.',
    );
    expect(describeMonths(['2021-07', '2021-08', '2021-12', '2022-01'])).toBe(
      'Jul to Aug 2021, Dec 2021 to Jan 2022',
    );
    expect(monthsBetween('2025-11', '2026-02')).toEqual([
      '2025-11',
      '2025-12',
      '2026-01',
      '2026-02',
    ]);
  });
});
