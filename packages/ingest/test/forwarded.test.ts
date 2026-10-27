import { describe, expect, it } from 'vitest';
import { senderAddress, unwrapForward } from '../src/forwarded';

describe('senderAddress', () => {
  it('reads the address from the usual From forms', () => {
    expect(senderAddress('HDFC Bank InstaAlerts <Alerts@HDFCBank.bank.in>')).toBe(
      'alerts@hdfcbank.bank.in',
    );
    expect(senderAddress('me@mail.example.test')).toBe('me@mail.example.test');
    expect(senderAddress('no address')).toBe('');
  });
});

describe('unwrapForward', () => {
  it('finds the original sender in a Gmail forward, with line breaks', () => {
    const text = `Dear me,\n\n---------- Forwarded message ---------\nFrom: HDFC Bank <alerts@hdfcbank.bank.in>\nDate: Mon, 26 Oct 2026 at 10:00\nSubject: Balance Change Alert\nTo: <me@mail.example.test>\n\nAvailable balance in your account ending XX7240 is Rs. INR 10,711.96 as on 25-OCT-26.`;
    expect(unwrapForward('Fwd: Balance Change Alert', text)).toEqual({
      found: true,
      originalFrom: 'HDFC Bank <alerts@hdfcbank.bank.in>',
    });
  });
  it('works when the text has no line breaks', () => {
    const text =
      '---------- Forwarded message --------- From: HDFC Bank <alerts@hdfcbank.bank.in> Date: Mon Subject: Alert To: <me@mail.example.test> Available balance is 1';
    expect(unwrapForward('Fwd: Alert', text).originalFrom).toBe(
      'HDFC Bank <alerts@hdfcbank.bank.in>',
    );
  });
  it('is not a forward when there is no marker or subject prefix', () => {
    expect(unwrapForward('Offers', 'From: x <x@y.z> big sale')).toEqual({
      found: false,
      originalFrom: null,
    });
  });
  it('says nothing was found when a forward has no readable header', () => {
    expect(unwrapForward('Fwd: hello', 'just a line')).toEqual({
      found: false,
      originalFrom: null,
    });
  });
});
