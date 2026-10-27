import { carryForward, estimateFd, type FdRow, type ValuedAsset } from '@fwos/core';
import { describe, expect, it } from 'vitest';
import { buildDeposits, type DepositAsset } from './deposits';

const d = (s: string) => new Date(`${s}T00:00:00Z`);
const today = d('2026-10-26');
const banks = new Map([
  ['esaf', 'ESAF'],
  ['yes', 'Yes Bank'],
]);
const owners = new Map([
  ['r', 'Rupash'],
  ['g', 'Ragini'],
]);

const fd = (
  id: string,
  bank: string,
  owner: string,
  kind: string,
  principal: number,
  rate: number,
  from: string,
  to: string,
  bankMat: number | null = null,
  status = 'active',
) => {
  const asset: DepositAsset = {
    id,
    ownerId: owner,
    institutionId: bank,
    type: 'fixed_deposit',
    status,
    nickname: id,
    accountKind: kind,
  };
  const row: FdRow = {
    asset_id: id,
    principal,
    rate,
    booked_on: from,
    maturity_on: to,
    compounding: 'quarterly',
    bank_maturity_amount: bankMat,
  };
  const valued: ValuedAsset = {
    assetId: id,
    ownerId: owner,
    type: 'fixed_deposit',
    status,
    name: id,
    estimate: estimateFd({
      principal,
      annualRate: rate,
      bookedOn: d(from),
      today,
      maturityOn: d(to),
    }),
  };
  return { asset, row, valued };
};

