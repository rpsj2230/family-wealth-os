import { describe, expect, it } from 'vitest';
import {
  DIGEST_SUBJECT_LIMIT,
  DIGEST_SUBJECT_NAME,
  digestSubject,
  needsYouMarker,
} from '../src/digest-subject';

const base = { date: '2026-10-27', netWorth: 48_219_860, dayPct: 0.0042, needsYou: 0 };

describe('digestSubject', () => {
  it('names the summary, the date, the net worth and the day change', () => {
    expect(digestSubject(base)).toBe(
      'Family Wealth Summary · 27 Oct 2026 · Net worth ₹4.82 Cr (+0.4% today)',
    );
  });

  it('shows a fall with a real minus sign, and a flat day as 0.0%', () => {
    expect(digestSubject({ ...base, dayPct: -0.0113 })).toContain('(−1.1% today)');
    expect(digestSubject({ ...base, dayPct: 0 })).toContain('(0.0% today)');
  });

  it('leaves the change out when it is not known', () => {
    expect(digestSubject({ ...base, dayPct: null })).toBe(
      'Family Wealth Summary · 27 Oct 2026 · Net worth ₹4.82 Cr',
    );
  });

  it('adds a marker only when something needs the person, shortening the percentage first', () => {
    const s = digestSubject({ ...base, needsYou: 2 });
    expect(s).toBe('Family Wealth Summary · 27 Oct 2026 · Net worth ₹4.82 Cr · 2 need you');
    expect(digestSubject({ ...base, needsYou: 1 })).toContain('1 needs you');
    expect(needsYouMarker(3)).toBe('3 need you');
    expect(digestSubject(base)).not.toContain('need');
  });

  it('never runs past the limit and never loses the date, whatever the size of the figures', () => {
    for (const netWorth of [0, 9_999, 98_700_000, 12_345_678_900, -250_000]) {
      for (const needsYou of [0, 1, 12]) {
        for (const dayPct of [null, 0.2, -0.123]) {
          const s = digestSubject({ date: '2026-02-03', netWorth, dayPct, needsYou });
          expect(s.length).toBeLessThanOrEqual(DIGEST_SUBJECT_LIMIT);
          expect(s).toContain('3 Feb 2026');
          expect(s.startsWith(DIGEST_SUBJECT_NAME)).toBe(true);
        }
      }
    }
  });

  it('drops the percentage, then the marker, then the net worth, in that order', () => {
    // an absurd figure still leaves a subject within the limit with the date in it
    const huge = digestSubject({ ...base, netWorth: 1e24, needsYou: 3 });
    expect(huge.length).toBeLessThanOrEqual(DIGEST_SUBJECT_LIMIT);
    expect(huge).toContain('27 Oct 2026');
    const noPct = digestSubject({ ...base, netWorth: 1_234_567_890, dayPct: 0.0123, needsYou: 3 });
    expect(noPct).not.toContain('%');
    expect(noPct).toContain('3 need you');
  });

  it('is deterministic', () => {
    expect(digestSubject({ ...base, needsYou: 4 })).toBe(digestSubject({ ...base, needsYou: 4 }));
  });
});
