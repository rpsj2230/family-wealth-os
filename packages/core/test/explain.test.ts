import { describe, expect, it } from 'vitest';
import {
  ALL_FIGURE_IDS,
  FIGURES,
  exDate,
  exRange,
  explain,
  levelOfShare,
  missingFigures,
  ratioHow,
  worstLevel,
} from '../src/explain';
import { buildInvestExplain, perfContextOf } from '../src/explain-invest';
import { buildPerfExplain } from '../src/explain-perf';
import { investInput, fact, perfInput } from './explain-fixture';

const everything = (input = investInput()) => ({
  ...buildInvestExplain(input),
  ...buildPerfExplain(perfInput(), perfContextOf(input)),
});

describe('explain helpers', () => {
  it('writes dates the way the app does', () => {
    expect(exDate('2026-10-26')).toBe('26 Oct 2026');
    expect(exDate(null)).toBe('–');
    expect(exRange('2022-07-05', '2026-10-26')).toBe('5 Jul 2022 to 26 Oct 2026');
    expect(exRange(null, '2026-10-26')).toBe('26 Oct 2026');
    expect(exRange('2026-10-26', '2026-10-26')).toBe('26 Oct 2026');
  });

  it('always names the denominator of a ratio', () => {
    expect(
      ratioHow({ label: 'profit', amount: 803_737 }, { label: 'money put in', amount: 4_301_000 }),
    ).toBe('₹8,03,737 profit ÷ ₹43,01,000 money put in = +18.7%');
    expect(
      ratioHow(
        { label: 'growth', amount: 803_737 },
        { label: 'today’s value', amount: 5_104_737 },
        1,
        false,
      ),
    ).toBe('₹8,03,737 growth ÷ ₹51,04,737 today’s value = 15.7%');
    expect(ratioHow({ label: 'a', amount: 1 }, { label: 'b', amount: 0 })).toContain('not defined');
  });

  it('takes the weakest level and the share of estimated things', () => {
    expect(worstLevel(['complete', 'estimated', 'partly_estimated'])).toBe('estimated');
    expect(worstLevel([])).toBe('complete');
    expect(levelOfShare(0, 5)).toBe('complete');
    expect(levelOfShare(2, 5)).toBe('partly_estimated');
    expect(levelOfShare(5, 5)).toBe('estimated');
    expect(levelOfShare(0, 0)).toBe('missing');
  });

  it('drops empty notes when assembling', () => {
    const e = explain({
      id: 'x',
      title: 't',
      what: 'w',
      how: 'h',
      level: 'complete',
      completeness: 'c',
      notes: ['a', null, '', false, 'b'],
    });
    expect(e.notes).toEqual(['a', 'b']);
  });

  it('lists a figure with no usable explainer as missing', () => {
    const good = explain({
      id: 'invest.value',
      title: 't',
      what: 'w',
      how: 'h',
      level: 'complete',
      completeness: 'c',
    });
    const missing = missingFigures('investments', { 'invest.value': good });
    expect(missing).not.toContain('invest.value');
    expect(missing).toContain('invest.profit');
    expect(missingFigures('investments', { 'invest.value': { ...good, how: '' } })).toContain(
      'invest.value',
    );
    expect(missingFigures('investments', { 'invest.value': { ...good, id: 'other' } })).toContain(
      'invest.value',
    );
  });

  it('has no duplicate figure id', () => {
    expect(new Set(ALL_FIGURE_IDS).size).toBe(ALL_FIGURE_IDS.length);
  });
});

