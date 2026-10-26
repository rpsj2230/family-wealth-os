import { describe, expect, it } from 'vitest';
import {
  classifyGains,
  looksLikeDebtFund,
  schedule112aCsv,
  summariseGains,
  type RealisedRow,
} from '../src/capital-gains';
import { RULES } from '../src/tax';

const row = (o: Partial<RealisedRow> = {}): RealisedRow => ({
  ownerId: 'p',
  fund: 'Sample Flexi Cap Fund',
  isin: 'INF000A01AB1',
  soldOn: '2026-08-01',
  acquiredOn: '2024-01-01',
  units: 100,
  proceeds: 20_000,
  cost: 12_000,
  ...o,
});
const rule = RULES.find((r) => r.fy === '2026-27') ?? RULES[RULES.length - 1]!;

describe('classifyGains', () => {
  it('splits short and long term at the holding period', () => {
    const [a, b] = classifyGains([row(), row({ acquiredOn: '2026-03-01' })], 12);
    expect(a!.term).toBe('long');
    expect(b!.term).toBe('short');
    expect(a!.gain).toBe(8000);
  });
  it('leaves the gain empty when the cost is unknown and flags old units', () => {
    const [a] = classifyGains([row({ cost: null, acquiredOn: '2017-05-01' })], 12);
    expect(a!.gain).toBeNull();
    expect(a!.beforeFeb2018).toBe(true);
  });
  it('recognises debt-fund names', () => {
    expect(looksLikeDebtFund('Sample Liquid Fund - Direct')).toBe(true);
    expect(looksLikeDebtFund('Sample Flexi Cap Fund')).toBe(false);
  });
});

describe('summariseGains', () => {
  it('sums equity gains per person, applies the allowance and keeps debt funds apart', () => {
    const lines = classifyGains(
      [
        row(),
        row({ soldOn: '2026-08-02', acquiredOn: '2026-06-01', proceeds: 11_000, cost: 10_000 }),
        row({ fund: 'Sample Liquid Fund', proceeds: 10_500, cost: 10_000 }),
        row({ ownerId: 'q', cost: null }),
      ],
      12,
    );
    const [p, q] = summariseGains(lines, rule);
    expect(p!.ltcg).toBe(8000);
    expect(p!.stcg).toBe(1000);
    expect(p!.debtGains).toBe(500);
    expect(p!.position!.exemptionUsed).toBe(8000); // inside the allowance: no long-term tax
    expect(p!.position!.taxableLtcg).toBe(0);
    expect(q!.unknownCost).toBe(1);
    expect(q!.ltcg).toBe(0);
  });
  it('still reports the totals when no rule is available', () => {
    expect(summariseGains(classifyGains([row()], 12), null)[0]!.position).toBeNull();
  });
});

describe('schedule112aCsv', () => {
  it('lists long-term equity sales only, with the 2018 value left blank for old units', () => {
    const lines = classifyGains(
      [
        row(),
        row({ acquiredOn: '2017-06-01' }),
        row({ acquiredOn: '2026-05-01' }),
        row({ fund: 'Sample Liquid Fund' }),
        row({ cost: null }),
      ],
      12,
    );
    const csv = schedule112aCsv(lines).trim().split('\r\n');
    expect(csv).toHaveLength(1 + 2);
    expect(csv[1]).toMatch(
      /^AE,INF000A01AB1,Sample Flexi Cap Fund,100.000,200.0000,20000.00,12000.00/,
    );
    expect(csv[2]!.startsWith('BE,')).toBe(true);
  });
  it('neutralises spreadsheet formulas in names', () => {
    const csv = schedule112aCsv(classifyGains([row({ fund: '=cmd|x' })], 12));
    expect(csv).toContain("'=cmd|x");
  });
});
