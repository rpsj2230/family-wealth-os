import { describe, expect, it } from 'vitest';
import { depositNumbers, depositsFromStatements } from '../src/statement-deposits';

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
