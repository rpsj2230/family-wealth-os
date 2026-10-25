import { describe, expect, it } from 'vitest';
import { fdValueOn, maturityVariance } from '../src/fd';

const d = (s: string) => new Date(`${s}T00:00:00Z`);

// Bank-quoted maturity amounts taken from the household workbook (public fixtures, no identifiers).
const FIXTURES = [
  { name: 'Yes 6.5% 5y', P: 1_000_000, r: 0.065, from: '2021-11-01', to: '2026-11-01', bank: 1_380_416 },
  { name: 'Yes 7.75% 2y', P: 1_000_000, r: 0.0775, from: '2024-11-16', to: '2026-11-01', bank: 1_162_254 },
  { name: 'Equitas 8% 3y', P: 500_000, r: 0.08, from: '2026-09-14', to: '2029-09-15', bank: 634_399 },
  { name: 'Jana 8.2% 5y', P: 500_000, r: 0.082, from: '2025-05-11', to: '2030-05-11', bank: 750_202 },
  { name: 'ESAF 8% 2.2y', P: 1_000_000, r: 0.08, from: '2026-09-08', to: '2028-11-16', bank: 1_189_427 },
  { name: 'AU 7.4% 2.5y', P: 1_000_000, r: 0.074, from: '2026-09-14', to: '2029-03-15', bank: 1_201_070 },
  { name: 'IndusInd 7.75% 2y', P: 800_000, r: 0.0775, from: '2024-11-16', to: '2026-11-16', bank: 932_742 },
];

describe('fdValueOn', () => {
  it('equals principal on the booking date', () => {
    expect(fdValueOn({ principal: 100000, annualRate: 0.07, bookedOn: d('2026-01-01'), asOf: d('2026-01-01') })).toBe(100000);
  });
  it('one year at 8% quarterly = 8.2432%', () => {
    const v = fdValueOn({ principal: 100000, annualRate: 0.08, bookedOn: d('2025-01-01'), asOf: d('2026-01-01') });
    expect(v).toBeCloseTo(108243.2, 0);
  });
  it('stops accruing after maturity', () => {
    const base = { principal: 100000, annualRate: 0.07, bookedOn: d('2024-01-01'), maturityOn: d('2025-01-01') };
    expect(fdValueOn({ ...base, asOf: d('2030-01-01') })).toBe(fdValueOn({ ...base, asOf: d('2025-01-01') }));
  });
  it('rejects invalid inputs', () => {
    expect(() => fdValueOn({ principal: 0, annualRate: 0.07, bookedOn: d('2024-01-01'), asOf: d('2025-01-01') })).toThrow();
  });
});

describe('maturityVariance vs bank figures', () => {
  for (const f of FIXTURES) {
    it(`${f.name} within 0.05%`, () => {
      const v = maturityVariance({
        principal: f.P,
        annualRate: f.r,
        bookedOn: d(f.from),
        maturityOn: d(f.to),
        bankMaturityAmount: f.bank,
      });
      expect(v.withinTolerance).toBe(true);
    });
  }
});
