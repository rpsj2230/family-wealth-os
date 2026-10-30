import { describe, expect, it } from 'vitest';
import {
  alertContactView,
  alertContactsFromJson,
  alertDueDate,
  daysAbsent,
  familyAlert,
  inactivityDecision,
  inactivityWarning,
  normalisePhone,
  peopleList,
  warnDaysProblem,
  whatsAppNotActivated,
  type FamilyAlertInput,
  type InactivityState,
} from '../src/inactivity-alert';

const SEEN = '2026-10-01T10:00:00.000Z';
const at = (days: number, hours = 0) =>
  new Date(Date.parse(SEEN) + days * 86_400_000 + hours * 3_600_000).toISOString();

const state = (o: Partial<InactivityState> = {}): InactivityState => ({
  lastMemberSeen: SEEN,
  warnDays: 20,
  alertDays: 30,
  warnedAt: null,
  alertedAt: null,
  mode: 'inactive',
  released: false,
  now: at(10),
  contacts: 2,
  ...o,
});

describe('inactivityDecision', () => {
  it('sends nothing while the household is still using the portal', () => {
    expect(inactivityDecision(state({ now: at(10) }))).toBe('none');
    expect(inactivityDecision(state({ now: at(20) }))).toBe('none'); // exactly 20 days: not more than 20
  });

  it('warns the members once more than warnDays have passed', () => {
    expect(inactivityDecision(state({ now: at(20, 1) }))).toBe('warn');
    expect(inactivityDecision(state({ now: at(25) }))).toBe('warn');
  });

  it('does not warn twice in the same absence', () => {
    expect(inactivityDecision(state({ now: at(22), warnedAt: at(21) }))).toBe('none');
  });

  it('alerts the family once more than alertDays have passed, after a warning', () => {
    expect(inactivityDecision(state({ now: at(30) }))).toBe('warn'); // exactly 30 days: the handbook is not open yet
    expect(inactivityDecision(state({ now: at(30, 1), warnedAt: at(21) }))).toBe('alert');
  });

  it('still sends an overdue alert when the job missed days or the warning never went (alert only)', () => {
    expect(inactivityDecision(state({ now: at(45) }))).toBe('alert');
    expect(inactivityDecision(state({ now: at(45), warnedAt: at(21) }))).toBe('alert');
  });

  it('does not alert twice in the same absence', () => {
    expect(inactivityDecision(state({ now: at(40), warnedAt: at(21), alertedAt: at(31) }))).toBe(
      'none',
    );
  });

  it('ignores stamps from an earlier absence (older than the last visit)', () => {
    const old = '2026-09-01T00:00:00.000Z';
    expect(inactivityDecision(state({ now: at(21), warnedAt: old, alertedAt: old }))).toBe('warn');
    expect(inactivityDecision(state({ now: at(31), warnedAt: old, alertedAt: old }))).toBe('alert');
  });

  it('is off while nobody is saved to be told', () => {
    expect(inactivityDecision(state({ now: at(45), contacts: 0 }))).toBe('none');
  });

  it('alerts in every mode: always, inactive, manual (released or not)', () => {
    for (const mode of ['always', 'inactive', 'manual'] as const)
      for (const released of [true, false])
        expect(inactivityDecision(state({ now: at(31), mode, released }))).toBe('alert');
  });

  it('never warns when the warning would not come before the alert', () => {
    expect(inactivityDecision(state({ warnDays: 30, alertDays: 30, now: at(29, 23) }))).toBe(
      'none',
    );
  });

  it('sends nothing for unreadable dates', () => {
    expect(inactivityDecision(state({ lastMemberSeen: 'not a date', now: at(40) }))).toBe('none');
    expect(inactivityDecision(state({ now: 'later' }))).toBe('none');
  });
});

describe('dates and counts', () => {
  it('counts whole days of absence', () => {
    expect(daysAbsent(SEEN, at(20, 23))).toBe(20);
    expect(daysAbsent(SEEN, at(0))).toBe(0);
    expect(daysAbsent(SEEN, '2026-09-01T00:00:00Z')).toBe(0);
  });

  it('gives the date of the first 00:30 UTC run after the handbook opens', () => {
    // seen 1 Oct 10:00 + 30 days = 31 Oct 10:00, so the 1 Nov 00:30 run sends it
    expect(alertDueDate(SEEN, 30)).toBe('2026-11-01');
    // seen 1 Oct 00:10 + 30 days = 31 Oct 00:10: the 31 Oct 00:30 run already sends it
    expect(alertDueDate('2026-10-01T00:10:00Z', 30)).toBe('2026-10-31');
    // exactly on the run minute: not yet more than 30 days, so the next day
    expect(alertDueDate('2026-10-01T00:30:00Z', 30)).toBe('2026-11-01');
  });

  it('joins names in plain English', () => {
    expect(peopleList([])).toBe('');
    expect(peopleList(['Ragini'])).toBe('Ragini');
    expect(peopleList(['Ragini', 'Ravi'])).toBe('Ragini and Ravi');
    expect(peopleList(['Ragini', '', 'Ravi', 'Meera'])).toBe('Ragini, Ravi and Meera');
  });
});

