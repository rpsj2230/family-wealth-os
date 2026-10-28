import { describe, expect, it } from 'vitest';
import { CANNOT_TELL } from '@fwos/core';
import { parseNavAll } from '../src/amfi';
import { NOT_LISTED, schemeProposal } from '../src/scheme-proposal';
import {
  differencesFrom,
  schemeLabel,
  searchSchemes,
  suggestSchemes,
  type FundToMatch,
} from '../src/scheme-suggest';

/**
 * Which official scheme is a fund? The list is written the way AMFI's file is (plan and option in their own columns, names without
 * them), with invented ISINs. The traps: Regular vs Direct, IDCW vs Growth, a renamed scheme, two spellings, two plausible schemes.
 */
const LIST =
  parseNavAll(`Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date

Open Ended Schemes(Equity Scheme - Large Cap Fund)

Axis Mutual Fund

120465;INF000A01AA1;-;Axis Large Cap Fund;Direct Plan;Growth Option;66.5;27-Oct-2026
120466;INF000A01AB9;INF000A01AC7;Axis Large Cap Fund;Direct Plan;IDCW Option;24.1;27-Oct-2026
112277;INF000A01AD5;-;Axis Large Cap Fund;Regular Plan;Growth Option;57.2;27-Oct-2026
112278;INF000A01AE3;INF000A01AF0;Axis Large Cap Fund;Regular Plan;IDCW Option;16.7;27-Oct-2026
145110;INF000A01BA0;-;Axis Large & Mid Cap Fund;Direct Plan;Growth Option;36.3;27-Oct-2026
145112;INF000A01BB8;-;Axis Large & Mid Cap Fund;Regular Plan;Growth Option;32.5;27-Oct-2026

Open Ended Schemes(Equity Scheme - Mid Cap Fund)

Edelweiss Mutual Fund

118000;INF000E01AA3;-;Edelweiss Mid Cap Fund;Direct Plan;Growth Option;100.1;27-Oct-2026
118001;INF000E01AB1;-;Edelweiss Mid Cap Fund;Regular Plan;Growth Option;90.1;27-Oct-2026

Motilal Oswal Mutual Fund

127044;INF000M01AA9;INF000M01AB7;Motilal Oswal Midcap Fund;;;45.1;27-Oct-2026
127042;INF000M01AC5;-;Motilal Oswal Midcap Fund;;;110.8;27-Oct-2026

Nippon India Mutual Fund

118778;INF000N01AA7;-;Nippon India Small Cap Fund;Direct Plan;Growth Option;190.5;27-Oct-2026
113177;INF000N01AB5;-;Nippon India Small Cap Fund;Regular Plan;Growth Option;170.2;27-Oct-2026
999001;INF000N01AC3;-;Nippon India Small Cap Fund;Direct Plan;IDCW Option;50.1;27-Oct-2026

HDFC Mutual Fund

118968;INF000H01AA5;-;HDFC Balanced Advantage Fund;Direct Plan;Growth Option;500.1;27-Oct-2026
100119;INF000H01AB3;-;HDFC Balanced Advantage Fund;Regular Plan;Growth Option;450.1;27-Oct-2026

ICICI Prudential Mutual Fund

120586;INF000I01AA2;-;ICICI Prudential Bluechip Fund;Direct Plan;Growth Option;105.1;27-Oct-2026

Quant Mutual Fund

120828;INF000Q01AA8;-;Quant Small Cap Fund;Direct Plan;Growth Option;250.1;27-Oct-2026
`);

const fund = (name: string, extra: Partial<FundToMatch> = {}): FundToMatch => ({
  assetId: 'a1',
  name,
  isins: [],
  ...extra,
});
const suggest = (name: string, extra: Partial<FundToMatch> = {}) =>
  suggestSchemes(fund(name, extra), LIST, { maxChoices: 3 });
const codeOf = (s: ReturnType<typeof suggest>) => s.recommended?.scheme.code ?? null;

