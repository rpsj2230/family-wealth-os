import { describe, expect, it } from 'vitest';
import type { BankBlock, BankRow } from '../src/accounts-view';
import { OTHER_HOLDINGS_KEY } from '../src/accounts-view';
import { cashBlocks, cashByBank, largestCash } from '../src/cash-view';

const cash = (id: string, current: number, o: Partial<BankRow> = {}): BankRow =>
  ({
    assetId: id,
    kind: 'cash',
    code: `Cash-${id}`,
    ownerId: 'p',
    status: 'active',
    currency: 'INR',
    current,
    recorded: current,
    asOf: '2026-10-01',
    stale: false,
    fd: null,
    ...o,
  }) as unknown as BankRow;
const fd = (id: string): BankRow =>
  ({
    assetId: id,
    kind: 'fd',
    status: 'active',
    currency: 'INR',
    current: 900,
    fd: { principal: 800, maturityAmount: 1000, needsConfirmation: false },
  }) as unknown as BankRow;
const block = (key: string, name: string, rows: BankRow[]): BankBlock =>
  ({ key, name, sections: [{ ownerId: 'p', rows }] }) as unknown as BankBlock;

const blocks = [
  block('a', 'Bank A', [
    cash('1', 100_000),
    cash('2', 300_000, { stale: true, asOf: '2026-08-01' }),
    fd('f'),
  ]),
  block('b', 'Bank B', [cash('3', 100_000), cash('x', 5_000, { status: 'closed' })]),
  block('c', 'Bank C', [fd('g')]),
  block(OTHER_HOLDINGS_KEY, 'Other holdings', [cash('h', 9_999)]),
];

describe('cashBlocks', () => {
  it('keeps savings accounts of real banks only', () => {
    const r = cashBlocks(blocks);
    expect(r.map((b) => b.name)).toEqual(['Bank A', 'Bank B']);
    expect(r[0]!.sections[0]!.rows.map((x) => x.assetId)).toEqual(['1', '2']);
  });
});

describe('cashByBank', () => {
  const r = cashByBank(cashBlocks(blocks), { '1': 0.04, '2': 0.02, '3': 0.07 }, 0.1, 0.03);
  it('ranks banks by balance, leaves out closed accounts and works out shares', () => {
    expect(r.map((x) => x.bank)).toEqual(['Bank A', 'Bank B']);
    expect(r[0]).toMatchObject({ count: 2, balance: 400_000, stale: 1, oldest: '2026-08-01' });
    expect(r[0]!.share).toBeCloseTo(0.8, 8);
  });
  it('weights the rate by balance and takes tax at source off the interest', () => {
    expect(r[0]!.avgRate).toBeCloseTo((100_000 * 0.04 + 300_000 * 0.02) / 400_000, 8);
    expect(r[0]!.interestYear).toBeCloseTo((100_000 * 0.04 + 300_000 * 0.02) * 0.9, 6);
  });
  it('uses the default rate for an account with none', () => {
    const d = cashByBank(cashBlocks(blocks), {}, 0, 0.03);
    expect(d[1]!.interestYear).toBeCloseTo(100_000 * 0.03, 6);
  });
});

describe('largestCash', () => {
  it('finds the biggest counted balance', () => {
    expect(largestCash(cashBlocks(blocks))).toEqual({
      code: 'Cash-2',
      bank: 'Bank A',
      amount: 300_000,
    });
  });
});