describe('warnDaysProblem', () => {
  it('accepts a whole number from 3 to 365 that is below the alert days', () => {
    expect(warnDaysProblem(20, 30)).toBeNull();
    expect(warnDaysProblem(3, 30)).toBeNull();
  });
  it('refuses empty, fractional and out-of-range numbers', () => {
    expect(warnDaysProblem(null, 30)).toMatch(/3 to 365/);
    expect(warnDaysProblem(2, 30)).toMatch(/3 to 365/);
    expect(warnDaysProblem(366, 400)).toMatch(/3 to 365/);
    expect(warnDaysProblem(4.5, 30)).toMatch(/whole number/);
  });
  it('refuses a warning on or after the day the family is told', () => {
    expect(warnDaysProblem(30, 30)).toMatch(/fewer than the 30 days/);
    expect(warnDaysProblem(40, 30)).toMatch(/fewer than/);
  });
});

describe('alert contacts', () => {
  it('normalises WhatsApp numbers to + and digits, and refuses local numbers', () => {
    expect(normalisePhone('+65 9123 4567')).toBe('+6591234567');
    expect(normalisePhone('0065-9123-4567')).toBe('+6591234567');
    expect(normalisePhone('91234567')).toBe('');
    expect(normalisePhone('+12')).toBe('');
    expect(normalisePhone('+0 1234 5678')).toBe('');
    expect(normalisePhone('')).toBe('');
  });

  it('reads the saved list, drops broken entries and keeps at most five', () => {
    const raw = [
      {
        id: 'a',
        name: ' Ragini ',
        email: 'RAGINI@Example.com',
        phone: '+91 98200 00000',
        whatsappKey: '123456',
      },
      { name: 'Ravi', email: 'not an address', phone: '12345', whatsappKey: 'bad key!' },
      { name: '' },
      'junk',
      null,
      { name: 'C' },
      { name: 'D' },
      { name: 'E' },
      { name: 'F' },
    ];
    const cs = alertContactsFromJson(raw);
    expect(cs).toHaveLength(5);
    expect(cs[0]).toEqual({
      id: 'a',
      name: 'Ragini',
      email: 'ragini@example.com',
      phone: '+919820000000',
      whatsappKey: '123456',
    });
    expect(cs[1]).toEqual({ id: 'c2', name: 'Ravi', email: '', phone: '', whatsappKey: '' });
    expect(cs.map((c) => c.name)).toEqual(['Ragini', 'Ravi', 'C', 'D', 'E']);
    expect(alertContactsFromJson({})).toEqual([]);
  });

  it('never lets the key reach a page, and names the people whose WhatsApp is not activated', () => {
    const cs = alertContactsFromJson([
      { id: 'a', name: 'Ragini', phone: '+6591234567', whatsappKey: 'Key77zz' },
      { id: 'b', name: 'Ravi', phone: '+6598765432' },
      { id: 'c', name: 'Meera', email: 'm@example.com' },
    ]).map(alertContactView);
    expect(JSON.stringify(cs)).not.toContain('Key77zz');
    expect(cs[0]!.keySaved).toBe(true);
    expect(whatsAppNotActivated(cs)).toEqual(['Ravi']);
  });
});

describe('inactivityWarning', () => {
  const w = inactivityWarning({
    daysAbsent: 21,
    alertDate: '2026-11-01',
    contactNames: ['Ragini', 'Ravi'],
    appUrl: 'https://portal.example.com/',
  });
  it('asks, says when and who, and links to the sign-in page', () => {
    expect(w.subject).toBe('Are you all right? Sign in to the family portal to postpone');
    expect(w.text).toContain(
      'Are you all right?\n\nNobody has used the family portal for 21 days. Sign in to postpone — otherwise on 1 Nov 2026 Ragini and Ravi will be told how to open the family handbook.',
    );
    expect(w.text).toContain('Sign in: https://portal.example.com/login');
    expect(w.html).toContain('href="https://portal.example.com/login"');
  });
  it('escapes names in the HTML and has a fallback when no names are given', () => {
    const x = inactivityWarning({
      daysAbsent: 21,
      alertDate: '2026-11-01',
      contactNames: ['<b>'],
      appUrl: 'u',
    });
    expect(x.html).toContain('&lt;b&gt;');
    expect(x.html).not.toContain('<b><');
    const y = inactivityWarning({
      daysAbsent: 21,
      alertDate: '2026-11-01',
      contactNames: [],
      appUrl: 'u',
    });
    expect(y.text).toContain('the people you chose will be told');
  });
});

