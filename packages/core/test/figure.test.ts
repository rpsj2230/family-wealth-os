import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FIGURE_KINDS, METRICS, kindOfBasis, metricsMarkdown, mixOf } from '../src/figure';

describe('the five kinds of figure', () => {
  it('names each kind once, with what it means', () => {
    expect(FIGURE_KINDS.map((k) => k.key)).toEqual([
      'actual',
      'estimate',
      'market',
      'projection',
      'history',
    ]);
    for (const k of FIGURE_KINDS) expect(k.meaning.length).toBeGreaterThan(20);
  });

  it('labels a value by how it was worked out', () => {
    expect(kindOfBasis('recorded')).toBe('actual');
    expect(kindOfBasis('units_nav')).toBe('market');
    expect(kindOfBasis('units_nav', false)).toBe('estimate');
    expect(kindOfBasis('fx')).toBe('market');
    expect(kindOfBasis('rate')).toBe('estimate');
    expect(kindOfBasis('terms')).toBe('estimate');
    expect(kindOfBasis(null)).toBeNull();
  });

  it('never presents a mix with a projection as one kind', () => {
    expect(mixOf([{ kind: 'actual', value: 5 }]).label).toBe('actual');
    expect(
      mixOf([
        { kind: 'actual', value: 5 },
        { kind: 'estimate', value: 1 },
      ]).label,
    ).toBe('estimate');
    expect(
      mixOf([
        { kind: 'market', value: 5 },
        { kind: 'projection', value: 1 },
      ]).label,
    ).toBe('mixed');
    expect(mixOf([]).label).toBeNull();
  });
});

describe('the glossary', () => {
  it('defines every headline figure, with its date and, for a per cent, its denominator', () => {
    for (const m of Object.values(METRICS)) {
      expect(m.definition.length).toBeGreaterThan(30);
      expect(m.effectiveDate.length).toBeGreaterThan(5);
    }
    expect(METRICS.cumulativeGainPct.denominator).toMatch(/own money/i);
    expect(METRICS.xirr.denominator).toMatch(/money-weighted/i);
  });

  it('docs/DEFINITIONS.md is generated from it (run `pnpm --filter @fwos/core gen:definitions`)', () => {
    const file = readFileSync(resolve(__dirname, '../../../docs/DEFINITIONS.md'), 'utf8');
    expect(file).toBe(metricsMarkdown());
  });
});
