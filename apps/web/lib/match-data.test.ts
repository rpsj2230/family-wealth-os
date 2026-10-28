import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMatchView } from './match-data';
import {
  likePattern,
  lookupWords,
  schemeFromRow,
  schemesForFund,
  searchSchemeList,
} from './scheme-pool';
import { testDb } from './test-db';

/**
 * What the Match funds tab is built from: each fund with no price source gets the suggestion the ranking makes from the stored
 * official list, an ISIN saved on the fund (read from a statement) makes it certain, a fund marked "not a listed fund" or sold is left
 * out of the questions, and a matched fund shows its scheme's name.
 */
const A = (n: number) => `00000000-0000-0000-0000-00000000000${n}`;
const scheme = (
  code: string,
  name: string,
  plan: string,
  option: string,
  isin: string,
  reinvest: string | null = null,
) => ({
  code,
  name,
  plan,
  option,
  amc: `${name.split(' ')[0]} Mutual Fund`,
  category: 'Equity Scheme',
  isin_growth: isin,
  isin_reinvest: reinvest,
});

function world(over: { missingColumns?: Record<string, string[]> } = {}) {
  return testDb({
    ...over,
    tables: {
      amfi_schemes: [
        scheme('120465', 'Axis Large Cap Fund', 'Direct Plan', 'Growth Option', 'INF000A01AA1'),
        scheme('112277', 'Axis Large Cap Fund', 'Regular Plan', 'Growth Option', 'INF000A01AD5'),
        scheme(
          '120466',
          'Axis Large Cap Fund',
          'Direct Plan',
          'IDCW Option',
          'INF000A01AB9',
          'INF000A01AC7',
        ),
        scheme('118000', 'Edelweiss Mid Cap Fund', 'Direct Plan', 'Growth Option', 'INF000E01AA3'),
        scheme('118001', 'Edelweiss Mid Cap Fund', 'Regular Plan', 'Growth Option', 'INF000E01AB1'),
      ],
      owners: [{ id: 'o1', display_name: 'Rupash' }],
      assets: [
        { id: A(1), owner_id: 'o1', status: 'active' },
        { id: A(2), owner_id: 'o1', status: 'active' },
        { id: A(3), owner_id: 'o1', status: 'active' },
        { id: A(4), owner_id: 'o1', status: 'closed' },
        { id: A(5), owner_id: 'o1', status: 'active' },
        { id: A(6), owner_id: 'o1', status: 'active' },
      ],
      observations: [{ asset_id: A(1), amount: 250000, as_of: '2026-09-28', superseded_by: null }],
      mf_positions: [
        // ISIN known from a statement: certain, whatever the name is
        {
          asset_id: A(1),
          fund_name: 'Some Old Name',
          amfi_code: null,
          isin: 'INF000A01AD5',
          folio_last4: '3820',
          units: 100,
          invested: 200000,
          plan_type: 'regular_or_unknown',
          no_price_source: false,
          sip_monthly: null,
          sip_stopped: false,
          exit_load_pct: null,
          exit_load_days: null,
        },
        // name only, no plan: cannot tell
        {
          asset_id: A(2),
          fund_name: 'Edelweiss Mid Cap Fund',
          amfi_code: null,
          isin: null,
          folio_last4: null,
          units: null,
          invested: null,
          plan_type: 'regular_or_unknown',
          no_price_source: false,
          sip_monthly: 5000,
          sip_stopped: false,
          exit_load_pct: null,
          exit_load_days: null,
        },
        // already matched
        {
          asset_id: A(3),
          fund_name: 'Axis Bluechip Direct Growth',
          amfi_code: '120465',
          isin: 'INF000A01AA1',
          folio_last4: null,
          units: 10,
          invested: 1,
          plan_type: 'direct',
          no_price_source: false,
          sip_monthly: null,
          sip_stopped: false,
          exit_load_pct: null,
          exit_load_days: null,
        },
        // sold
        {
          asset_id: A(4),
          fund_name: 'Sold Fund',
          amfi_code: null,
          isin: null,
          folio_last4: null,
          units: 0,
          invested: 0,
          plan_type: 'direct',
          no_price_source: false,
          sip_monthly: null,
          sip_stopped: true,
          exit_load_pct: null,
          exit_load_days: null,
        },
        // the person said it is not a listed fund
        {
          asset_id: A(5),
          fund_name: 'Private Fund',
          amfi_code: null,
          isin: null,
          folio_last4: null,
          units: 5,
          invested: 5,
          plan_type: 'direct',
          no_price_source: true,
          sip_monthly: null,
          sip_stopped: false,
          exit_load_pct: null,
          exit_load_days: null,
        },
        // a plan saved on the fund and the name: a likely match
        {
          asset_id: A(6),
          fund_name: 'Edelweiss Midcap Fund',
          amfi_code: null,
          isin: null,
          folio_last4: null,
          units: 3,
          invested: 3,
          plan_type: 'direct',
          no_price_source: false,
          sip_monthly: null,
          sip_stopped: false,
          exit_load_pct: null,
          exit_load_days: null,
        },
      ],
      // an ISIN a statement on file gave for a fund (the folio link keeps it as the scheme's key)
      fund_folio_links: [{ asset_id: A(2), scheme_key: 'inf000e01ab1' }],
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(Date.now() + 40_000 * Math.floor(Math.random() * 1e6));
});

describe('the Match funds view', () => {
  it('suggests for each fund with no scheme, by the strongest evidence', async () => {
    const w = world();
    const v = await loadMatchView(w.db);
    const row = (n: number) => v.rows.find((r) => r.assetId === A(n))!;
    expect(v.haveList).toBe(true);
    expect(v.canMark).toBe(true);

    // an ISIN saved on the fund: certain, and the Approve button names the scheme and its code
    const one = row(1);
    expect(one.certainty).toBe('certain');
    expect(one.proposal!.approve).toBe(
      'Approve: use Axis Large Cap Fund - Regular Plan - Growth Option (AMFI code 112277)',
    );
    expect(one.proposal!.found).toContain('folio …3820');
    expect(one.lastValue).toEqual({ amount: 250000, asOf: '2026-09-28' });

    // an ISIN read from a statement on file (the folio link's key) settles a fund whose name does not say the plan
    const two = row(2);
    expect(two.certainty).toBe('certain');
    expect(two.proposal!.recommended).toBe('118001');
    expect(two.proposal!.why).toContain('statement already on file');

    // the plan saved on the fund and a name that fits: likely, with the Regular scheme offered and its difference named
    const six = row(6);
    expect(six.certainty).toBe('medium');
    expect(six.proposal!.recommended).toBe('118000');
    expect(six.proposal!.options.find((o) => o.id === '118001')!.label).toContain(
      'Regular instead of Direct',
    );
  });

  it('asks nothing of a matched, sold or "not listed" fund, and names the matched fund’s scheme', async () => {
    const v = await loadMatchView(world().db);
    for (const n of [3, 4, 5]) expect(v.rows.find((r) => r.assetId === A(n))!.proposal).toBeNull();
    expect(v.rows.find((r) => r.assetId === A(3))!.schemeName).toBe('Axis Large Cap Fund');
    expect(v.rows.find((r) => r.assetId === A(5))!.noPriceSource).toBe(true);
    expect(v.rows.find((r) => r.assetId === A(4))!.closed).toBe(true);
  });

  it('offers no suggestions while the official list is empty', async () => {
    const w = world();
    w.tables.amfi_schemes!.length = 0;
    const v = await loadMatchView(w.db);
    expect(v.haveList).toBe(false);
    expect(v.rows.every((r) => r.proposal === null)).toBe(true);
  });

  it('still loads before the database update that adds the "not a listed fund" mark has run', async () => {
    const w = world({ missingColumns: { mf_positions: ['no_price_source'] } });
    for (const p of w.tables.mf_positions!) delete p.no_price_source;
    const v = await loadMatchView(w.db);
    expect(v.canMark).toBe(false);
    expect(v.rows.find((r) => r.assetId === A(5))!.noPriceSource).toBe(false);
  });
});

describe('looking schemes up', () => {
  it('turns Mid Cap, Midcap and Mid-Cap into one search pattern', () => {
    expect(likePattern('midcap')).toBe('%mid%cap%');
    expect(likePattern('axis')).toBe('%axis%');
    expect(lookupWords('Axis Bluechip Growth Direct Plan', 2)).toEqual(['largecap', 'axis']);
  });
  it('reads a stored row the way the AMFI file is read', () => {
    const s = schemeFromRow(scheme('1', 'X Fund', 'Regular Plan', 'IDCW Option', 'INF000X01AA1'));
    expect(s).toMatchObject({ plan: 'Regular', option: 'IDCW', code: '1' });
    expect(
      schemeFromRow({ ...scheme('2', 'Y', '', '', 'INF000X01AA2'), plan: null, option: null }),
    ).toMatchObject({ plan: 'Other', option: 'Other' });
  });
  it('shortlists by ISIN and by the telling words of the name', async () => {
    const w = world();
    const list = await schemesForFund(w.db, { name: 'Axis Bluechip', isins: ['inf000e01ab1'] });
    expect(list.map((s) => s.code).sort()).toEqual(['112277', '118001', '120465', '120466']);
  });
  it('searches by words, ISIN and code and returns the best few', async () => {
    const w = world();
    expect(
      (await searchSchemeList(w.db, 'edelweiss mid cap direct', 10)).map((s) => s.code),
    ).toEqual(['118000']);
    expect((await searchSchemeList(w.db, 'INF000A01AB9', 10)).map((s) => s.code)).toEqual([
      '120466',
    ]);
    expect((await searchSchemeList(w.db, '112277', 10)).map((s) => s.code)).toEqual(['112277']);
    expect(await searchSchemeList(w.db, 'a', 10)).toEqual([]);
    expect(await searchSchemeList(w.db, 'axis large cap', 2)).toHaveLength(2);
  });
});
