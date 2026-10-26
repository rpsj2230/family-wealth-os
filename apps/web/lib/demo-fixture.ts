import {
  buildBankBlocks,
  buildPortfolio,
  personStyles,
  type AssetRow,
  type FdRow,
  type ObservationRow,
} from '@fwos/core';

/**
 * Invented household that mirrors the shape of a real one (11 banks, four people, savings and deposits side by side).
 * Used only by the public /demo pages. No real names or amounts.
 */
export const DEMO_TODAY = new Date('2026-10-26T00:00:00Z');
const PEOPLE = [
  { id: 'p1', name: 'Anil' },
  { id: 'p2', name: 'Beena' },
  { id: 'p3', name: 'Chaya' },
  { id: 'p4', name: 'Dev' },
];
const BANKS: Record<string, string> = {
  eq: 'Sample Equity Bank',
  ja: 'Sample Jan Bank',
  es: 'Sample Esaf Bank',
  yb: 'Sample Yes Bank',
  rb: 'Sample RB Bank',
  ii: 'Sample Indus Bank',
  au: 'Sample AU Bank',
  id: 'Sample IDF Bank',
};

export function demoModel() {
  const assets: AssetRow[] = [];
  const observations: ObservationRow[] = [];
  const fds: FdRow[] = [];
  let n = 0;
  const base = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
    owner_id: 'p1',
    type: 'bank_account',
    status: 'active',
    nickname: 'Cash',
    currency: 'INR',
    account_kind: 'SB',
    expected_freshness_days: 35,
    ...o,
  });
  const obs = (asset_id: string, amount: number, as_of: string, source = 'manual') =>
    observations.push({
      id: `o${++n}`,
      asset_id,
      kind: 'balance',
      amount,
      currency: 'INR',
      fx_rate: null,
      as_of,
      confidence: 'manual_confirmed',
      source,
      created_at: `${as_of}T00:00:00Z`,
      superseded_by: null,
    });
  Object.keys(BANKS).forEach((b, bi) => {
    PEOPLE.slice(0, bi % 3 === 0 ? 4 : 2).forEach((p, pi) => {
      const sid = `s-${b}-${p.id}`;
      assets.push(
        base({
          id: sid,
          owner_id: p.id,
          institution_id: b,
          account_kind: pi % 2 ? 'NRO' : 'NRE',
          identifier_last4: String(1100 + bi * 17 + pi),
        }),
      );
      const recent = (bi + pi) % 3 !== 0;
      obs(
        sid,
        40_000 + bi * 91_000 + pi * 37_000,
        recent ? '2026-10-22' : '2026-09-12',
        bi === 3 ? 'email' : 'manual',
      );
      if (pi < 2) {
        const fid = `f-${b}-${p.id}`;
        const maturity = ['2026-11-01', '2027-03-15', '2028-01-20', '2026-10-05'][(bi + pi) % 4]!;
        assets.push(
          base({
            id: fid,
            owner_id: p.id,
            institution_id: b,
            type: 'fixed_deposit',
            nickname: 'FD',
            account_kind: null,
            linked_last4: String(1100 + bi * 17 + pi),
          }),
        );
        fds.push({
          asset_id: fid,
          principal: 500_000 + bi * 150_000,
          rate: 0.0675 + (bi % 4) * 0.005,
          booked_on: '2025-10-26',
          maturity_on: maturity,
          compounding: 'quarterly',
          bank_maturity_amount: pi === 0 ? Math.round((500_000 + bi * 150_000) * 1.28) : null,
          fd_ref_last4: String(2000 + bi * 13),
        });
      }
    });
  });
  const portfolio = buildPortfolio(assets, observations, fds, DEMO_TODAY);
  const blocks = buildBankBlocks({
    assets,
    observations,
    fds,
    portfolio,
    institutionNames: BANKS,
    today: DEMO_TODAY,
  });
  return {
    blocks,
    styles: personStyles(PEOPLE),
    portfolio,
    people: PEOPLE,
    assets,
    observations,
    fds,
    institutionNames: BANKS,
  };
}

/** The same invented household plus a few funds, shares and a property, for the public "I need money" sample. */
export function demoRaiseSources() {
  const m = demoModel();
  const assets = [...m.assets];
  const observations = [...m.observations];
  const extra: [string, string, AssetRow['type'], string, number][] = [
    ['mf-1', 'p1', 'mutual_fund', 'Sample Flexi Cap Fund', 640_000],
    ['mf-2', 'p1', 'mutual_fund', 'Sample Small Cap Fund (SIP running)', 380_000],
    ['mf-3', 'p2', 'mutual_fund', 'Sample Index Fund', 520_000],
    ['st-1', 'p2', 'stock', 'Sample Shares', 210_000],
    ['pr-1', 'p1', 'property', 'Sample Flat', 8_500_000],
    ['rc-1', 'p3', 'receivable', 'Loan to a relative', 200_000],
  ];
  extra.forEach(([id, owner, type, nickname, amount], i) => {
    assets.push({
      id,
      owner_id: owner,
      type,
      status: 'active',
      nickname,
      currency: 'INR',
      account_kind: null,
      expected_freshness_days: 35,
    });
    observations.push({
      id: `ox${i}`,
      asset_id: id,
      kind: 'balance',
      amount,
      currency: 'INR',
      fx_rate: null,
      as_of: '2026-10-20',
      confidence: 'manual_confirmed',
      source: 'manual',
      created_at: '2026-10-20T00:00:00Z',
      superseded_by: null,
    });
  });
  const portfolio = buildPortfolio(assets, observations, m.fds, DEMO_TODAY);
  const funds = [
    { assetId: 'mf-1', invested: 420_000, startedOn: '2022-04-01', sipActive: false },
    { assetId: 'mf-2', invested: 300_000, startedOn: '2024-02-01', sipActive: true },
    { assetId: 'mf-3', invested: 380_000, startedOn: '2025-12-01', sipActive: false },
  ];
  return {
    today: DEMO_TODAY.toISOString().slice(0, 10),
    styles: m.styles,
    people: m.people,
    valued: portfolio.valued,
    assetRows: assets,
    fds: m.fds,
    funds,
    institutionNames: m.institutionNames,
  };
}
