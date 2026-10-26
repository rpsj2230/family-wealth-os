import { describe, expect, it } from 'vitest';
import {
  bankStanding,
  previousFy,
  buildBankBlocks,
  buildPortfolio,
  rowState,
  standings,
  summarizeStandings,
  type AssetRow,
  type FdRow,
  type ObservationRow,
} from '../src';

const TODAY = new Date('2026-10-26T00:00:00Z');
const asset = (o: Partial<AssetRow> & { id: string }): AssetRow => ({
  owner_id: 'p1',
  institution_id: 'b1',
  type: 'bank_account',
  status: 'active',
  nickname: 'Cash',
  currency: 'INR',
  account_kind: 'NRE',
  expected_freshness_days: 35,
  ...o,
});
const obs = (asset_id: string, amount: number, as_of: string, source: string): ObservationRow => ({
  id: `o-${asset_id}-${as_of}`,
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

function build(assets: AssetRow[], observations: ObservationRow[], fds: FdRow[] = []) {
  const portfolio = buildPortfolio(assets, observations, fds, TODAY);
  return buildBankBlocks({
    assets,
    observations,
    fds,
    portfolio,
    institutionNames: { b1: 'Sample Bank', b2: 'Other Bank' },
    today: TODAY,
  });
}

describe('bank standing', () => {
  it('is current when every balance is dated this month, and says how each arrived', () => {
    const blocks = build(
      [asset({ id: 'a' }), asset({ id: 'b', owner_id: 'p2' })],
      [obs('a', 100, '2026-10-20', 'email'), obs('b', 200, '2026-10-22', 'manual')],
    );
    const s = bankStanding(blocks[0]!, '2026-10-26');
    expect(s.state).toBe('current');
    expect(s.balances).toBe(2);
    expect(s.current).toBe(2);
    expect(s.lastUpdated).toBe('2026-10-22');
    expect(s.lastSource?.kind).toBe('manual');
    expect(s.mix.map((m) => [m.word, m.count]).sort()).toEqual([
      ['Email', 1],
      ['You', 1],
    ]);
  });

  it('waits when a balance is from an earlier month, and names the line', () => {
    const blocks = build(
      [asset({ id: 'a' }), asset({ id: 'b', owner_id: 'p2' })],
      [obs('a', 100, '2026-10-20', 'email'), obs('b', 200, '2026-09-30', 'manual')],
    );
    const s = bankStanding(blocks[0]!, '2026-10-26');
    expect(s.state).toBe('waiting');
    expect(s.waiting).toBe(1);
    expect(s.waitingCodes).toHaveLength(1);
  });

  it('needs attention when a balance has no value or a matured deposit is unconfirmed', () => {
    const blocks = build([asset({ id: 'a' })], []);
    expect(bankStanding(blocks[0]!, '2026-10-26').state).toBe('attention');
    expect(bankStanding(blocks[0]!, '2026-10-26').missing).toBe(1);

    const fd = {
      asset_id: 'f',
      principal: 100000,
      rate: 0.07,
      booked_on: '2025-10-01',
      maturity_on: '2026-10-05',
      compounding: 'quarterly',
      bank_maturity_amount: null,
    } as FdRow;
    const blocks2 = build(
      [asset({ id: 'a' }), asset({ id: 'f', type: 'fixed_deposit', account_kind: null })],
      [obs('a', 5, '2026-10-20', 'manual')],
      [fd],
    );
    const s = bankStanding(blocks2[0]!, '2026-10-26');
    expect(s.depositsToConfirm).toBe(1);
    expect(s.deposits).toBe(1);
    expect(s.state).toBe('attention');
  });

  it('leaves closed accounts out and never asks a deposit for a typed value', () => {
    const blocks = build(
      [asset({ id: 'a' }), asset({ id: 'c', status: 'closed', owner_id: 'p2' })],
      [obs('a', 1, '2026-10-20', 'workbook'), obs('c', 1, '2026-01-01', 'manual')],
    );
    const s = bankStanding(blocks[0]!, '2026-10-26');
    expect(s.balances).toBe(1);
    expect(s.state).toBe('current');
    const row = blocks[0]!.sections.flatMap((x) => x.rows).find((r) => r.assetId === 'c')!;
    expect(rowState(row, '2026-10-26')).toBe('closed');
  });

  it('summarizes banks and sources together', () => {
    const blocks = build(
      [asset({ id: 'a' }), asset({ id: 'b', institution_id: 'b2' })],
      [obs('a', 100, '2026-10-20', 'email'), obs('b', 200, '2026-08-01', 'manual')],
    );
    const sum = summarizeStandings(standings(blocks, '2026-10-26'));
    expect(sum.banks).toBe(2);
    expect(sum.current).toBe(1);
    expect(sum.balances).toBe(2);
    expect(sum.balancesCurrent).toBe(1);
    expect(sum.newestUpdate).toBe('2026-10-20');
  });
});

describe('previousFy', () => {
  it('steps back one financial year', () => {
    expect(previousFy('2026-27')).toBe('2025-26');
    expect(previousFy('2000-01')).toBe('1999-00');
    expect(previousFy('nonsense')).toBe('nonsense');
  });
});
