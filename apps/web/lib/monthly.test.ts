import { describe, expect, it } from 'vitest';
import { buildChanges, parseAmount, parsePercent, type GridRow } from './monthly';

const row = (o: Partial<GridRow> & { id: string }): GridRow => ({
  name: o.id,
  owner: 'Rupash',
  type: 'bank_account',
  group: 'Bank balances',
  currency: 'INR',
  mode: 'value',
  latestAmount: 100,
  latestAsOf: '2026-10-01',
  freshness: 'current',
  estimatedToday: 100,
  fxRate: null,
  interestRate: null,
  tdsRate: null,
  status: 'active',
  ...o,
});
const today = '2026-10-26';

describe('parseAmount', () => {
  it('accepts plain numbers, rupee signs and Indian grouping', () => {
    expect(parseAmount('125000.50')).toBe(125000.5);
    expect(parseAmount('₹1,23,456')).toBe(123456);
    expect(parseAmount(' 46,55,333 ')).toBe(4655333);
  });
  it('rejects anything ambiguous or non-numeric', () => {
    for (const bad of ['', 'abc', '12abc', '1.2.3', '--5', '1e5'])
      expect(parseAmount(bad)).toBeNull();
  });
});

describe('parsePercent', () => {
  it('converts percent text to a decimal', () => {
    expect(parsePercent('3')).toBe(0.03);
    expect(parsePercent('3.25 %')).toBe(0.0325);
    expect(parsePercent('')).toBeNull();
  });
  it('rejects out-of-range or invalid values', () => {
    expect(parsePercent('100')).toBeUndefined();
    expect(parsePercent('-1')).toBeUndefined();
    expect(parsePercent('x')).toBeUndefined();
  });
});

describe('buildChanges', () => {
  it('turns typed values into changes and ignores untouched rows', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const { changes, errors } = buildChanges(
      rows,
      { a: { amount: '5,000', asOf: '2026-10-20' } },
      today,
    );
    expect(errors).toEqual({});
    expect(changes).toEqual([{ assetId: 'a', amount: 5000, asOf: '2026-10-20' }]);
  });
  it('defaults the date to today', () => {
    expect(
      buildChanges([row({ id: 'a' })], { a: { amount: '1' } }, today).changes[0],
    ).toMatchObject({ asOf: today });
  });
  it('flags invalid amounts and future dates per row, without producing a change for them', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b' })];
    const r = buildChanges(
      rows,
      { a: { amount: 'oops' }, b: { amount: '10', asOf: '2026-12-01' } },
      today,
    );
    expect(Object.keys(r.errors).sort()).toEqual(['a', 'b']);
    expect(r.changes).toEqual([]);
  });
  it('requires an exchange rate for foreign balances, reusing the last known rate', () => {
    const sg = row({ id: 'sg', currency: 'SGD', fxRate: 65 });
    expect(buildChanges([sg], { sg: { amount: '100' } }, today).changes[0]).toMatchObject({
      amount: 100,
      fxRate: 65,
    });
    expect(
      buildChanges(
        [row({ id: 'x', currency: 'SGD', fxRate: null })],
        { x: { amount: '100' } },
        today,
      ).errors.x,
    ).toMatch(/SGD/);
    expect(
      buildChanges([sg], { sg: { amount: '100', fxRate: '70.5' } }, today).changes[0],
    ).toMatchObject({ fxRate: 70.5 });
  });
  it('records interest-rate and FD status changes only when they differ', () => {
    const fd = row({ id: 'fd', mode: 'fd', status: 'matured_unconfirmed' });
    const acct = row({ id: 'acct', interestRate: 0.03 });
    const r = buildChanges(
      [fd, acct],
      { fd: { status: 'closed' }, acct: { interestRate: '3' } },
      today,
    );
    expect(r.changes).toEqual([{ assetId: 'fd', status: 'closed' }]);
    expect(buildChanges([acct], { acct: { interestRate: '2.5' } }, today).changes).toEqual([
      { assetId: 'acct', interestRate: 0.025 },
    ]);
  });
  it('clears a custom rate when the field is emptied', () => {
    const acct = row({ id: 'acct', interestRate: 0.03 });
    expect(buildChanges([acct], { acct: { interestRate: '' } }, today).changes).toEqual([
      { assetId: 'acct', interestRate: null },
    ]);
  });
});
