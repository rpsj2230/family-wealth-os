import { describe, expect, it } from 'vitest';
import {
  depositNumbers,
  depositsFromStatements,
  matchDepositRecords,
  type StatementDeposit,
} from '../src/statement-deposits';

// Invented numbers and amounts.
let n = 0;
const line = (assetId: string, date: string, amount: number, narration: string) => ({
  id: `l${++n}`,
  assetId,
  date,
  amount,
  narration,
});
const last4 = new Map<string, string | null>([
  ['idfc', '1065'],
  ['esaf', '9969'],
]);

describe('the deposit number a narration prints', () => {
  it('reads it, leaves out the account’s own number, and mends one broken over two lines', () => {
    expect(depositNumbers('Fd …1907 Booked Via Net Banking', '1065')).toEqual(['1907']);
    expect(depositNumbers('IMPS …1065 TO …4471', '1065')).toEqual(['4471']);
    expect(depositNumbers('DEP FD PRE CLOSURE/…3743 7/…2027/MR. SAMPLE', '9969')).toEqual([
      '3743',
      '7437',
      '2027',
    ]);
  });
});

describe('deposits found as a booking and a pay-back on the statements', () => {
  const bookings = [
    line('idfc', '2020-07-10', -100_000, 'Fd …1907 Booked Via Net Banking'),
    line('idfc', '2020-07-10', -100_000, 'Fd …1963 Booked Via Net Banking'),
    line('esaf', '2026-01-03', -250_000, 'NEWFD/…7437/MR. SAMPLE'),
    line('idfc', '2022-09-11', -100_000, 'Fd …2040 Booked Via Internet Banking'),
  ];
  const paybacks = [
    line('idfc', '2021-07-19', 107_471, 'Fd/Rd …1907 Maturity :Account Credited'),
    line('idfc', '2021-07-19', 107_450, 'Fd/Rd …1963 Maturity :Account Credited'),
    line('esaf', '2026-02-14', 248_500, 'DEP FD PRE CLOSURE/…3743 7/…2027/MR. SAMPLE'),
    // paid back in two lines: the principal, then the interest the next day
    line('idfc', '2022-10-21', 100_000, 'Fd/Rd …2040 Maturity :Account Credited'),
    line('idfc', '2022-10-22', 512, 'Fd …2040 Interest Credited'),
    // a pay-back with no booking on the statements (booked before them)
    line('idfc', '2020-10-31', 433_120, 'Fd/Rd …1880 Maturity :Account Credited'),
  ];
  const found = depositsFromStatements(bookings, paybacks, last4);

  it('pairs each booking with the pay-back of the same deposit number', () => {
    expect(found.map((d) => [d.accountId, d.last4, d.bookedOn, d.endedOn])).toEqual([
      ['idfc', '1907', '2020-07-10', '2021-07-19'],
      ['idfc', '1963', '2020-07-10', '2021-07-19'],
      ['idfc', '2040', '2022-09-11', '2022-10-22'],
      ['esaf', '7437', '2026-01-03', '2026-02-14'],
    ]);
  });
  it('adds pay-back lines of one deposit together, and works out the yearly rate', () => {
    const d2040 = found.find((d) => d.last4 === '2040')!;
    expect([d2040.principal, d2040.paidBack, d2040.paybackLineIds.length]).toEqual([
      100_000, 100_512, 2,
    ]);
    const d1907 = found.find((d) => d.last4 === '1907')!;
    expect(d1907.rate).toBeGreaterThan(0.07);
    expect(d1907.rate).toBeLessThan(0.075);
  });
  it('gives a deposit closed early for less than it took a rate of nothing', () => {
    expect(found.find((d) => d.last4 === '7437')!.rate).toBe(0);
  });
  it('leaves a pay-back with no booking alone', () => {
    expect(found.some((d) => d.last4 === '1880')).toBe(false);
  });
});

describe('a deposit whose interest was paid on its own lines', () => {
  it('counts that interest in what it paid back', () => {
    const [d] = depositsFromStatements(
      [line('yes', '2020-05-09', -100_000, 'NET TXN: FD BOOKED …0445')],
      [line('yes', '2021-11-18', 100_000, 'PRIN AUTO_REDEEM …0445')],
      new Map([['yes', '0037']]),
      [
        line('yes', '2020-08-09', 1_800, 'INT AUTO_REDEEM …0445'),
        line('yes', '2020-11-09', 1_800, 'INT AUTO_REDEEM …0445'),
        line('yes', '2020-11-09', 999, 'INT AUTO_REDEEM …9999'),
      ],
    );
    expect([d!.paidBack, d!.paybackLineIds.length]).toEqual([103_600, 3]);
    expect(d!.rate).toBeGreaterThan(0.02);
  });
});

