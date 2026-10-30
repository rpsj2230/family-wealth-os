import { describe, expect, it } from 'vitest';
import {
  chainEntryOf,
  countFamilyLogins,
  inactivityRowOf,
  loadAlertFacts,
} from '../src/inactivity';
import { fakeDb } from './fake-db';

describe('inactivity data', () => {
  it('reads the row with defaults for an older row, and keeps the key only on the server side', () => {
    const r = inactivityRowOf({
      household_id: 'h',
      mode: 'manual',
      inactive_days: 45,
      last_member_seen: '2026-10-01 00:20:00.123456+00',
      alert_contacts: [{ id: 'a', name: 'Ragini', email: 'r@example.com', whatsappKey: 'K1234' }],
    });
    expect(r).toMatchObject({
      mode: 'manual',
      inactiveDays: 45,
      warnDays: 20,
      warnEveryDays: 1,
      reminders: 3,
      remindEveryDays: 2,
      released: false,
      warnedAt: null,
      lastMemberSeen: '2026-10-01 00:20:00.123456+00',
    });
    expect(r.contacts[0]!.whatsappKey).toBe('K1234');
    expect(inactivityRowOf({ mode: 'odd' }).mode).toBe('always');
  });

  it('reads a log line', () => {
    expect(
      chainEntryOf({
        absence_from: 'a',
        contact_pos: 2,
        sends: 3,
        first_sent_at: 'f',
        last_sent_at: 'l',
        confirmed_at: null,
      }),
    ).toEqual({
      absenceFrom: 'a',
      pos: 2,
      sends: 3,
      firstSentAt: 'f',
      lastSentAt: 'l',
      confirmedAt: null,
    });
  });

  it('finds who kept the records, the family login, where the password is, whom to call first', async () => {
    const { db } = fakeDb({
      households: [{ id: 'h', name: 'Menon family' }],
      owners: [
        { household_id: 'h', display_name: 'Vikram', plan_role: 'spouse', is_minor: false },
        { household_id: 'h', display_name: 'Asha', plan_role: 'primary', is_minor: false },
        { household_id: 'h', display_name: 'Kiran', plan_role: null, is_minor: true },
        { household_id: 'other', display_name: 'Stranger', plan_role: 'primary', is_minor: false },
      ],
      emergency_profile: [
        {
          household_id: 'h',
          content: {
            passwordManager: 'In the family vault',
            contacts: [
              { name: 'Ravi Menon', relation: 'brother', phone: '+65 9000 0000', note: '' },
            ],
          },
        },
      ],
      household_members: [
        { household_id: 'h', user_id: 'u1', role: 'admin' },
        { household_id: 'h', user_id: 'u9', role: 'emergency_viewer' },
      ],
    });
    const asked: string[][] = [];
    const f = await loadAlertFacts(db, 'h', {
      loginEmails: async (ids) => {
        asked.push(ids);
        return [' Family@Example.com ', 'family@example.com'];
      },
    });
    expect(asked).toEqual([['u9']]);
    expect(f).toEqual({
      ownerName: 'Asha',
      familyLogins: ['family@example.com'],
      passwordWhere: 'In the family vault',
      callFirst: { name: 'Ravi Menon', relation: 'brother', phone: '+65 9000 0000' },
      releaseBy: ['Vikram', 'Asha'],
    });
    expect(await countFamilyLogins(db, 'h')).toBe(1);
  });

  it('falls back to the household name and says nothing about a login it cannot read', async () => {
    const { db } = fakeDb({ households: [{ id: 'h', name: 'Menon family' }] });
    const f = await loadAlertFacts(db, 'h');
    expect(f).toEqual({
      ownerName: 'Menon family',
      familyLogins: [],
      passwordWhere: '',
      callFirst: null,
      releaseBy: [],
    });
    expect(await countFamilyLogins(db, 'h')).toBe(0);
  });
});
