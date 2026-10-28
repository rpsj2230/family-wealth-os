import { describe, expect, it } from 'vitest';
import { alignDiary, derivedOpenings, diaryWorkbook, type DiaryNote } from '../src/diary-history';
import { planHistoryFrom } from '../src/history';
import type { ExistingAsset } from '../src/history-match';

// Invented people, banks and amounts.
const OWNERS = ['Asha', 'Vikram'];
const notes: DiaryNote[] = [
  {
    title: 'Jul 2020',
    asOf: '2020-07-26',
    lines: [
      {
        bank: 'Samplebank',
        person: 'Asha',
        kind: 'fd',
        amount: 500_000,
        rate: 0.0725,
        maturity: '2021-11-18',
      },
      { bank: 'Samplebank', person: 'Asha', kind: 'cash', amount: 1_021 },
      {
        bank: 'Second',
        person: 'Vikram',
        kind: 'fd',
        amount: 400_000,
        rate: 0.07,
        maturity: '2020-10-20',
      },
      { bank: 'Second', person: 'Vikram', kind: 'cash', amount: 474 },
      { bank: 'UOB', kind: 'sg', amount: 3_700_000, sgd: 67_500 },
    ],
  },
  {
    title: 'Nov 2020',
    asOf: '2020-11-01',
    lines: [
      {
        bank: 'Samplebank',
        person: 'Asha',
        kind: 'fd',
        amount: 500_000,
        rate: 0.0725,
        maturity: '2021-11-18',
      },
      {
        bank: 'Samplebank',
        person: 'Asha',
        kind: 'fd',
        amount: 1_000_000,
        rate: 0.0675,
        maturity: '2024-04-05',
      },
      { bank: 'Samplebank', person: 'Asha', kind: 'cash', amount: 1_123 },
      { bank: 'Second', person: 'Vikram', kind: 'cash', amount: 434_577 },
      { bank: 'Others', kind: 'loan', amount: 50_000, label: 'Friend' },
      { bank: 'Others', kind: 'memo', amount: 350_000, label: 'Papa' },
    ],
  },
];
const acct = (id: string, owner: string, bank: string): ExistingAsset => ({
  id,
  type: 'bank_account',
  status: 'active',
  nickname: 'Cash',
  label: null,
  last4: null,
  accountKind: 'NRE',
  joint: false,
  holderName: null,
  currency: 'INR',
  ownerName: owner,
  bank,
  fd: null,
});
const existing: ExistingAsset[] = [
  acct('a1', 'Asha', 'Samplebank Ltd'),
  acct('a2', 'Vikram', 'Second Bank'),
  {
    ...acct('f1', 'Asha', 'Samplebank Ltd'),
    type: 'fixed_deposit',
    nickname: 'FD',
    fd: {
      principal: 1_000_000,
      rate: 0.0675,
      bookedOn: '2021-04-03',
      maturityOn: '2024-04-03',
      ref: null,
      refLast4: null,
    },
  },
];

describe('diary notes as history', () => {
  it('writes banks as they are on file and moves a maturity a few days off onto the deposit on file', () => {
    const a = alignDiary(notes, existing);
    expect(a.renamedBanks).toBe(2);
    expect(a.movedMaturities).toBe(1);
    const fd = a.notes[1]!.lines.find((l) => l.amount === 1_000_000)!;
    expect([fd.bank, fd.maturity]).toEqual(['Samplebank Ltd', '2024-04-03']);
  });

  it('goes through the monthly-tab importer: accounts matched, an unknown deposit added as ended, the deposit on file matched', () => {
    const { notes: aligned } = alignDiary(notes, existing);
    const plan = planHistoryFrom(diaryWorkbook(aligned), {
      today: '2026-10-28',
      ownerNames: OWNERS,
      defaultOwner: 'Asha',
      existing: { assets: existing, observations: [] },
      latestIsHistory: true,
    });
    const jul = plan.months.find((m) => m.tab === 'Jul 2020')!;
    const nov = plan.months.find((m) => m.tab === 'Nov 2020')!;
    expect(jul.asOf).toBe('2020-07-26');
    expect(nov.asOf).toBe('2020-11-01');
    expect(jul.unmatchedRows.map((u) => JSON.stringify(u))).toEqual([]);
    // the two savings balances go onto the accounts on file
    const cash = jul.writes.filter((w) => w.assetId === 'a1' || w.assetId === 'a2');
    expect(cash.map((w) => w.amount).sort((x, y) => x - y)).toEqual([474, 1_021]);
    // the deposit that matured in October 2020 is not on file: added as an ended record, its start estimated
    const old = plan.historical.find((h) => h.fd?.principal === 400_000)!;
    expect(old.fd!.startEstimated).toBe(true);
    expect(old.status).toBe('matured');
    // in the latest note, matured since and not on file: added as matured on its maturity day
    const listed = plan.historical.find((h) => h.fd?.principal === 500_000)!;
    expect([listed.status, listed.endedOn, listed.skipReason]).toEqual([
      'matured',
      '2021-11-18',
      null,
    ]);
    // the deposit written "3/5 April" is the one on file, not a new one
    expect(plan.historical.some((h) => h.fd?.principal === 1_000_000)).toBe(false);
    // the Singapore balance keeps its dollars and the rate of the day
    const sg = jul.writes.find((w) => w.currency === 'SGD')!;
    expect(sg.amount).toBe(67_500);
    expect(sg.fxRate).toBeCloseTo(3_700_000 / 67_500, 2);
  });
});

describe('a savings line and the account on file', () => {
  it('goes onto the person’s only account at the bank even when it is recorded as another type', () => {
    const only = [{ ...acct('h1', 'Asha', 'Samplebank Ltd'), accountKind: 'SB' }];
    const note: DiaryNote = {
      title: 'Jul 2020',
      asOf: '2020-07-26',
      lines: [{ bank: 'Samplebank', person: 'Asha', kind: 'cash', amount: 900 }],
    };
    const { notes: aligned } = alignDiary(
      [note, { ...note, title: 'Nov 2020', asOf: '2020-11-01' }],
      only,
    );
    expect(aligned[0]!.lines[0]!.accountKind).toBe('any');
    const plan = planHistoryFrom(diaryWorkbook(aligned), {
      today: '2026-10-28',
      ownerNames: OWNERS,
      existing: { assets: only, observations: [] },
      latestIsHistory: true,
    });
    expect(plan.months[0]!.writes.map((w) => w.assetId)).toEqual(['h1']);
  });
});

describe('when accounts were opened, from the records', () => {
  it('dates an account between the last full snapshot without it and its first record', () => {
    const rec = (assetId: string, asOf: string) => ({ assetId, asOf });
    const days = ['2020-07-26', '2020-11-01', '2021-01-30'];
    const records = [
      ...['a', 'b', 'c', 'd'].flatMap((id) => days.map((d) => rec(id, d))),
      rec('e', '2021-01-30'),
      rec('e', '2021-02-15'),
    ];
    const o = derivedOpenings(records);
    expect(o.get('a')).toEqual({ by: '2020-07-26', after: null });
    expect(o.get('e')).toEqual({ by: '2021-01-30', after: '2020-11-01' });
  });
});
