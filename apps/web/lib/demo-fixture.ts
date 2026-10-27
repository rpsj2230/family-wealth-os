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

/**
 * `periodCases` adds the deposits, the dollar account and the history that Home's profit-by-period figures need to show every case
 * (money put in, paid out, renewed, foreign). The "I need money" sample has its own funds and plan and leaves them out.
 */
export function demoModel(periodCases = true) {
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
          fd_ref: `30001779${2000 + bi * 13}-1`,
        });
      }
    });
  });
  if (periodCases) {
    // deposits that exercise the periods on Home: one booked inside the last 30 days, one paid out inside this quarter, and one renewed
    // inside this financial year (the old deposit is marked renewed and the new one starts with what it paid)
    const extraFd = (
      id: string,
      bank: string,
      owner: string,
      status: string,
      principal: number,
      rate: number,
      booked: string,
      maturity: string,
      ref: number,
      more: { notes?: string; endedOn?: string; endedEstimated?: boolean } = {},
    ) => {
      assets.push(
        base({
          id,
          owner_id: owner,
          institution_id: bank,
          type: 'fixed_deposit',
          status,
          nickname: 'FD',
          account_kind: null,
          ...(more.notes ? { notes: more.notes } : {}),
        }),
      );
      fds.push({
        asset_id: id,
        principal,
        rate,
        booked_on: booked,
        maturity_on: maturity,
        compounding: 'quarterly',
        bank_maturity_amount: null,
        fd_ref_last4: String(ref),
        fd_ref: `30001779${ref}-1`,
        ...(more.endedOn ? { ended_on: more.endedOn, ended_estimated: !!more.endedEstimated } : {}),
      });
    };
    extraFd('f-eq-new', 'eq', 'p1', 'active', 750_000, 0.0725, '2026-10-06', '2027-10-06', 4101);
    extraFd('f-ja-paid', 'ja', 'p2', 'closed', 400_000, 0.071, '2025-10-08', '2026-10-08', 4102);
    extraFd('f-es-old', 'es', 'p1', 'renewed', 1_000_000, 0.072, '2025-08-18', '2026-08-18', 4103);
    extraFd(
      'f-es-renewed',
      'es',
      'p1',
      'active',
      1_073_900,
      0.0735,
      '2026-08-18',
      '2027-08-18',
      4104,
    );
    // matured deposits, for the rule that hides them. Invented. One matured 12 days ago and is not confirmed (shown, not counted, with
    // "Confirm matured"); one was confirmed matured long ago, and one from the History import was closed on an estimated date (both hidden);
    // one is still marked running two years after its date (hidden too, and in no total)
    const tabsNote =
      'Added from the monthly tabs (2021-06 to 2021-10). The tabs do not say when it ended; 2021-11 is the first month it is missing from, an estimate to correct if you know better.';
    extraFd('f-ii-recent', 'ii', 'p1', 'active', 300_000, 0.07, '2025-09-20', '2026-10-14', 4105, {
      notes: tabsNote,
    });
    extraFd('f-yb-old', 'yb', 'p1', 'closed', 250_000, 0.0625, '2021-06-10', '2021-12-10', 4106, {
      notes: tabsNote,
      endedOn: '2021-11-01',
      endedEstimated: true,
    });
    extraFd(
      'f-rb-confirmed',
      'rb',
      'p2',
      'matured',
      350_000,
      0.0675,
      '2025-07-01',
      '2026-07-01',
      4107,
    );
    extraFd('f-au-stale', 'au', 'p1', 'active', 200_000, 0.065, '2023-03-01', '2024-03-01', 4108);
    // a dollar account: its balance is in dollars and moves with the exchange rate, which is not interest
    assets.push(
      base({
        id: 's-ja-usd',
        owner_id: 'p2',
        institution_id: 'ja',
        currency: 'USD',
        account_kind: 'NRE',
        identifier_last4: '9911',
      }),
    );
    observations.push({
      id: `o${++n}`,
      asset_id: 's-ja-usd',
      kind: 'balance',
      amount: 6_200,
      currency: 'USD',
      fx_rate: 83.5,
      as_of: '2026-09-30',
      confidence: 'manual_confirmed',
      source: 'manual',
      created_at: '2026-09-30T00:00:00Z',
      superseded_by: null,
    });
  }
  // money kept for a relative: it is not in any bank, so it sits under "Other holdings"
  assets.push(
    base({
      id: 'held-1',
      owner_id: 'p1',
      type: 'third_party_held',
      nickname: 'Kept for a relative',
      holder_name: 'Sample Relative',
      account_kind: null,
    }),
  );
  obs('held-1', 450_000, '2026-10-18');
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
  const m = demoModel(false);
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
