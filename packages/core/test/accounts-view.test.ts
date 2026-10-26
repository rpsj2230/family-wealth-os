import { describe, expect, it } from 'vitest';
import {
  buildBankBlocks,
  filterBlocksByOwner,
  personStyles,
  rowCode,
  sourceTag,
} from '../src/accounts-view';
import { buildPortfolio, type AssetRow, type FdRow, type ObservationRow } from '../src/portfolio';

const today = new Date('2026-10-26T00:00:00Z');
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'r',
  type: 'bank_account',
  status: 'active',
  nickname: o.id,
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  institution_id: 'eq',
  ...o,
});
const obs = (o: Partial<ObservationRow> & { id: string; asset_id: string }): ObservationRow => ({
  kind: 'balance',
  amount: 100_000,
  currency: 'INR',
  fx_rate: null,
  as_of: '2026-10-20',
  confidence: 'manual_confirmed',
  source: 'manual',
  created_at: '2026-10-20T00:00:00Z',
  superseded_by: null,
  ...o,
});
const fd = (id: string, o: Partial<FdRow> = {}): FdRow => ({
  asset_id: id,
  principal: 500_000,
  rate: 0.08,
  booked_on: '2026-09-14',
  maturity_on: '2029-09-15',
  compounding: 'quarterly',
  bank_maturity_amount: 634_399,
  ...o,
});

// Equitas, Rupash's section as it is in the sheet, then Ragini's; and a Yes Bank section that comes first in the sheet
const assets: AssetRow[] = [
  asset({
    id: 'y-fd',
    institution_id: 'yb',
    type: 'fixed_deposit',
    account_kind: null,
    sort_order: 3,
  }),
  asset({ id: 'y-cash', institution_id: 'yb', sort_order: 5, label: 'Cash' }),
  asset({
    id: 'e-fd1',
    type: 'fixed_deposit',
    label: 'FD-NRE-3333',
    linked_last4: '3333',
    sort_order: 23,
  }),
  asset({
    id: 'e-fd2',
    type: 'fixed_deposit',
    label: 'FD-NRE JO-1111',
    is_joint: true,
    linked_last4: '1111',
    sort_order: 24,
    notes: 'FD Number : …6666',
  }),
  asset({
    id: 'e-nro',
    label: 'Cash-NRO JO-2222 (NRO SIP)',
    account_kind: 'NRO',
    is_joint: true,
    identifier_last4: '2222',
    sort_order: 25,
  }),
  asset({
    id: 'e-jo',
    label: 'Cash-NRE JO-1111',
    is_joint: true,
    identifier_last4: '1111',
    sort_order: 26,
  }),
  asset({
    id: 'e-3333',
    label: 'Cash-NRE-3333',
    identifier_last4: '3333',
    sort_order: 27,
    notes: 'Lounge Card (4)',
  }),
  asset({
    id: 'g-cash',
    owner_id: 'g',
    label: 'Cash-NRE',
    identifier_last4: '4444',
    sort_order: 32,
  }),
];
const observations = [
  obs({ id: '1', asset_id: 'y-cash', amount: 2.53 }),
  obs({ id: '2', asset_id: 'e-nro', amount: 397_540 }),
  obs({ id: '3', asset_id: 'e-jo', amount: 0 }),
  obs({ id: '4', asset_id: 'e-3333', amount: 0.44, as_of: '2026-09-01' }),
  obs({ id: '5', asset_id: 'g-cash', amount: 106, source: 'email' }),
];
const fds = [
  fd('y-fd', {
    principal: 1_000_000,
    rate: 0.065,
    booked_on: '2021-11-01',
    maturity_on: '2026-12-01',
    bank_maturity_amount: 1_380_416,
  }),
  fd('e-fd1', { fd_ref_last4: '5555' }),
  fd('e-fd2', { fd_ref_last4: '6666', bank_maturity_amount: null }),
];
const portfolio = buildPortfolio(assets, observations, fds, today);
const blocks = buildBankBlocks({
  assets,
  observations,
  fds,
  portfolio,
  institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
  today,
});

