import { describe, expect, it } from 'vitest';
import {
  bankHistory,
  buildActivity,
  buildAssetView,
  observationsTable,
  type AssetViewInput,
} from './detail-view';

const base = (o: Partial<AssetViewInput> = {}): AssetViewInput => ({
  today: '2026-10-26',
  asset: {
    id: 'a1',
    type: 'fixed_deposit',
    nickname: 'FD',
    label: null,
    status: 'active',
    currency: 'INR',
    account_kind: 'NRE',
    is_joint: false,
    identifier_last4: null,
    linked_last4: '0266',
    notes: null,
    holder_name: null,
  },
  ownerName: 'Anil',
  bankName: 'Sample Bank',
  code: 'FD-NRE-5076',
  current: { amount: 1_100_000, basis: 'calculated', ageDays: 0, asOf: '2026-10-26' },
  observations: [],
  fd: {
    principal: 1_000_000,
    rate: 0.07,
    booked_on: '2025-10-26',
    maturity_on: '2027-10-26',
    compounding: 'quarterly',
    bank_maturity_amount: null,
    fd_ref_last4: '5076',
  },
  position: null,
  txns: [],
  navs: [],
  receivable: null,
  payments: [],
  goalNames: [],
  linked: { id: 's1', label: 'Cash-NRE-0266' },
  ...o,
});

describe('observationsTable', () => {
  it('lists newest first and dims replaced values', () => {
    const t = observationsTable([
      {
        id: '1',
        amount: 100,
        currency: 'INR',
        fx_rate: null,
        as_of: '2026-09-30',
        confidence: 'verified',
        source: 'email',
        note: null,
        created_at: '2026-09-30T10:00:00Z',
        superseded_by: null,
      },
      {
        id: '2',
        amount: 8300,
        currency: 'SGD',
        fx_rate: 74,
        as_of: '2026-10-25',
        confidence: 'manual_confirmed',
        source: 'manual',
        note: 'typed',
        created_at: '2026-10-25T10:00:00Z',
        superseded_by: '3',
      },
    ]);
    expect(t.rows[0]!.cells[0]).toBe('2026-10-25');
    expect(t.rows[0]!.dim).toBe(true);
    expect(t.rows[0]!.cells[1]).toBe('SGD 8,300');
    expect(t.rows[0]!.cells[2]).toBe('₹6,14,200');
    expect(t.rows[1]!.cells[7]).toBe('Yes');
    expect(t.rows[1]!.cells[3]).toBe('–'); // the first reading has nothing before it to compare with
    expect(t.columns[3]).toBe('Change');
  });
});

describe('buildAssetView: deposit', () => {
  const v = buildAssetView(base());
  const f = (l: string) => v.facts.find((x) => x.label === l);
  it('shows the terms, the accrued value and the link to the savings account', () => {
    expect(v.title).toBe('FD');
    expect(f('Rate')!.value).toBe('7%');
    expect(f('Maturity date')!.note).toBe('365 days left');
    expect(f('Accrued today')!.value).toMatch(/^₹10,/);
    expect(f('Linked savings account')).toMatchObject({
      value: 'Cash-NRE-0266',
      href: '/asset/s1',
    });
    expect(f('Deposit number')!.value).toBe('…5076');
  });
  it('adds an interest table by financial year with the NRE treatment, and a value chart', () => {
    const t = v.tables.find((x) => x.title === 'Interest by financial year')!;
    expect(t.rows.length).toBe(3);
    expect(t.rows[0]!.cells[4]).toBe('Exempt (NRE)');
    expect(v.charts[0]!.points.length).toBeGreaterThan(10);
  });
});

describe('buildAssetView: fund and loan', () => {
  it('works out XIRR from the ledger, lots and sales', () => {
    const v = buildAssetView(
      base({
        asset: { ...base().asset, type: 'mutual_fund', nickname: 'Sample Fund' },
        fd: null,
        linked: null,
        code: null,
        current: { amount: 121_000, basis: 'estimated', ageDays: 3, asOf: '2026-10-23' },
        position: {
          fund_name: 'Sample Flexi Cap',
          invested: 100_000,
          started_on: '2024-10-26',
          sip_monthly: null,
          sip_stopped: false,
          folio_last4: '1234',
          isin: 'INF000A01AB1',
          amfi_code: '120503',
          plan_type: 'direct',
        },
        txns: [
          {
            txn_on: '2024-10-26',
            kind: 'purchase',
            amount: 100_000,
            units: 1000,
            nav: 100,
            balance_units: 1000,
            description: null,
          },
          {
            txn_on: '2025-10-26',
            kind: 'redeem',
            amount: -30_000,
            units: -250,
            nav: 120,
            balance_units: 750,
            description: null,
          },
        ],
        goalNames: ['House'],
      }),
    );
    expect(v.facts.find((x) => x.label === 'Return a year (XIRR)')!.note).toBe(
      'from the fund statement transactions',
    );
    expect(v.facts.find((x) => x.label === 'Goal')!.value).toBe('House');
    const titles = v.tables.map((t) => t.title);
    expect(titles).toEqual([
      'Recorded values',
      'Transactions',
      'Units still held (oldest first)',
      'Sales and the purchases they used',
    ]);
    expect(v.tables[1]!.rows[0]!.cells[1]).toBe('Sale');
    expect(v.tables[2]!.rows[0]!.cells[1]).toBe('750');
    expect(v.tables[3]!.rows[0]!.cells[5]).toBe('₹5,000');
  });
  it('shows what is still owed on money lent', () => {
    const v = buildAssetView(
      base({
        asset: { ...base().asset, type: 'receivable', nickname: 'Loan' },
        fd: null,
        receivable: {
          counterparty: 'Somesh',
          lent: 200_000,
          lent_on: '2026-01-01',
          expected_on: '2027-01-01',
          interest_note: null,
        },
        payments: [{ amount: 50_000, paid_on: '2026-06-01', note: null }],
      }),
    );
    expect(v.title).toBe('Somesh');
    expect(v.facts.find((x) => x.label === 'Still owed')!.value).toBe('₹1,50,000');
    expect(v.tables.find((t) => t.title === 'Repayments')!.rows).toHaveLength(1);
  });
});