describe('buildDeposits', () => {
  const a = fd('a', 'esaf', 'r', 'NRE', 1_000_000, 0.08, '2026-09-08', '2028-11-16', 1_189_427);
  const b = fd('b', 'esaf', 'r', 'NRO', 500_000, 0.076, '2025-10-28', '2027-01-15', 547_892);
  const c = fd('c', 'esaf', 'r', 'joint', 500_000, 0.08, '2026-09-08', '2028-11-15', 594_714);
  const y = fd('y', 'yes', 'r', 'NRE', 1_000_000, 0.065, '2021-11-01', '2026-11-01', 1_380_416);
  const matured = fd(
    'm',
    'yes',
    'g',
    'NRE',
    500_000,
    0.0775,
    '2025-05-12',
    '2026-09-23',
    555_463,
    'matured_unconfirmed',
  );
  const all = [a, b, c, y, matured];
  const view = buildDeposits(
    all.map((x) => x.asset),
    all.map((x) => x.valued),
    all.map((x) => x.row),
    banks,
    owners,
    today,
    500_000,
  );

  it('lists FDs soonest-first with days left and the check against the bank figure', () => {
    expect(view.fds.map((f) => f.id)).toEqual(['m', 'y', 'b', 'c', 'a']);
    expect(view.fds.find((f) => f.id === 'y')!.daysLeft).toBe(6);
    expect(Math.abs(view.fds.find((f) => f.id === 'a')!.varianceVsBankPct!)).toBeLessThan(0.05);
  });

  it('aggregates single-name NRE and NRO FDs at one bank, and keeps the joint FD separate', () => {
    const esaf = view.cover.rows.filter((r) => r.bankId === 'esaf');
    expect(esaf).toHaveLength(2);
    const single = esaf.find((r) => r.capacityKey === 'single:r')!;
    expect(single.depositIds.sort()).toEqual(['a', 'b']);
    expect(single.insured).toBe(500_000);
    expect(single.uninsured).toBeGreaterThan(1_000_000); // 15 L principal + interest - 5 L
    expect(esaf.find((r) => r.capacityKey === 'joint:r+?')!.insured).toBe(500_000);
  });

  it('counts running deposits only: one past its date is not counted towards the limit, and the assumptions are stated', () => {
    // once a deposit has matured its money is in a savings account or a new deposit, which are counted on their own
    expect(view.cover.rows.some((r) => r.depositIds.includes('m'))).toBe(false);
    expect(view.cover.assumptions.join(' ')).toMatch(/added together/i);
    expect(view.cover.assumptions.join(' ')).toMatch(/ownership name/i);
    expect(view.cover.assumptions.join(' ')).toMatch(/no second name/i);
  });

  it('leaves a deposit that is still marked active but past its date out of the cover, and keeps one maturing today', () => {
    const late = fd('late', 'yes', 'g', 'NRE', 400_000, 0.07, '2025-01-01', '2026-10-25');
    const todayFd = fd('today', 'yes', 'g', 'NRE', 300_000, 0.07, '2025-10-26', '2026-10-26');
    const set = [late, todayFd];
    const v = buildDeposits(
      set.map((x) => x.asset),
      set.map((x) => x.valued),
      set.map((x) => x.row),
      banks,
      owners,
      today,
      500_000,
    );
    const ids = v.cover.rows.flatMap((r) => r.depositIds);
    expect(ids).toContain('today');
    expect(ids).not.toContain('late');
    // both are listed, the late one flagged to confirm
    expect(v.fds.find((f) => f.id === 'late')!.listState).toBe('confirm');
    expect(v.fds.find((f) => f.id === 'today')!.listState).toBe('show');
  });

  it('builds a maturity calendar of active FDs by month, excluding matured-unconfirmed ones', () => {
    expect(view.byMonth.map((m) => m.month)).toEqual(['2026-11', '2027-01', '2028-11']);
    expect(view.byMonth[0]!.total).toBe(1_380_416);
    expect(view.byMonth[2]!.items).toHaveLength(2);
  });

  it('includes bank balances in the cover calculation (they are deposits too)', () => {
    const cash: DepositAsset = {
      id: 'cash',
      ownerId: 'r',
      institutionId: 'yes',
      type: 'bank_account',
      status: 'active',
      nickname: 'cash',
      accountKind: 'NRE',
    };
    const cv: ValuedAsset = {
      assetId: 'cash',
      ownerId: 'r',
      type: 'bank_account',
      status: 'active',
      name: 'cash',
      estimate: carryForward({ amount: 200_000, asOf: today, today }),
    };
    const v = buildDeposits(
      [...all.map((x) => x.asset), cash],
      [...all.map((x) => x.valued), cv],
      all.map((x) => x.row),
      banks,
      owners,
      today,
      500_000,
    );
    expect(
      v.cover.rows.find((r) => r.bankId === 'yes' && r.capacityKey === 'single:r')!.total,
    ).toBeGreaterThan(1_200_000);
  });

  it('insures each ownership name separately, and the order of joint names matters', () => {
    const mk = (
      id: string,
      owner: string,
      joint: boolean,
      holder: string | null,
    ): DepositAsset => ({
      id,
      ownerId: owner,
      institutionId: 'esaf',
      type: 'bank_account',
      status: 'active',
      nickname: id,
      accountKind: null,
      isJoint: joint,
      jointHolderId: holder,
    });
    const assets = [
      mk('1', 'r', false, null),
      mk('2', 'g', false, null),
      mk('3', 'r', true, 'g'),
      mk('4', 'g', true, 'r'),
    ];
    const valued = assets.map((a) => ({
      assetId: a.id,
      ownerId: a.ownerId,
      type: 'bank_account' as const,
      status: 'active',
      name: a.id,
      estimate: { estimatedAmount: 800_000 } as ValuedAsset['estimate'],
    }));
    const v = buildDeposits(
      assets,
      valued,
      [],
      new Map([['esaf', 'Esaf']]),
      new Map([
        ['r', 'Rupash'],
        ['g', 'Ragini'],
      ]),
      new Date('2026-10-26T00:00:00Z'),
      500_000,
    );
    expect(v.cover.rows).toHaveLength(4);
    expect(v.cover.insured).toBe(2_000_000);
    expect(v.cover.uninsured).toBe(1_200_000);
  });
});

describe('foreign banks are left out of the insurance cover', () => {
  it('does not count money at a bank marked as outside the Indian scheme, and says so', () => {
    const a = fd('a', 'esaf', 'r', 'NRE', 1_000_000, 0.08, '2026-09-08', '2028-11-16');
    const x = fd('x', 'uob', 'r', 'NRE', 3_000_000, 0.04, '2026-01-08', '2028-01-16');
    const names = new Map([...banks, ['uob', 'UOB']]);
    const all = [a, x];
    const run = (outside: Set<string>) =>
      buildDeposits(
        all.map((i) => i.asset),
        all.map((i) => i.valued),
        all.map((i) => i.row),
        names,
        owners,
        today,
        500_000,
        outside,
      );
    const counted = run(new Set());
    expect(Object.keys(counted.cover.byBank).sort()).toEqual(['esaf', 'uob']);
    const left = run(new Set(['uob']));
    expect(Object.keys(left.cover.byBank)).toEqual(['esaf']);
    expect(left.cover.uninsured).toBeLessThan(counted.cover.uninsured);
    expect(left.cover.assumptions.join(' ')).toContain('UOB');
    // the deposit itself is still listed everywhere else
    expect(left.fds).toHaveLength(2);
  });
});
