import { describe, expect, it } from 'vitest';
import type { AssetRow } from '@fwos/core';
import { demoModel } from './demo-fixture';
import { buildSyncAssets, type SyncSource } from './sheet-sync-assets';
import type { ForeignLine } from './accounts-summary';
import type { LoanLine } from './others-summary';

const asset = (o: Partial<AssetRow> & Pick<AssetRow, 'id' | 'type'>): AssetRow => ({
  owner_id: 'p1',
  status: 'active',
  nickname: 'x',
  currency: 'INR',
  account_kind: null,
  expected_freshness_days: 35,
  ...o,
});

function source(over: Partial<SyncSource> = {}): SyncSource {
  const m = demoModel();
  return {
    assets: m.assets,
    blocks: m.blocks,
    fundValue: new Map(),
    positions: [],
    loans: [],
    foreign: [],
    ownerName: new Map(m.people.map((p) => [p.id, p.name])),
    institutionName: m.institutionNames,
    ...over,
  };
}

describe('the accounts handed to the sheet sync', () => {
  it('gives each savings account the balance Accounts shows and each deposit its terms and maturity amount', () => {
    const src = source();
    const out = buildSyncAssets(src);
    const rows = new Map(
      src.blocks.flatMap((b) => b.sections.flatMap((s) => s.rows)).map((r) => [r.assetId, r]),
    );
    const cash = out.filter((a) => a.kind === 'cash');
    const fds = out.filter((a) => a.kind === 'fd');
    expect(cash.length).toBeGreaterThan(10);
    expect(fds.length).toBeGreaterThan(5);
    for (const a of cash) expect(a.value).toBe(rows.get(a.id)!.current);
    for (const a of fds) {
      const fd = rows.get(a.id)!.fd!;
      expect(a.fd).toMatchObject({
        principal: fd.principal,
        rate: fd.rate,
        bookedOn: fd.bookedOn,
        maturityOn: fd.maturityOn,
        maturityAmount: fd.maturityAmount,
        ref: fd.ref,
      });
    }
    // the deposit number is passed in full; nothing else about an account number is
    expect(fds.some((a) => /^30001779\d+-1$/.test(a.fd!.ref ?? ''))).toBe(true);
  });

  it('names people and banks, and says whether an account is NRE or NRO', () => {
    const out = buildSyncAssets(source());
    const first = out.find((a) => a.kind === 'cash')!;
    expect(first.owner).toMatch(/^(Anil|Beena|Chaya|Dev)$/);
    expect(first.institution).toMatch(/^Sample /);
    expect(['NRE', 'NRO']).toContain(first.accountKind);
    expect(first.last4).toMatch(/^\d{4}$/);
  });

  it('takes the last four digits from the sheet’s own line when the asset has one', () => {
    const a = asset({
      id: 'a',
      type: 'bank_account',
      label: 'Cash-NRO JO-0266',
      identifier_last4: '9999',
    });
    const out = buildSyncAssets(source({ assets: [a], blocks: [] }));
    expect(out[0]).toMatchObject({ kind: 'cash', label: 'Cash-NRO JO-0266', last4: '0266' });
  });

  it('funds: the value the app shows, the amount put in, the start date and whether the plan is stopped', () => {
    const a = asset({
      id: 'f',
      type: 'mutual_fund',
      label: 'Alpha Fund',
      nickname: 'Alpha Fund #45',
      status: 'stopped',
    });
    const out = buildSyncAssets(
      source({
        assets: [a],
        blocks: [],
        fundValue: new Map([['f', 123_456.78]]),
        positions: [
          {
            asset_id: 'f',
            fund_name: 'Alpha Fund Direct',
            invested: 100_000,
            started_on: '2024-01-02',
            sip_stopped: false,
          },
        ],
      }),
    );
    expect(out[0]).toMatchObject({
      kind: 'fund',
      value: 123_456.78,
      names: ['Alpha Fund', 'Alpha Fund Direct', 'Alpha Fund #45'],
      fund: { invested: 100_000, startedOn: '2024-01-02', stopped: true },
    });
  });

  it('loans: what is still owed, nothing for a settled one, and a gift is treated as closed', () => {
    const line = (assetId: string, outstanding: number, status: LoanLine['status']): LoanLine => ({
      assetId,
      counterparty: `Friend ${assetId}`,
      ownerId: 'p1',
      lent: 100,
      lentOn: '2025-06-20',
      expectedOn: null,
      repayments: [],
      repaid: 0,
      outstanding,
      status,
      daysOverdue: 0,
      daysToExpected: null,
    });
    const assets = ['a', 'b', 'c'].map((id) => asset({ id, type: 'receivable' }));
    const out = buildSyncAssets(
      source({
        assets,
        blocks: [],
        loans: [line('a', 70, 'outstanding'), line('b', 0, 'settled'), line('c', 100, 'gift')],
      }),
    );
    expect(out.map((x) => [x.value, x.status])).toEqual([
      [70, 'active'],
      [0, 'active'],
      [100, 'gifted'],
    ]);
    expect(out[0]!.loan).toEqual({ counterparty: 'Friend a', lentOn: '2025-06-20' });
  });

  it('a Singapore balance: the rupee value, the S$ amount and the rate used today', () => {
    const a = asset({ id: 's', type: 'bank_account', currency: 'SGD', institution_id: 'eq' });
    const f: ForeignLine = {
      assetId: 's',
      ownerId: 'p1',
      name: 'x',
      currency: 'SGD',
      amount: 100,
      asOf: '2026-10-01',
      rate: 74.26,
      rateDate: '2026-10-25',
      inr: 7426,
    };
    const out = buildSyncAssets(source({ assets: [a], blocks: [], foreign: [f] }));
    expect(out[0]).toMatchObject({
      kind: 'cash_sg',
      value: 7426,
      foreign: { amount: 100, rate: 74.26 },
    });
  });

  it('leaves out what has no line in the sheet (property, policies)', () => {
    const out = buildSyncAssets(
      source({
        assets: [asset({ id: 'h', type: 'property' }), asset({ id: 'p', type: 'policy' })],
        blocks: [],
      }),
    );
    expect(out).toEqual([]);
  });
});