describe('buildActivity', () => {
  it('writes who, and puts the newest first', () => {
    const items = buildActivity({
      viewerId: 'me',
      audit: [
        {
          actor: 'me',
          table_name: 'assets',
          row_id: 'a',
          action: 'UPDATE',
          before: { account_kind: null },
          after: { account_kind: 'NRE' },
          at: '2026-10-20T08:00:00Z',
        },
        {
          actor: null,
          table_name: 'observations',
          row_id: 'o',
          action: 'INSERT',
          before: null,
          after: { amount: 100, currency: 'INR', as_of: '2026-10-25', source: 'email' },
          at: '2026-10-25T08:00:00Z',
        },
        {
          actor: 'other',
          table_name: 'assets',
          row_id: 'a',
          action: 'UPDATE',
          before: { notes: 'a' },
          after: { notes: 'b' },
          at: '2026-10-10T08:00:00Z',
        },
      ],
      inbox: [
        {
          received_on: '2026-10-25',
          created_at: '2026-10-25T09:00:00Z',
          from_domain: 'hdfcbank.bank.in',
          subject: 'Balance',
          outcome: 'applied',
          reason: null,
        },
      ],
    });
    expect(items.map((x) => x.who)).toEqual([
      'Bank e-mail reader',
      'Automatic job',
      'You',
      'A family member',
    ]);
    expect(items[2]!.changes[0]).toEqual({ label: 'Account type', before: null, after: 'NRE' });
  });
});

describe('bankHistory', () => {
  it('adds accounts together, carrying the last known value forward, plus running deposits', () => {
    const h = bankHistory({
      today: '2026-10-26',
      cash: [
        { assetId: 'a', as_of: '2026-07-31', value: 100_000 },
        { assetId: 'a', as_of: '2026-09-15', value: 150_000 },
        { assetId: 'b', as_of: '2026-08-31', value: 50_000 },
      ],
      deposits: [
        {
          principal: 1_000_000,
          rate: 0.07,
          booked_on: '2026-08-01',
          maturity_on: '2027-08-01',
          compounding: 'quarterly',
          counted: true,
        },
      ],
    });
    expect(h[0]).toEqual({ date: '2026-07-31', value: 100_000 });
    const sep = h.find((p) => p.date >= '2026-09-30')!;
    expect(sep.value).toBeGreaterThan(1_200_000);
    expect(bankHistory({ today: '2026-10-26', cash: [], deposits: [] })).toEqual([]);
  });
});

describe('observationsTable: change and links', () => {
  const mk = (id: string, as_of: string, amount: number, superseded_by: string | null = null) => ({
    id,
    amount,
    currency: 'INR',
    fx_rate: null,
    as_of,
    confidence: 'verified',
    source: 'email',
    note: null,
    created_at: `${as_of}T10:00:00Z`,
    superseded_by,
  });
  it('shows the change from the reading before and links each row to its own page', () => {
    const t = observationsTable(
      [mk('a', '2026-08-31', 1000), mk('b', '2026-09-30', 1500), mk('c', '2026-10-25', 1200)],
      'asset-1',
    );
    expect(t.rows.map((r) => r.cells[3])).toEqual(['−₹300', '+₹500', '–']);
    expect(t.rows[0]!.href).toBe('/asset/asset-1/reading/c');
  });
  it('skips replaced readings when working out the change', () => {
    const t = observationsTable(
      [mk('a', '2026-08-31', 1000), mk('b', '2026-09-30', 9999, 'c'), mk('c', '2026-09-30', 1100)],
      'x',
    );
    expect(t.rows.find((r) => r.href?.endsWith('/c'))!.cells[3]).toBe('+₹100');
  });
});
