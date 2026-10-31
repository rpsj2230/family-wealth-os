import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  bankFitsSender,
  openBankStatement,
  namesPerson,
  pickStatementAccount,
  senderBankWord,
  type StatementAccount,
} from '../src/bank-statement-mail';
import type { BankStatement } from '../src/bank-statement';

// Every name, number and password is invented.
const stmt = (last4: string | null): BankStatement => ({
  lines: [],
  last4,
  from: '2026-09-01',
  to: '2026-09-30',
  opening: 0,
  closing: 0,
  layout: 'debit-credit',
  breaks: 0,
  warnings: [],
});
const wrong = Object.assign(new Error('Incorrect Password'), { name: 'PasswordException' });

describe('opening an e-mailed bank statement', () => {
  it('needs no password when the file has none', async () => {
    const r = await openBankStatement(new Uint8Array(), [], async () => stmt('1234'));
    expect(r).toMatchObject({ ok: true, ownerId: null });
  });
  it('tries each saved password and says whose opened it', async () => {
    const read = async (_b: Uint8Array, p?: string) => {
      if (p !== 'SECOND') throw wrong;
      return stmt('1234');
    };
    const r = await openBankStatement(
      new Uint8Array(),
      [
        { ownerId: 'a', passwords: ['FIRST'], panLast4: null },
        { ownerId: 'b', passwords: ['OTHER', 'SECOND'], panLast4: null },
      ],
      read,
    );
    expect(r).toMatchObject({ ok: true, ownerId: 'b' });
  });
  it('fails without naming any password when none fits', async () => {
    const r = await openBankStatement(
      new Uint8Array(),
      [{ ownerId: 'a', passwords: ['SECRET1'], panLast4: null }],
      async () => {
        throw wrong;
      },
    );
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('SECRET1');
  });
});

describe('the account an e-mailed statement belongs to', () => {
  const acc = (id: string, ownerId: string, last4: string, bank: string): StatementAccount => ({
    id,
    ownerId,
    last4,
    bank,
    currency: 'INR',
  });
  const accounts = [
    acc('h1', 'r', '1234', 'HDFC Bank'),
    acc('y1', 'g', '1234', 'Yes Bank'),
    acc('y2', 'r', '5678', 'Yes Bank'),
    acc('a1', 'r', '9999', 'AU Small Finance Bank'),
    acc('i1', 'r', '9999', 'IDFC First Bank'),
  ];
  it('reads the bank from the sender', () => {
    expect(senderBankWord('estatement@hdfcbank.net')).toBe('hdfcbank');
    expect(senderBankWord('x@mail.yesbank.in')).toBe('yesbank');
    expect(senderBankWord('x@idfcfirst.bank.in')).toBe('idfcfirst');
    expect(bankFitsSender('AU Small Finance Bank', 'aubank')).toBe(true);
    expect(bankFitsSender('IDFC First Bank', 'aubank')).toBe(false);
  });
  it('the last four digits, then whose password, then the bank', () => {
    expect(pickStatementAccount(stmt('5678'), null, 'a@yesbank.in', accounts)).toMatchObject({
      ok: true,
      account: { id: 'y2' },
    });
    expect(pickStatementAccount(stmt('1234'), 'g', 'a@hdfcbank.net', accounts)).toMatchObject({
      account: { id: 'y1' },
    });
    expect(pickStatementAccount(stmt('9999'), 'r', 'a@aubank.in', accounts)).toMatchObject({
      account: { id: 'a1' },
    });
  });
  it('a statement with no account number is placed when the bank and the holder leave one account', () => {
    expect(pickStatementAccount(stmt(null), 'r', 'a@hdfcbank.net', accounts)).toMatchObject({
      ok: true,
      account: { id: 'h1' },
    });
  });
  it('saves nothing when the account is not certain', () => {
    // two people's accounts at the sender's bank, and nothing to say whose
    expect(pickStatementAccount(stmt(null), null, 'a@yesbank.in', accounts).ok).toBe(false);
    expect(pickStatementAccount(stmt('0000'), 'r', 'a@hdfcbank.net', accounts).ok).toBe(false);
    expect(pickStatementAccount(stmt('9999'), 'r', 'a@rblbank.com', accounts).ok).toBe(false);
  });
});

