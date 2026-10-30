import { describe, expect, it } from 'vitest';
import { lendingFromLines, nameKey, personNamed } from '../src/statement-lending';

// Invented names and amounts.
describe('a name as banks spell it', () => {
  it('matches spellings that differ only in their vowels', () => {
    expect(nameKey('Shalender')).toBe(nameKey('SHELENDRA'));
    expect(nameKey('Bhole')).toBe(nameKey('bhola'));
    expect(nameKey('Somesh')).not.toBe(nameKey('Suresh'));
  });
  it('finds the person a narration names, by the first word of the name', () => {
    const people = [{ name: 'Shalender' }, { name: 'Omveer Singh' }, { name: 'Atul' }];
    expect(personNamed('IMPS-123-SHELENDRA PRATAP SIN-HDFC', people)?.name).toBe('Shalender');
    expect(personNamed('NEFT DR-PUNB0001-OMVIR SINGH-NETBANK', people)?.name).toBe('Omveer Singh');
    expect(personNamed('IMPS-SHYAM VIR SINGH-SBIN', [{ name: 'Shyamvir Singh' }])?.name).toBe(
      'Shyamvir Singh',
    );
    // a name run together with the rest, and a second spelling or person after " / "
    expect(personNamed('IMPS-2499-SHELENDRAPRATAPSINGH-UTIB', [{ name: 'Shalender' }])?.name).toBe(
      'Shalender',
    );
    expect(
      personNamed('NEFT CR-SWATI KRUNALKUMAR', [{ name: 'Krunal D / Swati K' }]),
    ).not.toBeNull();
    // "singh" alone is not Omveer, and a narration word is not a name by accident
    expect(personNamed('NEFT DR-RAM SINGH', people)).toBeNull();
    expect(personNamed('TRANSFER TO OWN ACCOUNT', people)).toBeNull();
  });
});

describe('money lent and paid back, from the statement lines', () => {
  let n = 0;
  const l = (date: string, amount: number, narration: string) => ({
    id: `l${++n}`,
    assetId: 'hdfc',
    date,
    amount,
    narration,
  });
  const lines = [
    l('2019-01-05', 20_000, 'IMPS FROM SHELENDRA'), // before any loan: not a repayment
    l('2019-03-01', -300_000, 'IMPS-SHELENDRA PRATAP SIN'),
    l('2019-03-10', -5_000, 'UPI-SHELENDRA'), // a small payment: spending, not a loan
    l('2019-09-01', 100_000, 'NEFT CR-SHELENDRA PRATAP'),
    l('2020-02-01', 150_000, 'IMPS SHELENDRA'),
    l('2020-02-01', 20_000, 'UPI SHELENDRA'),
    l('2021-01-01', -200_000, 'NEFT DR-SOMESH'),
  ];
  const [shalender, somesh, atul] = lendingFromLines(
    lines,
    ['Shalender', 'Somesh', 'Atul'],
    50_000,
  );
  it('counts the large payments as loans and what came back after as repayments', () => {
    expect(shalender!.lent.map((x) => x.amount)).toEqual([-300_000]);
    expect(shalender!.repaid.map((x) => x.amount)).toEqual([100_000, 150_000, 20_000]);
    expect(shalender!.owed).toBe(30_000);
    expect(shalender!.steps).toEqual([
      { date: '2019-03-01', owed: 300_000 },
      { date: '2019-09-01', owed: 200_000 },
      { date: '2020-02-01', owed: 30_000 },
    ]);
  });
  it('a loan with nothing back is all still owed, and a person never paid has nothing', () => {
    expect(somesh!.owed).toBe(200_000);
    expect([atul!.lent.length, atul!.owed]).toEqual([0, 0]);
  });
});