describe('buildBankBlocks', () => {
  it('follows your sheet: banks and rows in sheet order, a section per person', () => {
    expect(blocks.map((b) => b.name)).toEqual(['Yes Bank', 'Equitas']);
    const eq = blocks[1]!;
    expect(eq.sections.map((s) => s.ownerId)).toEqual(['r', 'g']);
    expect(eq.sections[0]!.rows.map((r) => r.assetId)).toEqual([
      'e-fd1',
      'e-fd2',
      'e-nro',
      'e-jo',
      'e-3333',
    ]);
  });

  it('writes each row the way you do: kind, JO, last four digits and the bracket note', () => {
    const codes = Object.fromEntries(blocks[1]!.sections[0]!.rows.map((r) => [r.assetId, r.code]));
    expect(codes).toEqual({
      'e-fd1': 'FD-NRE-3333',
      'e-fd2': 'FD-NRE JO-1111',
      'e-nro': 'Cash-NRO JO-2222 (NRO SIP)',
      'e-jo': 'Cash-NRE JO-1111',
      'e-3333': 'Cash-NRE-3333',
    });
  });

  it('links each deposit to its savings account by the last four digits', () => {
    const rows = blocks[1]!.sections[0]!.rows;
    expect(rows.find((r) => r.assetId === 'e-fd1')!.fd!.linkedTo).toBe('Cash-NRE-3333');
    expect(rows.find((r) => r.assetId === 'e-fd2')!.fd!.linkedTo).toBe('Cash-NRE JO-1111');
  });

  it('shows invested, amount at maturity and today’s value for each deposit; the bank’s own maturity figure wins', () => {
    const f1 = blocks[1]!.sections[0]!.rows[0]!;
    expect(f1.fd).toMatchObject({
      principal: 500_000,
      rate: 0.08,
      maturityAmount: 634_399,
      maturityAmountFromBank: true,
      refLast4: '5555',
    });
    expect(f1.current!).toBeGreaterThan(500_000);
    expect(f1.current!).toBeLessThan(634_399);
    const f2 = blocks[1]!.sections[0]!.rows[1]!;
    expect(f2.fd!.maturityAmountFromBank).toBe(false);
    expect(f2.fd!.maturityAmount).toBeGreaterThan(f2.fd!.principal); // worked out from the terms when the bank figure is missing
  });

  it('totals the deposits (invested, at maturity, today) and the savings per person and per bank', () => {
    const rupash = blocks[1]!.sections[0]!.totals;
    expect(rupash.fdInvested).toBe(1_000_000);
    expect(rupash.fdMaturity).toBe(634_399 + blocks[1]!.sections[0]!.rows[1]!.fd!.maturityAmount);
    // recorded 397,540.44 plus a few days of assumed savings interest
    expect(rupash.cash).toBeGreaterThan(397_540.44);
    expect(rupash.cash).toBeLessThan(398_000);
    expect(blocks[1]!.totals.current).toBeCloseTo(
      rupash.current + blocks[1]!.sections[1]!.totals.current,
      2,
    );
  });

  it('gives a deposit without NRE/NRO the kind of its section’s savings account, and says it was inferred', () => {
    const yfd = blocks[0]!.sections[0]!.rows[0]!;
    expect(yfd.accountKind).toBe('NRE');
    expect(yfd.kindInferred).toBe(true);
  });

  it('keeps the notes of each row (AMB, lounge cards, FD numbers)', () => {
    const rows = blocks[1]!.sections[0]!.rows;
    expect(rows.find((r) => r.assetId === 'e-3333')!.notes).toBe('Lounge Card (4)');
  });

  it('marks a bank done for the month only when every balance is dated this month', () => {
    expect(blocks[0]!.doneThisMonth).toBe(true);
    expect(blocks[1]!.doneThisMonth).toBe(false); // e-3333 is from September
  });

  it('puts a row added later after the rows it belongs with', () => {
    const more = [
      ...assets,
      asset({ id: 'e-new', type: 'fixed_deposit', label: 'FD-NRE-3333', sort_order: 23.001 }),
    ];
    const f = [...fds, fd('e-new')];
    const pf = buildPortfolio(more, observations, f, today);
    const b = buildBankBlocks({
      assets: more,
      observations,
      fds: f,
      portfolio: pf,
      institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
      today,
    });
    expect(b[1]!.sections[0]!.rows.slice(0, 3).map((r) => r.assetId)).toEqual([
      'e-fd1',
      'e-new',
      'e-fd2',
    ]);
  });

  it('flags a matured deposit that has not been confirmed and leaves it out of totals', () => {
    const f = [fd('y-fd', { maturity_on: '2026-10-01', booked_on: '2021-10-01' }), ...fds.slice(1)];
    const pf = buildPortfolio(assets, observations, f, today);
    const b = buildBankBlocks({
      assets,
      observations,
      fds: f,
      portfolio: pf,
      institutionNames: { eq: 'Equitas', yb: 'Yes Bank' },
      today,
    });
    expect(b[0]!.sections[0]!.rows[0]!.fd!.needsConfirmation).toBe(true);
    expect(b[0]!.needsYou).toBe(1);
    expect(b[0]!.totals.fdInvested).toBe(0);
  });

  it('can show one person only, with totals worked out again', () => {
    const g = filterBlocksByOwner(blocks, 'g');
    expect(g.map((b) => b.name)).toEqual(['Equitas']);
    expect(g[0]!.totals.cash).toBeGreaterThanOrEqual(106);
    expect(g[0]!.totals.cash).toBeLessThan(107);
  });
});