// Invented statements (test/fixtures): the same one plain and locked with the two encryptions banks use, password "SAMP1234".
const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`./fixtures/${name}.pdf`, import.meta.url)));

describe('a locked statement PDF, end to end', () => {
  const saved = [
    { ownerId: 'other', passwords: ['NOT-IT'], panLast4: null },
    { ownerId: 'r', passwords: ['ABCDE1234F', 'SAMP1234'], panLast4: null },
  ];
  for (const name of ['sample-bank-statement-aes', 'sample-bank-statement-rc4'])
    it(`${name}: opened with the saved password, every line read, and placed on its account`, async () => {
      expect((await openBankStatement(fixture(name), [])).ok).toBe(false);
      const r = await openBankStatement(fixture(name), saved);
      if (!r.ok) throw new Error(r.reason);
      expect(r.ownerId).toBe('r');
      expect(r.stmt).toMatchObject({
        last4: '5678',
        from: '2026-09-03',
        to: '2026-09-30',
        opening: 100_000,
        closing: 137_912,
        breaks: 0,
      });
      expect(r.stmt.lines.map((l) => [l.date, l.credit - l.debit, l.balance])).toEqual([
        ['2026-09-03', -2_500, 97_500],
        ['2026-09-10', 50_000, 147_500],
        ['2026-09-15', -10_000, 137_500],
        ['2026-09-30', 412, 137_912],
      ]);
      const placed = pickStatementAccount(r.stmt, r.ownerId, 'estatement@samplebank.bank.in', [
        { id: 'mine', ownerId: 'r', last4: '5678', bank: 'Sample Bank', currency: 'INR' },
        { id: 'theirs', ownerId: 'other', last4: '5678', bank: 'Other Bank', currency: 'INR' },
      ]);
      expect(placed).toMatchObject({ ok: true, account: { id: 'mine' } });
    });
  it('the plain copy needs no password', async () => {
    const r = await openBankStatement(fixture('sample-bank-statement'), []);
    expect(r).toMatchObject({ ok: true, ownerId: null });
  });
});

describe('pickStatementAccount: the holder’s name, the mailbox and the bank tell accounts apart', () => {
  const accts = [
    {
      id: 'r1',
      ownerId: 'r',
      last4: '1454',
      bank: 'Jana Small Finance Bank',
      currency: 'INR',
      owner: 'Rupash',
    },
    {
      id: 'g1',
      ownerId: 'g',
      last4: '1454',
      bank: 'Equitas Small Finance Bank',
      currency: 'INR',
      owner: 'Ragini',
    },
    {
      id: 'g2',
      ownerId: 'g',
      last4: '1454',
      bank: 'Jana Small Finance Bank',
      currency: 'INR',
      owner: 'Ragini',
    },
    {
      id: 'g3',
      ownerId: 'g',
      last4: '1113',
      bank: 'ESAF Small Finance Bank',
      currency: 'INR',
      owner: 'Ragini',
    },
  ];
  it('the name printed in the heading picks the holder', () => {
    const r = pickStatementAccount(
      { last4: '1454', header: 'Statement of account\nMRS RAGINI SINGH\nNRO savings' },
      null,
      'estatement@janabank.com',
      accts,
    );
    expect(r).toMatchObject({ ok: true, account: { id: 'g2' } });
  });
  it('else the mailbox it was sent to', () => {
    const r = pickStatementAccount(
      { last4: '1454' },
      null,
      'statements@janabank.com',
      accts,
      'Rupash Singh <x@y.z>',
    );
    expect(r).toMatchObject({ ok: true, account: { id: 'r1' } });
  });
  it('a statement with no account number: the one account of that person at the sender’s bank', () => {
    const r = pickStatementAccount(
      { last4: null, header: 'RAGINI SINGH' },
      null,
      'estatement@esafbank.com',
      accts,
    );
    expect(r).toMatchObject({ ok: true, account: { id: 'g3' } });
  });
  it('names a person only by a whole word', () => {
    expect(namesPerson('MRS RAGINI SINGH', 'Ragini')).toBe(true);
    expect(namesPerson('RAGINIX', 'Ragini')).toBe(false);
  });
});
