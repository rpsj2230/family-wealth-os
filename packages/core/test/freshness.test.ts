import { describe, expect, it } from 'vitest';
import { classifyFreshness } from '../src/freshness';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-25');

describe('classifyFreshness', () => {
  it('missing when there is no observation', () => {
    expect(classifyFreshness({ asOf: null, today, expectedDays: 35 }).status).toBe('missing');
  });
  it('current inside the window', () => {
    expect(classifyFreshness({ asOf: d('2026-10-01'), today, expectedDays: 35 }).status).toBe('current');
  });
  it('older than expected between 1x and 2x', () => {
    expect(classifyFreshness({ asOf: d('2026-08-30'), today, expectedDays: 35 }).status).toBe('older_than_expected');
  });
  it('stale beyond 2x', () => {
    expect(classifyFreshness({ asOf: d('2026-06-01'), today, expectedDays: 35 }).status).toBe('stale');
  });
  it('flags imported-but-unverified when otherwise current', () => {
    expect(classifyFreshness({ asOf: d('2026-10-20'), today, expectedDays: 35, confidence: 'imported_unverified' }).status).toBe('imported_unverified');
  });
  it('never reports an old balance as current even if verified', () => {
    expect(classifyFreshness({ asOf: d('2026-01-01'), today, expectedDays: 35, confidence: 'verified' }).status).toBe('stale');
  });
});