describe('helpers', () => {
  it('rowCode drops what is not known', () => {
    expect(
      rowCode({
        type: 'fixed_deposit',
        label: 'FD',
        kind: null,
        joint: false,
        last4: null,
        currency: 'INR',
      }),
    ).toBe('FD');
    expect(
      rowCode({
        type: 'bank_account',
        label: 'Cash',
        kind: 'NRO',
        joint: false,
        last4: '1234',
        currency: 'INR',
      }),
    ).toBe('Cash-NRO-1234');
    expect(
      rowCode({
        type: 'bank_account',
        label: 'Cash',
        kind: null,
        joint: false,
        last4: null,
        currency: 'SGD',
      }),
    ).toBe('Cash SGD');
  });
  it('tags where each figure came from', () => {
    expect(sourceTag('email', '2026-10-25', false)).toEqual({
      label: 'Email, 25 Oct',
      kind: 'auto',
    });
    expect(sourceTag('manual', '2026-10-12', false).label).toBe('You, 12 Oct');
    expect(sourceTag(null, null, false).kind).toBe('none');
    expect(sourceTag('manual', '2026-10-12', true).kind).toBe('calc');
  });
  it('gives each person a distinct colour and an initial', () => {
    const s = personStyles([
      { id: 'a', name: 'Rupash' },
      { id: 'b', name: 'Ragini' },
      { id: 'c', name: 'Advika' },
      { id: 'd', name: 'Viraj' },
    ]);
    expect(new Set(Object.values(s).map((p) => p.colour)).size).toBe(4);
    expect(s.c!.initial).toBe('A');
  });
});

describe('bankStyle', () => {
  it('gives known banks their own colour and any bank a stable one', async () => {
    const { bankStyle } = await import('../src/accounts-view');
    expect(bankStyle('HDFC Bank').colour).toBe('#004c8f');
    expect(bankStyle('Yes Bank').abbr).toBe('YE');
    expect(bankStyle('Sample Jan Bank')).toEqual(bankStyle('Sample Jan Bank'));
    expect(bankStyle('Some Local Co-op').colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(bankStyle('IDFC First').abbr).toBe('IF');
    expect(bankStyle('IDFC').abbr).toBe('ID');
    expect(bankStyle('RBL Bank').abbr).toBe('RB');
  });
});