describe('a known ISIN is certain', () => {
  it('finds the scheme by its growth ISIN, whatever the fund is called', () => {
    const s = suggest('My old name for it', {
      isins: [{ isin: 'INF000A01AA1', source: 'fund' }],
    });
    expect(codeOf(s)).toBe('120465');
    expect(s.recommended?.certainty).toBe('certain');
    expect(s.recommended?.matchedIsin).toBe('INF000A01AA1');
    expect(s.recommended?.reason).toContain('saved on this fund');
  });
  it('finds an IDCW scheme by its reinvestment ISIN too, and says where the ISIN was read', () => {
    const s = suggest('Axis Large Cap', { isins: [{ isin: 'inf000a01ac7', source: 'preview' }] });
    expect(codeOf(s)).toBe('120466');
    expect(s.recommended?.certainty).toBe('certain');
    expect(s.recommended?.reason).toContain('statement being previewed');
  });
  it('beats the name: the ISIN decides even when the name points to another plan', () => {
    const s = suggest('Axis Large Cap Fund - Direct Plan - Growth', {
      isins: [{ isin: 'INF000A01AD5', source: 'statement' }],
    });
    expect(codeOf(s)).toBe('112277'); // the Regular plan
    expect(s.recommended?.certainty).toBe('certain');
  });
  it('is certain even when the official name does not say the plan (the ISIN tells them apart)', () => {
    const s = suggest('Motilal Oswal Midcap', {
      isins: [{ isin: 'INF000M01AC5', source: 'statement' }],
    });
    expect(codeOf(s)).toBe('127042');
    expect(s.recommended?.certainty).toBe('certain');
  });
  it('an ISIN that is not in the list says so and falls back to the name', () => {
    const s = suggest('Axis Large Cap Fund - Direct Plan - Growth', {
      isins: [{ isin: 'INF999Z99ZZ9', source: 'statement' }],
    });
    expect(codeOf(s)).toBe('120465');
    expect(s.recommended?.certainty).toBe('high');
    expect(s.recommended?.reason).toContain('INF999Z99ZZ9');
    expect(s.recommended?.reason).toContain('not in today');
  });
  it('an ISIN listed for several schemes recommends none of them', () => {
    const twice = [
      ...LIST,
      {
        ...LIST.find((x) => x.code === '120465')!,
        code: '999999',
        name: 'Axis Large Cap Fund (old)',
      },
    ];
    const s = suggestSchemes(
      fund('x', { isins: [{ isin: 'INF000A01AA1', source: 'fund' }] }),
      twice,
      {
        maxChoices: 3,
      },
    );
    expect(s.recommended).toBeNull();
    expect(s.choices.map((c) => c.scheme.code).sort()).toEqual(['120465', '999999']);
  });
});

