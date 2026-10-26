import { describe, expect, it } from 'vitest';
import { buildHandbook, EMPTY_PROFILE, type HandbookInput } from '@fwos/core';
import { handbookPages, incompleteNote, telHref } from './handbook-view';

const base: HandbookInput = {
  asOf: '2026-10-26',
  householdName: 'Sample family',
  people: [
    {
      name: 'Asha',
      dob: '1980-01-02',
      isMinor: false,
      guardian: null,
      panLast4: '1234',
      residency: 'NRI',
    },
    {
      name: 'Kiran',
      dob: '2012-05-06',
      isMinor: true,
      guardian: 'Asha',
      panLast4: null,
      residency: null,
    },
  ],
  profile: EMPTY_PROFILE,
  banks: [],
  ownerName: {},
  funds: [],
  heldByOthers: [],
  policies: [],
  property: [],
  owedToUs: [],
};

describe('telHref', () => {
  it('keeps a leading plus and digits only', () => {
    expect(telHref('+65 9000 0000')).toBe('tel:+6590000000');
    expect(telHref('(011) 2345-6789')).toBe('tel:01123456789');
  });
  it('takes the first number when several are given', () => {
    expect(telHref('+91 98100 00000 / +91 98100 11111')).toBe('tel:+919810000000');
  });
  it('does not dial text', () => {
    expect(telHref('ask the neighbour')).toBeNull();
    expect(telHref('')).toBeNull();
  });
});

describe('handbookPages', () => {
  it('says so when nobody to call and no place is written down', () => {
    const p = handbookPages(buildHandbook(base));
    expect(p.noContacts).toBe(true);
    expect(p.call).toEqual([]);
    expect(p.missing).toBeGreaterThan(5);
    expect(p.start.steps.length).toBeGreaterThan(3);
    expect(incompleteNote(p)).toContain('no one to call first');
  });

  it('puts the people to call first, with dialable numbers, and the places that are written down', () => {
    const doc = buildHandbook({
      ...base,
      profile: {
        ...EMPTY_PROFILE,
        message: 'You are not alone.',
        contacts: [
          { name: 'Ravi', relation: 'my brother', phone: '+65 9000 0000', note: 'has the keys' },
        ],
        advisors: [{ name: 'Meera', relation: 'lawyer', phone: '+65 6000 0000', note: '' }],
        willLocation: 'Fireproof box in the study',
      },
    });
    const p = handbookPages(doc);
    expect(p.noContacts).toBe(false);
    expect(p.call[0]).toMatchObject({ name: 'Ravi', tel: 'tel:+6590000000' });
    expect(p.advisers[0]).toMatchObject({ name: 'Meera', relation: 'lawyer' });
    expect(p.start.message).toEqual(['You are not alone.']);
    const will = p.where.find((w) => w.what.startsWith('Will'))!;
    expect(will).toMatchObject({ where: 'Fireproof box in the study', missing: false });
    expect(p.where.some((w) => w.missing)).toBe(true);
  });

  it('leaves the first two sections out of the reference part', () => {
    const p = handbookPages(buildHandbook(base));
    expect(p.rest.map((s) => s.id)).not.toContain('start');
    expect(p.rest.map((s) => s.id)).not.toContain('call');
    expect(p.rest.map((s) => s.id)).toContain('people');
  });

  it('has nothing to complain about when everything is written down', () => {
    expect(incompleteNote({ missing: 0, noContacts: false })).toBeNull();
  });
});
