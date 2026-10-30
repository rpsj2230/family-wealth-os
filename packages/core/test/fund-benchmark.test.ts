import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config';
import {
  benchmarkCodes,
  blendLines,
  fundBenchmark,
  parseBenchmarkRule,
} from '../src/fund-benchmark';
import { benchFlows, xirrTrail } from '../src/own-returns';

const rules = DEFAULT_CONFIG.funds.benchmarks;

describe('fundBenchmark', () => {
  it("finds a fund's own benchmark by its name, ignoring spaces and case", () => {
    expect(fundBenchmark(['HDFC Flexicap Growth Direct Plan'], 'flexi', rules)).toEqual({
      index: 'Nifty 500 TRI',
      legs: [{ code: '147625', weight: 1 }],
      basis: 'fund',
    });
    expect(fundBenchmark(['Mid Cap Opportunities fund (In HDFC)'], 'mid', rules)?.index).toBe(
      'Nifty Midcap 150 TRI',
    );
    expect(fundBenchmark(['Invesco India Midcap Growth Direct Plan'], 'mid', rules)?.index).toMatch(
      /^BSE 150 MidCap TRI/,
    );
    expect(
      fundBenchmark(['Axis Large Cap Growth Direct Plan'], 'large', rules)?.legs[0]!.code,
    ).toBe('134014');
  });
  it('builds a mix for an index no fund tracks', () => {
    const b = fundBenchmark(['HDFC Balanced Advantage Growth Direct Plan'], 'hybrid', rules)!;
    expect(b.legs).toEqual([
      { code: '120716', weight: 0.5 },
      { code: '139496', weight: 0.5 },
    ]);
  });
  it('falls back to the rule for the kind of fund, then to the rule for every other fund', () => {
    expect(fundBenchmark(['Some New Small Cap Fund'], 'small', rules)).toMatchObject({
      index: 'Nifty Smallcap 250 TRI',
      basis: 'kind',
    });
    expect(fundBenchmark(['A Gold Fund'], 'gold', rules)).toMatchObject({
      index: 'Nifty 50 TRI',
      basis: 'default',
    });
    expect(fundBenchmark(['A Gold Fund'], 'gold', ['kind:small = X = 1'])).toBeNull();
  });
  it('lists every code the rules use', () => {
    expect(benchmarkCodes(rules).sort()).toEqual(
      ['120716', '134014', '139496', '146271', '147623', '147625', '153081'].sort(),
    );
  });
});

describe('parseBenchmarkRule', () => {
  it('reads name, kind and default rules, and names what is wrong', () => {
    expect(parseBenchmarkRule('kind:Mid = Nifty Midcap 150 TRI = 146271')).toMatchObject({
      kind: 'mid',
      words: null,
    });
    expect('error' in parseBenchmarkRule('nippon = Nifty Smallcap 250')).toBe(true);
    expect('error' in parseBenchmarkRule('nippon = Nifty = abc')).toBe(true);
    expect('error' in parseBenchmarkRule('x = Mix = 1*0.6 + 2*0.6')).toBe(true);
    expect('error' in parseBenchmarkRule('a = Index = 1')).toBe(true);
  });
});

describe('blendLines', () => {
  it('moves by the weighted change of each line, rebalanced every day, from the day both have prices', () => {
    const a = [
      { date: '2025-01-01', value: 10 },
      { date: '2025-01-02', value: 11 },
      { date: '2025-01-03', value: 11 },
    ];
    const b = [
      { date: '2025-01-02', value: 100 },
      { date: '2025-01-03', value: 90 },
    ];
    // starts on 2 Jan; on 3 Jan: half of 0% and half of -10% = -5%
    expect(
      blendLines([
        { points: a, weight: 0.5 },
        { points: b, weight: 0.5 },
      ]),
    ).toEqual([
      { date: '2025-01-02', value: 100 },
      { date: '2025-01-03', value: 95 },
    ]);
    expect(blendLines([{ points: a, weight: 1 }])).toBe(a);
  });
});

describe('benchFlows', () => {
  const values = [
    { date: '2018-11-05', value: 1000 },
    { date: '2019-09-11', value: 1500 },
    { date: '2020-01-01', value: 2600 },
  ];
  it('starts a benchmark that begins later with the holding as it stood that day', () => {
    const r = benchFlows(
      [
        { date: '2018-11-05', amount: 1000 },
        { date: '2019-12-01', amount: 1000 },
      ],
      values,
      [{ date: '2019-09-11', value: 10 }],
    );
    expect(r).toEqual({
      from: '2019-09-11',
      flows: [
        { date: '2019-09-11', amount: 1500 },
        { date: '2019-12-01', amount: 1000 },
      ],
    });
  });
  it('keeps the flows as they are when the benchmark covers them', () => {
    const flows = [{ date: '2020-01-01', amount: 1000 }];
    expect(benchFlows(flows, values, [{ date: '2019-09-11', value: 10 }])).toEqual({
      from: null,
      flows,
    });
  });
  it('the benchmark XIRR uses its own flows', () => {
    const t = xirrTrail(
      [{ date: '2018-01-01', amount: 1000 }],
      [{ date: '2020-01-01', value: 1210 }],
      [{ date: '2020-01-01', value: 1100 }],
      [{ date: '2019-01-01', amount: 1000 }],
    );
    expect(t[0]!.yours).toBeCloseTo(0.1, 3);
    expect(t[0]!.bench).toBeCloseTo(0.1, 2);
  });
});