describe('records on file that already stand for deposits on the statements', () => {
  const dep = (last4: string, bookedOn: string, endedOn: string, principal: number) =>
    ({
      accountId: 'idfc',
      key: 'r|idfc',
      last4,
      bookedOn,
      endedOn,
      principal,
      paidBack: principal * 1.07,
      rate: 0.07,
      bookingLineId: `b${last4}`,
      paybackLineIds: [`p${last4}`],
    }) satisfies StatementDeposit & { key: string };
  const found = [
    // five ₹1 L deposits booked on one day and paid back together, kept on the monthly sheet as one ₹5 L row
    ...['1794', '1829', '1863', '1896', '1921'].map((n) =>
      dep(n, '2022-09-11', '2024-09-12', 100_000),
    ),
    // five more booked that day and closed early: on no row
    ...['1943', '1954', '1987', '2006', '2040'].map((n) =>
      dep(n, '2022-09-11', '2022-10-21', 100_000),
    ),
    // a deposit a diary note dated by the note (26 Jul 2020) instead of its booking (19 Oct 2019)
    dep('1880', '2019-10-19', '2020-10-31', 400_000),
  ];
  const records = [
    {
      id: 'sheet',
      key: 'r|idfc',
      principal: 500_000,
      bookedOn: '2022-09-11',
      endedOn: '2024-09-12',
      estimated: false,
    },
    {
      id: 'diary',
      key: 'r|idfc',
      principal: 400_000,
      bookedOn: '2020-07-26',
      endedOn: '2020-10-20',
      estimated: true,
    },
    // a guessed record that ended before the statement deposits began is not them (they are the next deposits)
    {
      id: 'earlier',
      key: 'r|idfc',
      principal: 500_000,
      bookedOn: '2021-09-12',
      endedOn: '2022-09-10',
      estimated: true,
    },
    // another person's record at the same bank and dates is never theirs
    {
      id: 'other',
      key: 'g|idfc',
      principal: 500_000,
      bookedOn: '2022-09-11',
      endedOn: '2022-10-21',
      estimated: false,
    },
  ];
  const { matches, rest } = matchDepositRecords(found, records);
  it('finds the five deposits a ₹5 L row stands for, by their sum and dates', () => {
    const sheet = matches.find((m) => m.recordId === 'sheet')!;
    expect(sheet.deposits.map((d) => d.last4)).toEqual(['1794', '1829', '1863', '1896', '1921']);
    expect(sheet.datesFixed).toBe(false);
  });
  it('finds the deposit a diary note dated wrongly, and says its dates are to be put right', () => {
    const diary = matches.find((m) => m.recordId === 'diary')!;
    expect(diary.deposits.map((d) => d.last4)).toEqual(['1880']);
    expect(diary.datesFixed).toBe(true);
  });
  it('leaves the deposits no record stands for to be added', () => {
    expect(rest.map((d) => d.last4)).toEqual(['1943', '1954', '1987', '2006', '2040']);
    expect(matches.some((m) => m.recordId === 'other' || m.recordId === 'earlier')).toBe(false);
  });
});

describe('a deposit whose lines print no number, or a different one when paid back', () => {
  const found = depositsFromStatements(
    [
      line('jana', '2024-09-06', -200_000, 'TD. GENERIC PAYIN DEBIT'),
      line('jana', '2024-09-06', -100_000, 'TD. GENERIC PAYIN DEBIT'),
      line('eq', '2026-01-03', -300_000, 'INITIAL PAYIN FD…8674 /1 SAMPLE'),
    ],
    [
      line('jana', '2026-09-06', 230_000, 'PRINC AND INT AUTO REDEEM SAMPLE'),
      line('jana', '2026-09-06', 115_000, 'PRINC AND INT AUTO REDEEM SAMPLE'),
      // not on an anniversary of any booking: left alone
      line('jana', '2026-05-20', 120_000, 'PRINC AND INT AUTO REDEEM SAMPLE'),
      line('eq', '2026-02-03', 301_000, 'FD REDEEM AMOUNT -…8763 /1 - SAMPLE'),
    ],
    new Map(),
  );
  it('pairs them on the deposit’s anniversary, each pay-back with the booking it grew from', () => {
    expect(found.map((d) => [d.accountId, d.principal, d.paidBack, d.bookedOn, d.endedOn])).toEqual(
      [
        ['jana', 200_000, 230_000, '2024-09-06', '2026-09-06'],
        ['jana', 100_000, 115_000, '2024-09-06', '2026-09-06'],
        ['eq', 300_000, 301_000, '2026-01-03', '2026-02-03'],
      ],
    );
    expect(found[2]!.last4).toBe('8674');
  });
});

describe('a deposit closed early, off its anniversary', () => {
  it('pairs with the only booking that could have grown into it, and never guesses between two', () => {
    const one = depositsFromStatements(
      [line('rbl', '2025-05-12', -500_000, 'FD BOOKING SAMPLE')],
      [line('rbl', '2026-02-25', 518_000, 'CLOSURE PROCEEDS SAMPLE')],
      new Map(),
    );
    expect(one.map((d) => [d.bookedOn, d.endedOn])).toEqual([['2025-05-12', '2026-02-25']]);
    const two = depositsFromStatements(
      [
        line('rbl', '2025-05-12', -500_000, 'FD BOOKING SAMPLE'),
        line('rbl', '2025-06-01', -500_000, 'FD BOOKING SAMPLE'),
      ],
      [line('rbl', '2026-02-25', 518_000, 'CLOSURE PROCEEDS SAMPLE')],
      new Map(),
    );
    expect(two).toEqual([]);
  });
});