describe('the name alone', () => {
  it('an exact name with plan and option is high', () => {
    const s = suggest('Axis Large Cap Fund - Direct Plan - Growth');
    expect(codeOf(s)).toBe('120465');
    expect(s.recommended?.certainty).toBe('high');
    expect(s.recommended?.reason).toContain('Direct plan');
  });
  it('the plan and option can be written in any order or shorthand', () => {
    expect(codeOf(suggest('Nippon India Small Cap Growth Direct Plan'))).toBe('118778');
    expect(codeOf(suggest('NIPPON INDIA SMALL CAP FUND - DIRECT GROWTH PLAN GROWTH OPTION'))).toBe(
      '118778',
    );
    expect(codeOf(suggest('Nippon India Small Cap Fund Dir Gr'))).toBe('118778');
  });
  it('Regular is not Direct: a fund called Regular gets the Regular scheme', () => {
    const s = suggest('Axis Large Cap Fund - Regular Plan - Growth');
    expect(codeOf(s)).toBe('112277');
    expect(s.recommended?.scheme.plan).toBe('Regular');
  });
  it('trap: with no plan in the name nothing is recommended, and Direct and Regular are both offered with the difference', () => {
    const s = suggest('Axis Large Cap Fund');
    expect(s.recommended).toBeNull();
    const plans = s.choices.map((c) => c.scheme.plan);
    expect(plans).toContain('Direct');
    expect(plans).toContain('Regular');
    expect(
      s.choices.find((c) => c.scheme.plan === 'Regular' && c.scheme.option === 'Growth')!
        .differences,
    ).toContain('Regular instead of Direct');
    expect(s.note).toContain('does not say Direct or Regular');
  });
  it('the plan saved on the fund can stand in for the name, as a medium match', () => {
    const s = suggest('Axis Large Cap Fund', { planType: 'regular' });
    expect(codeOf(s)).toBe('112277');
    expect(s.recommended?.certainty).toBe('medium');
    expect(s.recommended?.reason).toContain('plan saved on the fund');
    // "regular_or_unknown" is not evidence
    expect(
      suggest('Axis Large Cap Fund', { planType: 'regular_or_unknown' }).recommended,
    ).toBeNull();
  });
  it('trap: IDCW is never taken for Growth, and Growth is never taken for IDCW', () => {
    const idcw = suggest('Axis Large Cap Fund - Direct Plan - IDCW');
    expect(codeOf(idcw)).toBe('120466');
    expect(idcw.recommended?.scheme.option).toBe('IDCW');
    const growth = suggest('Nippon India Small Cap Fund - Direct Plan');
    expect(growth.recommended?.scheme.option).toBe('Growth');
    expect(growth.recommended?.certainty).toBe('medium');
    expect(growth.recommended?.reason).toContain('does not say IDCW');
    // the same words with IDCW listed alongside: the alternative says how it differs
    expect(growth.choices.find((c) => c.scheme.code === '999001')?.differences).toContain(
      'IDCW instead of Growth',
    );
    // a fund whose name says Dividend gets the IDCW scheme
    expect(codeOf(suggest('Nippon India Small Cap Fund - Direct Plan - Dividend'))).toBe('999001');
  });
  it('a renamed scheme is found under its new name and the rename is said', () => {
    // the other way round: the list still says Bluechip, the fund says Large Cap
    const s = suggest('ICICI Prudential Large Cap Fund Direct Growth');
    expect(codeOf(s)).toBe('120586');
    expect(s.recommended?.reason).toContain('renamed');
    const b = suggest('Axis Bluechip Fund - Direct Plan - Growth');
    expect(codeOf(b)).toBe('120465'); // Axis Bluechip is now Axis Large Cap
    expect(b.recommended?.reason).toContain('renamed');
    const w = suggest('Axis Bluechip Growth Direct Plan');
    expect(codeOf(w)).toBe('120465');
  });
  it('Mid Cap, Midcap and Mid-Cap are the same words', () => {
    for (const n of [
      'Edelweiss Mid Cap Fund Direct Growth',
      'Edelweiss Midcap Fund Direct Growth',
      'Edelweiss Mid-Cap Direct Plan Growth',
    ])
      expect(codeOf(suggest(n))).toBe('118000');
  });
  it('does not take Large & Mid Cap for Large Cap', () => {
    expect(codeOf(suggest('Axis Large & Mid Cap Fund Direct Growth'))).toBe('145110');
    expect(codeOf(suggest('Axis Large Cap Fund Direct Growth'))).toBe('120465');
  });
  it('a short form of the fund house is spelled out', () => {
    expect(codeOf(suggest('ICICI Pru Bluechip Fund Direct Growth'))).toBe('120586');
  });
  it('two plausible schemes: lists the best three and says it cannot tell', () => {
    // the official list does not give these two their plan or option: only the ISIN tells them apart
    const s = suggest('Motilal Oswal Midcap Growth Direct Plan');
    expect(s.recommended).toBeNull();
    expect(s.choices).toHaveLength(2);
    expect(s.choices[1]!.differences.join(' ')).toContain('INF000M01AC5');
    const p = schemeProposal(
      { ...fund('Motilal Oswal Midcap Growth Direct Plan'), folioLast4: null },
      s,
    );
    expect(p.suggest).toBe(CANNOT_TELL);
    expect(p.approve).toBeNull();
    expect(p.recommended).toBeNull();
  });
  it('lists at most the number asked for', () => {
    const s = suggestSchemes(fund('Axis Large Cap Fund'), LIST, { maxChoices: 2 });
    expect(s.choices).toHaveLength(2);
  });
  it('a name with nothing in the list says so', () => {
    const s = suggest('Zzz Totally Unknown Fund');
    expect(s.recommended).toBeNull();
    expect(s.choices).toHaveLength(0);
    expect(s.note).toContain('No scheme in the official list');
  });
  it('a statement line that runs into the next column is cut off', () => {
    expect(
      codeOf(
        suggest('HDFC Balanced Advantage Fund - Direct Plan - Growth Option Registrar : CAMS'),
      ),
    ).toBe('118968');
  });
});

