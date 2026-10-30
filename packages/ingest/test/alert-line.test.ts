import { describe, expect, it } from 'vitest';
import { alertMovement } from '../src/alert-line';

// Alert wordings as the banks write them; every name, number and amount is invented.
describe('the transaction a bank alert reports', () => {
  it('reads the amount and its direction, whichever comes first', () => {
    expect(
      alertMovement(
        'Dear Customer, your a/c no. ending XX1234 has been debited for INR 1,23,456.78 on 28-10-2026 at 12:57:37. Your available balance is INR 2,00,000.00.',
      )?.amount,
    ).toBe(-123456.78);
    expect(
      alertMovement(
        'Your A/C XXXXXXX1234 has been credited with INR 50,000.00 on 08-09-2026 17:03:06 vide NEFT from SAMPLE PERSON. New balance is INR 1,50,000.00.',
      ),
    ).toEqual({ amount: 50_000, words: 'NEFT from SAMPLE PERSON' });
    expect(
      alertMovement(
        'Rs.2500.00 has been debited from account **1234 to VPA samplefriend@okaxis SAMPLE FRIEND on 30-10-26. Your UPI transaction reference number is 123456789012.',
      ),
    ).toEqual({ amount: -2500, words: 'samplefriend@okaxis SAMPLE FRIEND' });
  });
  it('a balance-only alert reports no movement, and the balance is never taken for one', () => {
    expect(
      alertMovement(
        'Available balance in your account ending XX1234 is Rs. INR 1,23,456.78 as on 25-OCT-26.',
      ),
    ).toBeNull();
    expect(
      alertMovement(
        'Your Jana Bank A/c no. XX1234 is credited with INR 9,000.00 on 30-SEP-2026. Your account balance is INR 99,000.00.',
      )?.amount,
    ).toBe(9000);
  });
});
