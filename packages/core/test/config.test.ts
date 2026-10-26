import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  configFromJson,
  effectiveRules,
  fyBoundsOf,
  mergeRules,
} from '../src/config';
import { RULES } from '../src/tax';

describe('fund statistics settings', () => {
  it('start at the built-in numbers, accept saved ones and clamp nonsense', () => {
    expect(configFromJson({}).funds).toEqual(DEFAULT_CONFIG.funds);
    expect(
      configFromJson({ funds: { concentrationTop: 5, calendarMonths: 12 } }).funds,
    ).toMatchObject({
      concentrationTop: 5,
      calendarMonths: 12,
      annualiseAfterMonths: DEFAULT_CONFIG.funds.annualiseAfterMonths,
    });
    expect(configFromJson({ funds: { maxSlices: 99, concentrationTop: -3 } }).funds).toMatchObject({
      maxSlices: DEFAULT_CONFIG.funds.maxSlices,
      concentrationTop: DEFAULT_CONFIG.funds.concentrationTop,
    });
  });
});

describe('configFromJson', () => {
  it('uses the defaults for anything missing and ignores junk', () => {
    expect(configFromJson(null)).toEqual(DEFAULT_CONFIG);
    expect(configFromJson('x')).toEqual(DEFAULT_CONFIG);
    expect(configFromJson({ deposits: { insuranceLimit: 'a lot' } })).toEqual(DEFAULT_CONFIG);
  });
  it('takes valid values from Settings, including a changed deposit limit and alert windows', () => {
    const c = configFromJson({
      deposits: { insuranceLimit: 750000, maturityAlertDays: [30, 7, 7, 14] },
      reminders: { taskDays: 3 },
    });
    expect(c.deposits.insuranceLimit).toBe(750000);
    expect(c.deposits.maturityAlertDays).toEqual([7, 14, 30]);
    expect(c.reminders.taskDays).toBe(3);
    expect(c.reminders.policyDays).toBe(DEFAULT_CONFIG.reminders.policyDays);
  });
  it('clamps nonsense: negative limits, rates above 50%, impossible reminder dates', () => {
    const c = configFromJson({
      deposits: { insuranceLimit: -5 },
      estimates: { savingsRate: 4 },
      reminders: { harvestMonth: 15, harvestDay: 40 },
    });
    expect(c.deposits.insuranceLimit).toBe(DEFAULT_CONFIG.deposits.insuranceLimit);
    expect(c.estimates.savingsRate).toBe(DEFAULT_CONFIG.estimates.savingsRate);
    expect(c.reminders.harvestMonth).toBe(DEFAULT_CONFIG.reminders.harvestMonth);
    expect(c.reminders.harvestDay).toBe(DEFAULT_CONFIG.reminders.harvestDay);
  });
});

describe('tax rules from Settings', () => {
  const row = (fy: string, ex: number) => ({
    fy,
    holding_months_long: 24,
    stcg_rate: 0.3,
    ltcg_rate: 0.15,
    ltcg_exemption: ex,
    cess: 0.04,
    verified: true,
    source_note: 'Budget 2027',
  });
  it('knows a financial year’s first and last day, and rejects a malformed year', () => {
    expect(fyBoundsOf('2027-28')).toEqual({ from: '2027-04-01', to: '2028-03-31' });
    expect(fyBoundsOf('2027-29')).toBeNull();
    expect(fyBoundsOf('2027')).toBeNull();
  });
  it('lets a Settings row replace the built-in year and add a new one', () => {
    const merged = mergeRules([row('2026-27', 300_000), row('2027-28', 400_000)]);
    expect(merged.find((r) => r.fy === '2026-27')!.equity).toMatchObject({
      ltcgExemption: 300_000,
      holdingMonthsLong: 24,
      ltcgRate: 0.15,
    });
    expect(merged.find((r) => r.fy === '2027-28')!.verification).toBe('primary');
    expect(merged.map((r) => r.fy)).toEqual(
      [...new Set([...RULES.map((x) => x.fy), '2027-28'])].sort(),
    );
  });
  it('ignores a row with a bad year', () => {
    expect(mergeRules([row('2027', 1)])).toHaveLength(RULES.length);
  });
  it('carries the latest year forward and flags it when the year has no rules', () => {
    const e = effectiveRules('2030-06-01', RULES)!;
    expect(e.carriedForward).toBe(true);
    expect(e.rules.fy).toBe('2030-31');
    expect(e.rules.verification).toBe('unverified');
    expect(effectiveRules('2026-06-01', RULES)!.carriedForward).toBe(false);
    expect(effectiveRules('2010-01-01', RULES)).toBeNull();
  });
});

describe('saved order of sources', () => {
  it('gives recently added deposits a place in an order saved before they existed', () => {
    const c = configFromJson({
      liquidity: { order: ['cash', 'fd_maturing', 'mf', 'fd_break', 'stock'] },
    });
    expect(c.liquidity.order).toEqual([
      'cash',
      'fd_maturing',
      'fd_recent',
      'mf',
      'fd_break',
      'stock',
    ]);
    expect(c.liquidity.recentFdDays).toBe(90);
  });
  it('leaves an order alone when the user left early breaks out, or already ranked recent deposits', () => {
    expect(configFromJson({ liquidity: { order: ['cash', 'mf'] } }).liquidity.order).toEqual([
      'cash',
      'mf',
    ]);
    expect(
      configFromJson({ liquidity: { order: ['fd_recent', 'cash', 'fd_break'] } }).liquidity.order,
    ).toEqual(['fd_recent', 'cash', 'fd_break']);
  });

  it('reads the performance settings: lists are sorted and cleaned, bad values fall back', () => {
    const f = configFromJson({
      funds: {
        rollingYears: [5, 3, 3, 0, 99, 'x'],
        ageBucketsMonths: [36, 3, 12],
        projectionYears: [],
        riskFreeRate: 0.07,
        benchmarkCode: ' 119063 ',
        weeksShown: 2,
        plRows: 36,
      },
    }).funds;
    expect(f.rollingYears).toEqual([3, 5]);
    expect(f.ageBucketsMonths).toEqual([3, 12, 36]);
    expect(f.projectionYears).toEqual(DEFAULT_CONFIG.funds.projectionYears);
    expect(f.riskFreeRate).toBe(0.07);
    expect(f.benchmarkCode).toBe('119063');
    expect(f.weeksShown).toBe(DEFAULT_CONFIG.funds.weeksShown);
    expect(f.plRows).toBe(36);
    expect(configFromJson({ funds: { benchmarkCode: 'abc' } }).funds.benchmarkCode).toBe(
      DEFAULT_CONFIG.funds.benchmarkCode,
    );
    expect(configFromJson({ funds: { benchmarkCode: '' } }).funds.benchmarkCode).toBe('');
  });
});
