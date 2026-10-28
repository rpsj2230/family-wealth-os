import { describe, expect, it } from 'vitest';
import { coreTokens, matchFund, parseNavAll, pickByIsin, pickByName } from '../src/amfi';

const SAMPLE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Plan;Option;Net Asset Value;Date
 
Open Ended Schemes(Equity Scheme - Small Cap Fund)
 
Nippon India Mutual Fund
 
118778;INF204K01K15;-;Nippon India Small Cap Fund;Direct Plan;Growth Option;190.5;23-Oct-2026
113177;INF204K01HY3;-;Nippon India Small Cap Fund;Regular Plan;Growth Option;170.25;23-Oct-2026
148519;INF204KB1234;-;Nippon India Nifty Smallcap 250 Index Fund;Direct Plan;Growth Option;20.1;23-Oct-2026
999001;-;-;Nippon India Small Cap Fund;Direct Plan;IDCW Option;50.1;23-Oct-2026
 
Open Ended Schemes(Equity Scheme - Large Cap Fund)
 
Axis Mutual Fund
 
120465;INF846K01DP8;-;Axis Large Cap Fund;Direct Plan;Growth Option;65.93;23-Oct-2026
112277;INF846K01131;-;Axis Large Cap Fund;Regular Plan;Growth Option;60.0;23-Oct-2026
 
Close Ended Schemes(Income)
 
Some AMC Mutual Fund
 
555001;INF000000001;-;Some Fixed Term Plan;Direct Plan;Growth Option;N.A.;
`;

describe('parseNavAll', () => {
  const s = parseNavAll(SAMPLE);
  it('reads schemes and tracks the AMC and category headings', () => {
    expect(s).toHaveLength(7);
    expect(s[0]).toMatchObject({
      code: '118778',
      name: 'Nippon India Small Cap Fund',
      plan: 'Direct',
      option: 'Growth',
      nav: 190.5,
      navDate: '2026-10-23',
      amc: 'Nippon India Mutual Fund',
    });
    expect(s[0]!.category).toBe('Equity Scheme - Small Cap Fund');
    expect(s.find((x) => x.code === '120465')!.amc).toBe('Axis Mutual Fund');
  });
  it('keeps ISINs and treats "-" as none', () => {
    expect(s[0]).toMatchObject({ isinGrowth: 'INF204K01K15', isinReinvest: null });
  });
  it('does not invent a NAV when the file says N.A.', () => {
    const x = s.find((q) => q.code === '555001')!;
    expect(x.nav).toBeNull();
    expect(x.navDate).toBeNull();
  });
});

describe('coreTokens', () => {
  it('drops filler words and normalises mid cap / small cap / bluechip spellings', () => {
    expect(coreTokens('Nippon India Small Cap Growth Direct Plan')).toEqual([
      'nippon',
      'india',
      'smallcap',
    ]);
    expect(coreTokens('(STOPPED) Mid Cap Opportunities fund (In HDFC)')).toEqual([
      'midcap',
      'opportunities',
    ]);
    expect(coreTokens('HDFC Mid-Cap Fund')).toEqual(['hdfc', 'midcap']);
  });
});

describe('matchFund', () => {
  const s = parseNavAll(SAMPLE);
  it('is confident only for a Direct plan whose name has no extra words, and ignores IDCW options', () => {
    const m = matchFund('Nippon India Small Cap Growth Direct Plan', s);
    expect(m.confidence).toBe('confident');
    expect(m.candidates[0]!.scheme.code).toBe('118778');
    expect(m.candidates.some((c) => c.scheme.code === '999001')).toBe(false);
  });
  it('offers both Direct and Regular, never "confident", when the sheet does not say', () => {
    const m = matchFund('Nippon India Small Cap Growth', s);
    expect(m.confidence).toBe('ambiguous');
    expect(
      m.candidates
        .filter((c) => c.score === 1)
        .map((c) => c.scheme.plan)
        .sort(),
    ).toEqual(['Direct', 'Regular']);
  });
  it('finds renamed funds (Bluechip -> Large Cap)', () => {
    expect(matchFund('Axis Bluechip Growth Direct Plan', s).candidates[0]!.scheme.code).toBe(
      '120465',
    );
  });
  it('returns none rather than a guess when words are missing', () => {
    expect(matchFund('Mid Cap Opportunities fund (In HDFC)', s).confidence).toBe('none');
  });
  it('shows how far today’s NAV is from the NAV written in the sheet, as a sanity check only', () => {
    const m = matchFund('Axis Bluechip Growth Direct Plan', s, 71.59);
    expect(m.candidates[0]!.navGap).toBeCloseTo(Math.abs(65.93 - 71.59) / 71.59, 6);
    expect(matchFund('Axis Bluechip Growth Direct Plan', s).candidates[0]!.navGap).toBeNull();
  });
});

describe('matching a fund to its scheme without asking', () => {
  const s = parseNavAll(SAMPLE);
  it('an ISIN names the scheme exactly, whatever the name says', () => {
    expect(pickByIsin('INF846K01DP8', s)?.code).toBe('120465');
    expect(pickByIsin('inf204k01hy3', s)?.code).toBe('113177');
    expect(pickByIsin('INF000000000', s)).toBeNull();
    expect(pickByIsin('not an isin', s)).toBeNull();
    expect(pickByIsin(null, s)).toBeNull();
  });
  it('the same words, plan and option of exactly one scheme match; a name with no plan matches two and is left alone', () => {
    expect(pickByName('Axis Large Cap Fund - Direct Plan - Growth', s)?.code).toBe('120465');
    expect(pickByName('AXIS LARGE CAP FUND DIR GR', s)?.code).toBe('120465');
    expect(pickByName('Axis Large Cap Fund', s)).toBeNull();
    expect(pickByName('Nippon India Small Cap Fund Direct IDCW', s)?.code).toBe('999001');
    expect(pickByName('Some Other Fund Direct Growth', s)).toBeNull();
  });
});