describe('familyAlert', () => {
  const input: FamilyAlertInput = {
    ownerName: 'Asha',
    appUrl: 'https://portal.example.com',
    familyLogins: ['family@example.com'],
    passwordWhere: 'In the 1Password family vault; Vikram knows the master password.',
    callFirst: { name: 'Ravi Menon', relation: 'my brother', phone: '+65 9000 0000' },
    mode: 'inactive',
    released: false,
    releaseBy: ['Asha', 'Vikram'],
    daysAbsent: 31,
  };

  it('explains, links, says how to sign in, where the password is kept and whom to call', () => {
    const a = familyAlert(input, { recipientName: 'Ragini' });
    expect(a.subject).toBe("Asha's family portal: how to open the family handbook");
    expect(a.text).toMatch(/^Dear Ragini,/);
    expect(a.text).toContain('Nobody from the household has signed in to it for 31 days');
    expect(a.text).toContain('1. Open the portal: https://portal.example.com/login');
    expect(a.text).toContain(
      'Sign in with the family login: family@example.com, and its password.',
    );
    expect(a.text).toContain(
      "Where the password is kept, in Asha's words: In the 1Password family vault",
    );
    expect(a.text).toContain('Forgot your password?');
    expect(a.text).toContain('the family handbook opens. It tells you what to do, step by step.');
    expect(a.text).toContain('Call first: Ravi Menon (my brother), +65 9000 0000.');
    expect(a.text).toContain('these messages stop');
    expect(a.html).toContain('href="https://portal.example.com/login"');
    expect(a.text).not.toMatch(/PDF|₹|\d{6,}/);
  });

  it('works without a family login, a password note or anyone to call', () => {
    const a = familyAlert({ ...input, familyLogins: [], passwordWhere: '', callFirst: null });
    expect(a.text).toMatch(/^Hello,/);
    expect(a.text).toContain('Sign in with the family login Asha set up for you');
    expect(a.text).not.toContain('Where the password is kept');
    expect(a.text).not.toContain('Call first');
  });

  it('lists several family logins', () => {
    const a = familyAlert({ ...input, familyLogins: ['a@example.com', 'b@example.com'] });
    expect(a.text).toContain('one of the family logins: a@example.com, b@example.com');
    expect(a.chat).toContain('a@example.com or b@example.com');
  });

  it('in "only when I release it" mode, says the handbook is locked and whom to ask; it never opens it', () => {
    const a = familyAlert({ ...input, mode: 'manual', released: false });
    expect(a.text).toContain(
      'kept locked until a household member releases it: ask Asha and Vikram',
    );
    expect(a.text).toContain('Nothing opens by itself.');
    expect(a.chat).toContain('locked until a household member releases it');
    const r = familyAlert({ ...input, mode: 'manual', released: true });
    expect(r.text).not.toContain('locked');
    const n = familyAlert({ ...input, mode: 'manual', releaseBy: [] });
    expect(n.text).toContain('releases it to sign in');
  });

  it('marks the members copy and the test', () => {
    const c = familyAlert(input, { copyOf: ['Ragini', 'Ravi'] });
    expect(c.subject).toMatch(/^Copy: /);
    expect(c.text).toMatch(
      /^A copy for the household: the message below went to Ragini and Ravi today/,
    );
    const t = familyAlert(input, { test: true });
    expect(t.subject).toMatch(/^\[TEST\] /);
    expect(t.text).toMatch(/^TEST: this is a test sent only to you/);
    expect(t.html).toContain('TEST: this is a test');
    expect(t.chat).toMatch(/^TEST/);
    const blank = familyAlert(input, { copyOf: [] });
    expect(blank.text).toContain('went to the people you chose today');
  });

  it('keeps the WhatsApp version short and leaves the password note to the e-mail when one goes too', () => {
    const both = familyAlert(input, { recipientName: 'Ragini', emailToo: true });
    expect(both.chat).toContain('Open: https://portal.example.com/login');
    expect(both.chat).toContain('The e-mail sent to you says where the password is kept.');
    expect(both.chat).not.toContain('1Password');
    expect(both.chat.length).toBeLessThan(1000);
    const only = familyAlert(input, { recipientName: 'Ragini' });
    expect(only.chat).toContain('1Password');
    const noLogin = familyAlert({ ...input, familyLogins: [], passwordWhere: '' });
    expect(noLogin.chat).toContain('Sign in with the family login Asha set up for you.');
  });

  it('shortens a long password note and escapes HTML', () => {
    const a = familyAlert({ ...input, ownerName: '', passwordWhere: `<i>${'x'.repeat(400)}` });
    expect(a.text).toContain('…');
    expect(a.html).toContain('&lt;i&gt;');
    expect(a.subject).toContain("The household's family portal");
    expect(a.text).toContain("from the household's family portal");
  });
});
