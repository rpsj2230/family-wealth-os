import { describe, expect, it } from 'vitest';
import { configFromJson, DEFAULT_CONFIG } from '@fwos/core';
import {
  CONFIG_GROUPS,
  confirmedGroups,
  groupIsDefault,
  groupValues,
  mergeGroup,
  parseGroup,
  parseNumber,
  RULE_GROUPS,
  withConfirmed,
} from './settings-fields';
import { ANCHOR_TAB, SETTINGS_TABS, settingsTabOf, tabForAnchor } from './settings-tabs';

const group = (k: string) => CONFIG_GROUPS.find((g) => g.key === k)!;
const form = (o: Record<string, string>) => (n: string) => o[n] ?? null;

describe('settings fields', () => {
  it('shows the built-in numbers the way a person types them', () => {
    const v = groupValues(group('harvest'), DEFAULT_CONFIG);
    expect(v.sttPct).toBe('0.001');
    expect(v.stampPct).toBe('0.005');
    expect(v.exitLoadPct).toBe('1');
    expect(v.nri).toBe(true);
    expect(groupValues(group('deposits'), DEFAULT_CONFIG).alertDays).toBe('7, 15, 30, 60, 90');
    expect(groupValues(group('rates'), DEFAULT_CONFIG).rateGap).toBe('0.25');
  });

  it('the fund history card holds a date and two tolerances, and a date that is not one is named', () => {
    const v = groupValues(group('funds'), DEFAULT_CONFIG);
    expect(v).toEqual({
      historyFrom: '2021-01-01',
      navStaleDays: '4',
      unitTolerance: '0.001',
      moneyTolerance: '1',
      valuationPeriods: '12',
      financialQuarters: true,
      noLedgerNoteAbove: '0',
      matchPriceTolerance: '0.2',
      matchPriceDays: '7',
      platformRules: 'in hdfc = HDFC Securities\n* = Kuvera',
      benchmarks: DEFAULT_CONFIG.funds.benchmarks.join('\n'),
      planTolerance: '2',
    });
    const ok = parseGroup(
      group('funds'),
      form({
        historyFrom: '2019-04-01',
        navStaleDays: '5',
        unitTolerance: '0.002',
        moneyTolerance: '2',
        valuationPeriods: '12',
        financialQuarters: 'on',
        noLedgerNoteAbove: '2',
        matchPriceTolerance: '0.5',
        matchPriceDays: '10',
        platformRules: ' In HDFC = HDFC Securities \n\n* = Kuvera',
        planTolerance: '3',
      }),
    );
    expect(ok).toEqual({
      ok: true,
      raw: {
        funds: {
          historyFrom: '2019-04-01',
          navStaleDays: 5,
          unitTolerance: 0.002,
          moneyTolerance: 2,
          valuationPeriods: 12,
          financialQuarters: true,
          noLedgerNoteAbove: 2,
          matchPriceTolerance: 0.005,
          matchPriceDays: 10,
          platformRules: ['In HDFC = HDFC Securities', '* = Kuvera'],
          benchmarks: [],
          planTolerance: 0.03,
        },
      },
    });
    const noEquals = parseGroup(
      group('funds'),
      form({
        historyFrom: '2019-04-01',
        navStaleDays: '5',
        unitTolerance: '0.002',
        moneyTolerance: '2',
        valuationPeriods: '12',
        noLedgerNoteAbove: '2',
        matchPriceTolerance: '0.5',
        matchPriceDays: '10',
        platformRules: 'HDFC Securities',
        planTolerance: '3',
      }),
    );
    expect(noEquals).toMatchObject({ ok: false });
    expect(noEquals.ok ? '' : noEquals.message).toMatch(/words in the fund's name = platform/);
    const bad = parseGroup(
      group('funds'),
      form({ historyFrom: '2019-02-30', unitTolerance: '0.002', moneyTolerance: '2' }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('Transactions should be on file from');
    expect(
      parseGroup(
        group('funds'),
        form({ historyFrom: '2019-04-01', unitTolerance: '2', moneyTolerance: '2' }),
      ).ok,
    ).toBe(false);
  });

  it('every field has a plain label and a one-line what-this-changes', () => {
    for (const g of CONFIG_GROUPS)
      for (const f of g.fields) {
        expect(f.label.length).toBeGreaterThan(8);
        expect(f.hint.length).toBeGreaterThan(15);
      }
  });

  it('a group typed back unchanged equals the built-in configuration', () => {
    for (const g of CONFIG_GROUPS) {
      const v = groupValues(g, DEFAULT_CONFIG);
      const typed = Object.fromEntries(
        Object.entries(v).map(([k, x]) => [k, typeof x === 'boolean' ? (x ? 'on' : '') : x]),
      );
      const r = parseGroup(g, form(typed as Record<string, string>));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const cfg = configFromJson(mergeGroup({}, r.raw));
      expect(groupIsDefault(g, cfg)).toBe(true);
    }
  });

  it('reads Indian-style numbers and percentages', () => {
    expect(parseNumber('₹ 5,00,000')).toBe(500000);
    expect(parseNumber('abc')).toBeNull();
    const r = parseGroup(
      group('estimates'),
      form({
        freshness: '40',
        sipMinInstalments: '3',
        historyStarts: '62',
        historyJumpFactor: '50',
        historyJumpFloor: '1,00,000',
        historyTieRatio: '3',
        observedRateGap: '2',
        assumedGrowthProperty: '0',
        assumedGrowthRetirement: '0',
        assumedGrowthOther: '0',
        reconcileTolerance: '1',
        savingsRate: '3.5',
        tdsRate: '0',
        savingsCreditMonths: '3',
        unexplainedTolerance: '₹ 1,000',
        transferPairDays: '3',
        openingDate: '',
        reviewMinimum: '25,000',
        reviewPairMonths: '2',
        includeSip: 'on',
        growthYears: '25',
        growthMargin: '3',
      }),
    );
    expect(r).toEqual({
      ok: true,
      raw: {
        estimates: {
          freshnessDays: 40,
          sipMinInstalments: 3,
          historyStartsAfterDays: 62,
          historyJumpFactor: 50,
          historyJumpFloor: 100000,
          historyTieRatio: 3,
          observedRateGap: 0.02,
          assumedGrowthProperty: 0,
          assumedGrowthRetirement: 0,
          assumedGrowthOther: 0,
          reconcileTolerance: 0.01,
          savingsRate: 0.035,
          interestTdsRate: 0,
          savingsSlabIncremental: false,
          savingsCreditMonths: 3,
          unexplainedTolerance: 1000,
          transferPairDays: 3,
          includeSip: true,
        },
        capital: {
          countProperty: false,
          openingDate: '',
          reviewMinimum: 25000,
          reviewPairMonths: 2,
        },
        growth: { years: 25, goodMargin: 0.03 },
      },
    });
    // clubbing and the money trail have their own card
    expect(
      parseGroup(
        group('trail'),
        form({
          ownershipFrom: '2026-10-28',
          stmtRentWords: 'Sample Tenant\n  RENT  FLAT 4B ',
          stmtRemittanceWords: 'inward remittance',
          stmtReviewAbove: '10,000',
          stmtAutoTagUpTo: '5,00,000',
          stmtAutoTagWordUpTo: '50,000',
          stmtFundMatchDays: '5',
          trailRecentFirst: 'on',
          trailSmallest: '1,000',
          trailDepth: '40',
          trailSteps: '300',
        }),
      ),
    ).toEqual({
      ok: true,
      raw: {
        capital: { ownershipFrom: '2026-10-28' },
        statements: {
          rentWords: ['sample tenant', 'rent flat 4b'],
          remittanceWords: ['inward remittance'],
          reviewAbove: 10000,
          autoTagUpTo: 500000,
          autoTagWordUpTo: 50000,
          askLarge: false,
          fundMatchDays: 5,
          trailRecentFirst: true,
          trailSmallest: 1000,
          trailDepth: 40,
          trailSteps: 300,
        },
      },
    });
  });

  it('names the box that is wrong instead of quietly using the built-in value', () => {
    const r = parseGroup(
      group('reminders'),
      form({ policyDays: '45', taskDays: 'x', harvestMonth: '3', harvestDay: '15' }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('Tasks due within');
    const month = parseGroup(
      group('reminders'),
      form({ policyDays: '45', taskDays: '7', harvestMonth: '13', harvestDay: '15' }),
    );
    expect(month.ok).toBe(false);
    const days = parseGroup(
      group('deposits'),
      form({ limit: '500000', alertDays: '7, 400', soonDays: '30' }),
    );
    expect(days.ok).toBe(false);
  });

  it('the Home numbers live in the reminders card and save into their own section', () => {
    const base = { policyDays: '45', taskDays: '7', harvestMonth: '3', harvestDay: '15' };
    const ok = parseGroup(
      group('reminders'),
      form({ ...base, changeDays: '14', upcomingDays: '90', bankShareWatch: '25' }),
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.raw.home).toEqual({ changeDays: 14, upcomingDays: 90, bankShareWatch: 0.25 });
      expect(configFromJson(mergeGroup({}, ok.raw)).home.bankShareWatch).toBe(0.25);
    }
    const bad = parseGroup(
      group('reminders'),
      form({ ...base, changeDays: '2', upcomingDays: '90', bankShareWatch: '25' }),
    );
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toContain('this many days ago');
    expect(groupValues(group('reminders'), DEFAULT_CONFIG).bankShareWatch).toBe('40');
  });

  it('saving one group leaves the others and the liquidity choices as they were', () => {
    const prior = {
      liquidity: { mode: 'fastest' },
      deposits: { insuranceLimit: 100 },
      harvest: { nri: false },
    };
    const r = parseGroup(
      group('deposits'),
      form({ limit: '600000', alertDays: '7, 30', hideMaturedDays: '90', soonDays: '20' }),
    );
    if (!r.ok) throw new Error('should parse');
    const cfg = configFromJson(mergeGroup(prior, r.raw));
    expect(cfg.deposits.insuranceLimit).toBe(600000);
    expect(cfg.deposits.hideMaturedAfterDays).toBe(90);
    expect(cfg.deposits.maturityAlertDays).toEqual([7, 30]);
    expect(cfg.reminders.maturitySoonDays).toBe(20);
    expect(cfg.liquidity.mode).toBe('fastest');
    expect(cfg.harvest.nri).toBe(false);
  });

  it('the matured-deposit window is a whole number of days from 1 to 3650', () => {
    const f = (v: string) =>
      parseGroup(
        group('deposits'),
        form({ limit: '500000', alertDays: '7, 30', hideMaturedDays: v, soonDays: '30' }),
      );
    expect(group('deposits').fields.find((x) => x.name === 'hideMaturedDays')!.label).toBe(
      'Hide a matured deposit from the lists after (days)',
    );
    expect(groupValues(group('deposits'), DEFAULT_CONFIG).hideMaturedDays).toBe('60');
    expect(f('60').ok).toBe(true);
    expect(f('0').ok).toBe(false);
    expect(f('3651').ok).toBe(false);
    expect(f('abc').ok).toBe(false);
  });

  it('tracks which groups the household has confirmed', () => {
    expect(confirmedGroups(null, DEFAULT_CONFIG)).toEqual([]);
    const cfg = configFromJson({});
    const first = withConfirmed(cfg, null, cfg, 'harvest');
    expect(first.confirmed).toEqual(['harvest']);
    const second = withConfirmed(cfg, first, configFromJson(first), 'deposits');
    expect(second.confirmed).toEqual(['deposits', 'harvest']);
    // the extra list does not disturb reading the numbers
    expect(configFromJson(second)).toEqual(cfg);
  });

  it('a document saved before the list existed counts a group as confirmed when it differs from the built-in numbers', () => {
    const raw = { deposits: { insuranceLimit: 700000 } };
    expect(confirmedGroups(raw, configFromJson(raw))).toEqual(['deposits']);
    expect(RULE_GROUPS).toHaveLength(12);
  });
});

describe('settings sections', () => {
  it('an unknown or missing tab opens the Setup view', () => {
    expect(settingsTabOf(undefined)).toBe('setup');
    expect(settingsTabOf('nonsense')).toBe('setup');
    expect(settingsTabOf('tax')).toBe('tax');
    expect(settingsTabOf(['access', 'x'])).toBe('access');
  });

  it('every old anchor lands on the section that now holds it', () => {
    expect(tabForAnchor('#email')).toBe('connections');
    expect(tabForAnchor('#rates')).toBe('connections');
    expect(tabForAnchor('#tax')).toBe('tax');
    expect(tabForAnchor('#limits')).toBe('rules');
    expect(tabForAnchor('#liquidity')).toBe('rules');
    expect(tabForAnchor('#trail')).toBe('rules');
    expect(tabForAnchor('#emergency')).toBe('access');
    expect(tabForAnchor('#telegram')).toBe('notifications');
    expect(tabForAnchor('#people')).toBe('people');
    expect(tabForAnchor('#unknown')).toBeNull();
    const keys = SETTINGS_TABS.map((t) => t.key as string);
    for (const t of Object.values(ANCHOR_TAB)) expect(keys).toContain(t);
  });
});
