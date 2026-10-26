import { describe, expect, it } from 'vitest';
import { noteClauses, splitNote, tidyPlan, withChangeRequest } from '../src/notes-tidy';

describe('noteClauses', () => {
  it('splits full stops and keeps a card line together', () => {
    expect(noteClauses('AMB - NA. UPI Set on this through HDFC App')).toEqual([
      'AMB - NA',
      'UPI Set on this through HDFC App',
    ]);
    expect(noteClauses('Lounge Card - International(2), Domestic(12)')).toEqual([
      'Lounge Card - International(2), Domestic(12)',
    ]);
  });
  it('splits a comma that starts a new topic', () => {
    expect(noteClauses('AMB - NA, Lounge Card - Domestic (8)')).toEqual([
      'AMB - NA',
      'Lounge Card - Domestic (8)',
    ]);
  });
  it('is empty for nothing', () => {
    expect(noteClauses(null)).toEqual([]);
    expect(noteClauses('  ')).toEqual([]);
  });
});

describe('splitNote', () => {
  it('sends bank facts up and leaves account facts', () => {
    expect(splitNote('AMB - NA. UPI Set on this through HDFC App')).toEqual({
      bank: ['AMB - NA'],
      account: ['UPI Set on this through HDFC App'],
    });
    expect(splitNote('No Debit Card')).toEqual({ bank: ['No Debit Card'], account: [] });
    expect(splitNote('Change: Address Change. KYC Completed')).toEqual({
      bank: [],
      account: ['Change: Address Change', 'KYC Completed'],
    });
  });
});

describe('tidyPlan', () => {
  const rows = [
    {
      assetId: 'a1',
      ownerName: 'Rupash J',
      institutionId: 'yes',
      notes: 'AMB - NA. UPI Set on this through HDFC App',
    },
    {
      assetId: 'a2',
      ownerName: 'Rupash J',
      institutionId: 'yes',
      notes: 'Lounge Card - International(2), Domestic(12)',
    },
    {
      assetId: 'a3',
      ownerName: 'Ragini J',
      institutionId: 'yes',
      notes: 'AMB - NA, Lounge Card - Domestic (8)',
    },
    { assetId: 'a4', ownerName: 'Ragini J', institutionId: 'yes', notes: 'No Debit Card' },
    { assetId: 'a5', ownerName: 'Ragini J', institutionId: 'yes', notes: 'Address Change' },
  ];
  const plan = tidyPlan(rows, new Map([['yes', null]]));
  it('writes each bank fact once, with the person named for cards', () => {
    expect(plan.banks).toHaveLength(1);
    expect(plan.banks[0]!.notes).toBe(
      'AMB - NA · Rupash: Lounge Card - International(2), Domestic(12) · Ragini: Lounge Card - Domestic (8) · Ragini: No Debit Card',
    );
  });
  it('keeps what belongs to the account and empties the rest', () => {
    const by = Object.fromEntries(plan.assets.map((a) => [a.assetId, a.notes]));
    expect(by).toEqual({ a1: 'UPI Set on this through HDFC App', a2: null, a3: null, a4: null });
    expect(plan.assets.find((a) => a.assetId === 'a5')).toBeUndefined();
  });
  it('does not repeat what the bank note already says, and respects the length limit', () => {
    const p = tidyPlan(rows.slice(0, 1), new Map([['yes', 'AMB - NA']]));
    expect(p.banks).toEqual([]);
    expect(p.assets[0]!.notes).toBe('UPI Set on this through HDFC App');
    const long = tidyPlan(rows.slice(1, 2), new Map([['yes', 'x'.repeat(480)]]));
    expect(long.kept).toHaveLength(1);
    expect(long.assets).toEqual([]);
  });
});

describe('withChangeRequest', () => {
  it('writes the sheet’s change request into the account note', () => {
    expect(withChangeRequest('AMB - NA', 'Address Change')).toBe(
      'AMB - NA. Change: Address Change',
    );
    expect(withChangeRequest(null, 'KYC Completed')).toBe('Change: KYC Completed');
    expect(withChangeRequest('AMB - NA', '')).toBe('AMB - NA');
    expect(withChangeRequest(null, null)).toBeNull();
  });
});
