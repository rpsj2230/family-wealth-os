import { describe, expect, it } from 'vitest';
import { diffRow, rowProblems, suggestKinds, swapNames, type EditRow } from './account-edit';

const row = (o: Partial<EditRow> & { id: string }): EditRow => ({
  bankKey: 'b1',
  kind: 'cash',
  ownerId: 'p1',
  institutionId: 'b1',
  label: '',
  accountKind: '',
  isJoint: false,
  jointHolderId: '',
  last4: '',
  linkedLast4: '',
  notes: '',
  status: 'active',
  holderName: '',
  inferred: '',
  fdRate: '',
  fdBookedOn: '',
  fdMaturityOn: '',
  fdPrincipal: '',
  fdMaturityAmount: '',
  fdRefLast4: '',
  ...o,
});

describe('diffRow', () => {
  it('sends only what changed, in the shape the database takes', () => {
    const was = row({
      id: 'a',
      kind: 'fd',
      fdRate: '7',
      fdPrincipal: '1000000',
      fdMaturityAmount: '1200000',
    });
    const now = {
      ...was,
      accountKind: 'NRE',
      isJoint: true,
      notes: ' AMB 10k ',
      fdRate: '7.25',
      fdMaturityAmount: '',
    };
    expect(diffRow(now, was)).toEqual({
      id: 'a',
      accountKind: 'NRE',
      isJoint: true,
      notes: 'AMB 10k',
      fdRate: 0.0725,
      fdMaturityAmount: null,
    });
  });
  it('returns nothing when nothing changed, and clears with null', () => {
    const was = row({ id: 'a', notes: 'x', accountKind: 'NRO' });
    expect(diffRow({ ...was }, was)).toBeNull();
    expect(diffRow({ ...was, notes: '', accountKind: '' }, was)).toEqual({
      id: 'a',
      notes: null,
      accountKind: null,
    });
  });
  it('reads amounts typed with signs and commas', () => {
    const was = row({ id: 'a', kind: 'fd', fdPrincipal: '1' });
    expect(diffRow({ ...was, fdPrincipal: '₹10,00,000' }, was)).toEqual({
      id: 'a',
      fdPrincipal: 1_000_000,
    });
  });
});

describe('rowProblems', () => {
  it('finds what the database would refuse', () => {
    expect(rowProblems(row({ id: 'a', last4: '12345' }))).toHaveLength(1);
    const fd = row({
      id: 'b',
      kind: 'fd',
      fdRate: '35',
      fdBookedOn: '2026-05-01',
      fdMaturityOn: '2026-04-01',
      fdPrincipal: '0',
    });
    expect(rowProblems(fd)).toHaveLength(3);
    expect(rowProblems(row({ id: 'c', last4: '0266' }))).toEqual([]);
  });
});

describe('suggestKinds', () => {
  it('gives a deposit the type of the savings account it is linked to', () => {
    const rows = [
      row({ id: 'c1', accountKind: 'NRE', last4: '0266' }),
      row({ id: 'c2', accountKind: 'NRO', last4: '0278' }),
      row({ id: 'f1', kind: 'fd', linkedLast4: '0278' }),
    ];
    expect(suggestKinds(rows)).toEqual({ f1: 'NRO' });
  });
  it('falls back to the one type the person has at that bank, and stays silent when they disagree', () => {
    const same = [row({ id: 'c1', accountKind: 'NRE' }), row({ id: 'f1', kind: 'fd' })];
    expect(suggestKinds(same)).toEqual({ f1: 'NRE' });
    const mixed = [
      row({ id: 'c1', accountKind: 'NRE' }),
      row({ id: 'c2', accountKind: 'NRO' }),
      row({ id: 'f1', kind: 'fd' }),
    ];
    expect(suggestKinds(mixed)).toEqual({});
  });
  it('ignores other people and other banks, and never changes a typed row', () => {
    const rows = [
      row({ id: 'c1', accountKind: 'NRE', ownerId: 'p2' }),
      row({ id: 'c2', accountKind: 'NRO', bankKey: 'b2' }),
      row({ id: 'f1', kind: 'fd' }),
    ];
    expect(suggestKinds(rows)).toEqual({});
    expect(suggestKinds([row({ id: 'f2', kind: 'fd', accountKind: 'NRO' })])).toEqual({});
  });
});

describe('joint holders', () => {
  it('sends the second name only when it changes, and clears it when the account stops being joint', () => {
    const was = row({ id: 'a', ownerId: 'r', isJoint: true, jointHolderId: '' });
    expect(diffRow({ ...was, jointHolderId: 'g' }, was)).toEqual({ id: 'a', jointHolderId: 'g' });
    const joint = { ...was, jointHolderId: 'g' };
    expect(diffRow({ ...joint, isJoint: false, jointHolderId: '' }, joint)).toEqual({
      id: 'a',
      isJoint: false,
      jointHolderId: null,
    });
  });
  it('swaps the first and second name, and refuses the same person twice', () => {
    const r = row({ id: 'a', ownerId: 'r', isJoint: true, jointHolderId: 'g' });
    expect(swapNames(r)).toEqual({ ownerId: 'g', jointHolderId: 'r' });
    expect(swapNames(row({ id: 'b', ownerId: 'r', isJoint: true }))).toBeNull();
    expect(swapNames(row({ id: 'c', ownerId: 'r' }))).toBeNull();
    expect(rowProblems({ ...r, jointHolderId: 'r' }).join(' ')).toMatch(/different person/);
  });
});