describe('describing the schemes', () => {
  it('writes the plan and option the official name leaves out', () => {
    const s = LIST.find((x) => x.code === '120466')!;
    expect(schemeLabel(s)).toBe('Axis Large Cap Fund - Direct Plan - IDCW Option');
    expect(
      differencesFrom(
        LIST.find((x) => x.code === '112277')!,
        LIST.find((x) => x.code === '120465')!,
      ),
    ).toEqual(['Regular instead of Direct']);
  });
});

describe('the sentence the person reads', () => {
  it('has the four parts for a certain match, with the Approve button naming the scheme and its code', () => {
    const f = {
      ...fund('Axis Bluechip', { isins: [{ isin: 'INF000A01AA1', source: 'statement' }] }),
      folioLast4: '3820',
    };
    const p = schemeProposal(f, suggestSchemes(f, LIST, { maxChoices: 3 }));
    expect(p.found).toContain('Axis Bluechip');
    expect(p.found).toContain('folio …3820');
    expect(p.found).toContain('no price source');
    expect(p.found).toContain('INF000A01AA1');
    expect(p.suggest).toBe(
      'Use Axis Large Cap Fund - Direct Plan - Growth Option (AMFI code 120465).',
    );
    expect(p.why).toContain('same scheme');
    expect(p.approve).toBe(
      'Approve: use Axis Large Cap Fund - Direct Plan - Growth Option (AMFI code 120465)',
    );
    expect(p.options[0]!.id).toBe('120465');
    expect(p.options.at(-1)!.id).toBe(NOT_LISTED);
    expect(p.options.at(-1)!.label).toContain('not a listed fund');
    expect(p.options.at(-1)!.label).toContain('no price source');
  });
  it('offers the other choices with how they differ', () => {
    const f = fund('Nippon India Small Cap Fund - Direct Plan');
    const p = schemeProposal(f, suggestSchemes(f, LIST, { maxChoices: 3 }));
    const other = p.options.find((o) => o.id === '113177')!;
    expect(other.label).toContain('Regular instead of Direct');
    expect(other.action).toContain('AMFI code 113177');
  });
});

describe('searching by what a person types', () => {
  it('finds schemes by words in any order, by ISIN and by AMFI code', () => {
    expect(searchSchemes('large cap axis', LIST, 10).map((s) => s.code)).toContain('120465');
    expect(searchSchemes('axis large cap direct', LIST, 10).every((s) => s.plan === 'Direct')).toBe(
      true,
    );
    expect(searchSchemes('INF000A01AD5', LIST, 10).map((s) => s.code)).toEqual(['112277']);
    expect(searchSchemes('118778', LIST, 10).map((s) => s.code)).toEqual(['118778']);
  });
  it('puts the exact name first, Direct Growth before the rest, and stops at the limit', () => {
    const r = searchSchemes('nippon india small cap', LIST, 2);
    expect(r).toHaveLength(2);
    expect(r[0]!.code).toBe('118778');
  });
  it('a query that is too short or finds nothing returns nothing', () => {
    expect(searchSchemes('a', LIST, 10)).toEqual([]);
    expect(searchSchemes('zzzz qqqq', LIST, 10)).toEqual([]);
  });
});