describe('the Investments explainers', () => {
  const set = everything();

  it('covers every registered Investments figure', () => {
    expect(missingFigures('investments', set)).toEqual([]);
    expect(Object.keys(set).sort()).toEqual([...FIGURES.investments].sort());
  });

  it('states both percentages with their denominators, as the user asked', () => {
    // fixture: value 51,04,737, money put in 43,01,000, profit 8,03,737
    expect(set['invest.profit'].how).toContain('₹8,03,737 profit ÷ ₹43,01,000 invested = +18.7%');
    expect(set['invest.profit'].how).toContain(
      '₹8,03,737 profit ÷ ₹51,04,737 current value = 15.7%',
    );
    expect(set['invest.profit'].exact).toBe('+₹8,03,737');
    expect(set['invest.ring'].how).toContain(
      '₹8,03,737 profit ÷ ₹51,04,737 current value = 15.7% of the current value',
    );
    expect(set['invest.ring'].how).toContain(
      '₹8,03,737 profit ÷ ₹43,01,000 invested = 18.7% overall (+18.7%)',
    );
  });

  it('says which NAV date and how many funds are on the latest price', () => {
    const v = set['invest.value'];
    expect(v.inputs.some((x) => x.label.includes('Fund prices') && x.to === '2026-10-23')).toBe(
      true,
    );
    expect(v.notes.join(' ')).toContain('1 of 2 funds have the price of 23 Oct 2026');
    expect(v.completeness.level).toBe('partly_estimated');
    expect(v.notes.join(' ')).toContain('no live price');
    expect(v.fix?.href).toBe('/investments?tab=match');
  });

  it('puts the exact rupees in the explainer and a compact form beside a rounded one', () => {
    expect(set['invest.moneyIn'].exact).toBe('₹43,01,000');
    expect(set['invest.moneyIn'].shown).toBe('₹43.01 L');
  });

  it('describes the statement coverage with names, reasons and where to fix it', () => {
    const s = set['invest.statements'];
    expect(s.how).toContain('2 of 3 funds have statement lines');
    expect(s.how).toContain('1 is estimated');
    expect(s.how).toContain('2 are not reconciled');
    expect(s.inputs.map((x) => x.label)).toContain('Gamma Hybrid');
    expect(s.completeness.text).toContain('lines missing');
    expect(s.fix?.href).toBe('/investments#ov-dc');
    expect(s.also?.[0]?.href).toBe('/import');
  });

  it('explains why the annual return is partly estimated, with the first and last date', () => {
    const x = set['invest.xirr'];
    expect(x.completeness.level).toBe('partly_estimated');
    expect(x.completeness.text).toContain('no fund statement');
    expect(x.how).toContain('5 Jul 2022');
    expect(x.how).toContain('26 Oct 2026');
    expect(x.inputs.some((i) => i.basis === 'estimated')).toBe(true);
    expect(x.inputs.some((i) => i.basis === 'statement')).toBe(true);
  });

  it('is complete when every fund has a statement that adds up', () => {
    const clean = everything(
      investInput({
        funds: [
          fact({ assetId: 'a', value: 100, invested: 50 }),
          fact({ assetId: 'b', value: 100, invested: 50 }),
        ],
      }),
    );
    expect(clean['invest.value'].completeness.level).toBe('complete');
    expect(clean['invest.moneyIn'].completeness.level).toBe('complete');
    expect(clean['invest.statements'].completeness.level).toBe('complete');
    expect(clean['invest.value'].fix).toBeUndefined();
  });

  it('says plainly when there is nothing to work from', () => {
    const none = everything(investInput({ funds: [] }));
    expect(none['invest.value'].completeness.level).toBe('missing');
    expect(none['invest.moneyIn'].completeness.level).toBe('missing');
    expect(missingFigures('investments', none)).toEqual([]);
  });

  it('every explainer names its basis for every input and never leaves a field empty', () => {
    for (const e of Object.values(set)) {
      expect(e.title.length).toBeGreaterThan(0);
      expect(e.what.endsWith('.') || e.what.endsWith('?')).toBe(true);
      for (const i of e.inputs) {
        expect(['statement', 'recorded', 'calculated', 'estimated', 'missing']).toContain(i.basis);
        expect(i.value.length).toBeGreaterThan(0);
      }
      expect(e.how).not.toMatch(/undefined|NaN|\[object/);
      expect(e.completeness.text).not.toMatch(/undefined|NaN|\[object/);
    }
  });
});
