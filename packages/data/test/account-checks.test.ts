import { describe, expect, it } from 'vitest';
import type { Classified } from '@fwos/core';
import { accountChecks } from '../src/trail-store';
import type { StoredLine } from '../src/statement-store';

// One invented account: a statement line with its balance, then two alert lines without one.
const line = (id: string, date: string, amount: number, balance: number | null): StoredLine => ({
  id,
  statement_id: 's',
  asset_id: 'a1',
  txn_on: date,
  amount,
  balance,
  narration: `LINE ${id}`,
  answer: null,
});

describe('what an account’s lines reach, and which need an answer', () => {
  const lines = [
    line('l1', '2026-09-30', 412, 137_912),
    line('l2', '2026-10-05', -2_500, null),
    line('l3', '2026-10-09', -150_000, null),
  ];
  const classified = new Map<string, Classified>([
    ['l1', { id: 'l1', cls: 'interest', counterpart: null, reason: 'Interest' }],
    ['l2', { id: 'l2', cls: 'spent', counterpart: null, reason: 'Small', category: 'food' }],
    ['l3', { id: 'l3', cls: 'ask_out', counterpart: null, reason: 'No rule fits' }],
  ]);
  it('moves the last balance the bank gave on by the lines after it', () => {
    const c = accountChecks({ lines, classified }).a1!;
    expect(c.reach).toBe(137_912 - 2_500 - 150_000);
    expect(c.on).toBe('2026-10-09');
  });
  it('lists the lines to answer, newest first', () => {
    expect(accountChecks({ lines, classified }).a1!.ask.map((a) => a.id)).toEqual(['l3']);
  });
  it('without any balance from the bank, what the lines reach is not known', () => {
    expect(accountChecks({ lines: lines.slice(1), classified }).a1!.reach).toBeNull();
  });
});
