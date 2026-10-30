import { describe, expect, it } from 'vitest';
import { buildGuide, EMPTY_PROFILE, type Handbook, type HandbookInput } from '@fwos/core';
import {
  cardGroups,
  carers,
  firstToCall,
  handbookPages,
  incompleteNote,
  readPrefs,
  telHref,
  tickMap,
  tickWho,
} from './handbook-view';

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

/** A handbook as it was stored before the guide: plain sections only. */
function legacy(
  o: {
    contacts?: string[][];
    advisers?: string[][];
    where?: string[][];
    message?: string;
  } = {},
): Handbook {
  return {
    title: 'Sample family: family handbook',
    asOf: '2026-10-26',
    disclaimer: 'General guidance, not legal or tax advice.',
    sections: [
      {
        id: 'start',
        title: 'Read this first',
        ...(o.message ? { paragraphs: [o.message] } : {}),
        steps: ['Take a breath.', 'Find a trusted adult.', 'Do not sign anything.', 'Get copies.'],
      },
      { id: 'people', title: 'Who is who' },
      {
        id: 'call',
        title: 'Who to call and where things are',
        tables: [
          ...(o.contacts
            ? [
                {
                  title: 'Call these people first',
                  table: { headers: ['Name', 'Who', 'Phone', 'Note'], rows: o.contacts },
                },
              ]
            : []),
          ...(o.advisers
            ? [
                {
                  title: 'Advisers (lawyer, accountant, agents)',
                  table: { headers: ['Name', 'Role', 'Phone', 'Note'], rows: o.advisers },
                },
              ]
            : []),
          {
            title: 'Where things are',
            table: {
              headers: ['What', 'Where'],
              rows: o.where ?? [
                ['Will and estate papers', 'not recorded'],
                ['Bank locker', 'none recorded'],
                ['Passwords and logins', 'not recorded'],
                ['Phones, computers and other devices', 'not recorded'],
                ['Email accounts', 'not recorded'],
                ['Backup key', 'not recorded'],
              ],
            },
          },
        ],
      },
    ],
  };
}

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

describe('handbookPages (copies stored before the guide)', () => {
  it('says so when nobody to call and no place is written down', () => {
    const p = handbookPages(legacy());
    expect(p.noContacts).toBe(true);
    expect(p.call).toEqual([]);
    expect(p.missing).toBeGreaterThan(5);
    expect(p.start.steps.length).toBeGreaterThan(3);
    expect(incompleteNote(p)).toContain('no one to call first');
  });

  it('puts the people to call first, with dialable numbers, and the places that are written down', () => {
    const p = handbookPages(
      legacy({
        message: 'You are not alone.',
        contacts: [['Ravi', 'my brother', '+65 9000 0000', 'has the keys']],
        advisers: [['Meera', 'lawyer', '+65 6000 0000', '']],
        where: [
          ['Will and estate papers', 'Fireproof box in the study'],
          ['Bank locker', 'not recorded'],
        ],
      }),
    );
    expect(p.noContacts).toBe(false);
    expect(p.call[0]).toMatchObject({ name: 'Ravi', tel: 'tel:+6590000000' });
    expect(p.advisers[0]).toMatchObject({ name: 'Meera', relation: 'lawyer' });
    expect(p.start.message).toEqual(['You are not alone.']);
    expect(p.where[0]).toMatchObject({ where: 'Fireproof box in the study', missing: false });
    expect(p.where.some((w) => w.missing)).toBe(true);
  });

  it('leaves the first two sections out of the reference part, and copes with no sections', () => {
    const p = handbookPages(legacy());
    expect(p.rest.map((s) => s.id)).toEqual(['people']);
    expect(handbookPages({ title: 't', asOf: '2026-10-26', disclaimer: 'd' }).rest).toEqual([]);
  });

  it('has nothing to complain about when everything is written down', () => {
    expect(incompleteNote({ missing: 0, noContacts: false })).toBeNull();
  });
});

describe('the guide on the page', () => {
  const g = buildGuide({
    ...base,
    profile: {
      ...EMPTY_PROFILE,
      contacts: [
        { name: 'Ravi', relation: 'my brother', phone: '+65 9000 0000', note: '' },
        { name: 'Asha', relation: 'mother', phone: '+65 8000 0000', note: '' },
      ],
    },
    policies: [
      {
        kind: 'term',
        insurer: 'Sample Life',
        coverage: '',
        insured: ['Asha'],
        paidBy: null,
        renewalOn: null,
        expiresOn: null,
        nominee: 'Kiran',
        documents: null,
      },
    ],
  });

  it('names the first person to call with a number to dial', () => {
    expect(firstToCall(g)).toEqual({
      name: 'Ravi',
      phone: '+65 9000 0000',
      tel: 'tel:+6590000000',
    });
    expect(firstToCall({ contacts: [] })).toBeNull();
  });

  it('groups the cards, leaving out empty groups', () => {
    expect(cardGroups(g.cards).map((x) => x.kind)).toEqual(['insurer']);
  });

  it('lists who looks after the children, each person once', () => {
    expect(carers(g).map((c) => c.name)).toEqual(['Asha', 'Ravi']);
    expect(carers(g)[1]!.tel).toBe('tel:+6590000000');
  });

  it('says who ticked a step', () => {
    const viewers = new Set(['v1']);
    expect(tickWho('u1', 'u1', viewers)).toBe('you');
    expect(tickWho('v1', 'u1', viewers)).toBe('viewer');
    expect(tickWho('u2', 'u1', viewers)).toBe('member');
    expect(tickWho(null, null, viewers)).toBe('member');
    expect(
      tickMap(
        [{ key: 't:week:call', doneBy: 'u1', doneAt: '2026-10-30T01:00:00Z' }],
        'u1',
        viewers,
      ),
    ).toEqual({ 't:week:call': { who: 'you', at: '2026-10-30T01:00:00Z' } });
  });

  it('remembers reading choices, and falls back to the defaults on anything odd', () => {
    expect(readPrefs('{"lang":"hi","plain":true,"large":true}')).toEqual({
      lang: 'hi',
      plain: true,
      large: true,
    });
    expect(readPrefs(null)).toEqual({ lang: 'en', plain: false, large: false });
    expect(readPrefs('not json')).toEqual({ lang: 'en', plain: false, large: false });
    expect(readPrefs('{"lang":"fr"}').lang).toBe('en');
  });
});
