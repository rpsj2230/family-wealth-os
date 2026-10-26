import { describe, expect, it } from 'vitest';
import type { BankBlock, BankRow } from '../src/accounts-view';
import { depositsByBank, maturityLadder } from '../src/deposit-views';

const fd = (
  id: string,
  principal: number,
  current: number,
  maturityAmount: number,
  rate: number,
  maturityOn: string,
  o: { status?: string; needsConfirmation?: boolean } = {},
): BankRow =>
  ({
    assetId: id,
    kind: 'fd',
    ownerId: 'p',
    status: o.status ?? 'active',
    current,
    fd: {
      principal,
      rate,
      bookedOn: '2025-01-01',
      maturityOn,
      daysLeft: 100,
      maturityAmount,
      maturityAmountFromBank: true,
      refLast4: null,
      ref: null,
      linkedTo: null,
      needsConfirmation: o.needsConfirmation ?? false,
    },
  }) as unknown as BankRow;

const block = (key: string, name: string, rows: BankRow[]): BankBlock =>
  ({ key, name, sections: [{ ownerId: 'p', rows }] }) as unknown as BankBlock;

const blocks = [
  block('a', 'Bank A', [
    fd('1', 100, 110, 130, 0.07, '2027-03-01'),
    fd('2', 300, 330, 400, 0.08, '2027-11-01'),
    fd('x', 50, 55, 60, 0.07, '2026-09-01', { needsConfirmation: true }),
  ]),
  block('b', 'Bank B', [
    fd('3', 200, 210, 250, 0.09, '2028-02-01'),
    fd('c', 10, 10, 10, 0.05, '2028-02-01', { status: 'closed' }),
  ]),
  block('c', 'Bank C', []),
];

describe('depositsByBank', () => {
  const r = depositsByBank(blocks, '2026-10-26');
  it('ranks banks by value and leaves out banks without running deposits', () => {
    expect(r.map((x) => x.bank)).toEqual(['Bank A', 'Bank B']);
  });
  it('adds up each bank and works out its share and weighted rate', () => {
    expect(r[0]).toMatchObject({ count: 2, invested: 400, current: 440, maturity: 530 });
    expect(r[0]!.avgRate).toBeCloseTo((100 * 0.07 + 300 * 0.08) / 400, 8);
    expect(r[0]!.share).toBeCloseTo(440 / 650, 8);
    expect(r[0]!.next).toEqual({ date: '2027-03-01', amount: 130 });
    expect(r.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1, 8);
  });
});

describe('maturityLadder', () => {
  it('adds what running deposits pay, by year, in order', () => {
    expect(maturityLadder(blocks)).toEqual([
      { year: '2027', count: 2, amount: 530 },
      { year: '2028', count: 1, amount: 250 },
    ]);
  });
});

describe('fixedDepositBlocks', () => {
  it('keeps only fixed deposits of real banks', async () => {
    const { fixedDepositBlocks } = await import('../src/deposit-views');
    const { OTHER_HOLDINGS_KEY } = await import('../src/accounts-view');
    const saving = {
      assetId: 's',
      kind: 'cash',
      ownerId: 'p',
      status: 'active',
      current: 5,
      fd: null,
    } as unknown as BankRow;
    const all = [
      block('a', 'Bank A', [fd('1', 100, 110, 130, 0.07, '2027-03-01'), saving]),
      block('z', 'Bank Z', [saving]),
      block(OTHER_HOLDINGS_KEY, 'Other holdings', [fd('9', 1, 1, 1, 0.01, '2027-01-01')]),
    ];
    const r = fixedDepositBlocks(all);
    expect(r.map((b) => b.name)).toEqual(['Bank A']);
    expect(r[0]!.sections[0]!.rows.map((x) => x.assetId)).toEqual(['1']);
  });
});
