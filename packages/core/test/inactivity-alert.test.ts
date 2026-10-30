import { describe, expect, it } from 'vitest';
import {
  alertContactView,
  alertContactsFromJson,
  alertSettingsProblem,
  chainOf,
  confirmedNote,
  daysAbsent,
  escalationDays,
  familyAlert,
  inactivityStep,
  inactivityWarning,
  lastChain,
  normalisePhone,
  peopleList,
  runDateAfter,
  unreachable,
  whatsAppNotActivated,
  type ChainEntry,
  type FamilyAlertInput,
  type InactivityState,
} from '../src/inactivity-alert';

const SEEN = '2026-10-01T00:20:00.000Z';
const DAY = 86_400_000;
/** the daily run `d` days after the last visit, at 00:30 UTC give or take a few minutes */
const run = (d: number, minutes = 0) =>
  new Date(Date.parse(SEEN) + d * DAY + (10 + minutes) * 60_000).toISOString();

const state = (o: Partial<InactivityState> = {}): InactivityState => ({
  lastMemberSeen: SEEN,
  warnDays: 20,
  alertDays: 30,
  reminders: 3,
  remindEveryDays: 2,
  warnedAt: null,
  alertedAt: null,
  contacts: 3,
  now: run(10),
  ...o,
});

const entry = (
  pos: number,
  sends: number,
  last: string,
  o: Partial<ChainEntry> = {},
): ChainEntry => ({
  absenceFrom: SEEN,
  pos,
  sends,
  firstSentAt: last,
  lastSentAt: last,
  confirmedAt: null,
  ...o,
});

/** Plays the daily job: one step per run, recorded the way the job records it. */
function simulate(
  days: number,
  o: Partial<InactivityState> = {},
  confirmAt?: { pos: number; day: number },
) {
  const log: ChainEntry[] = [];
  const steps: string[] = [];
  let s = state(o);
  for (let d = 0; d <= days; d++) {
    const now = run(d);
    if (confirmAt && d === confirmAt.day) {
      const e = log.find((x) => x.pos === confirmAt.pos);
      if (e) e.confirmedAt = now;
    }
    const st = inactivityStep({ ...s, now }, log);
    if (st.kind === 'warn') s = { ...s, warnedAt: now };
    if (st.kind === 'tell') {
      const e = log.find((x) => x.pos === st.pos);
      if (e) Object.assign(e, { sends: st.send, lastSentAt: now });
      else log.push(entry(st.pos, 1, now));
    }
    if (st.kind === 'confirmed' || st.kind === 'exhausted') s = { ...s, alertedAt: now };
    if (st.kind !== 'none')
      steps.push(`${d}:${st.kind}${st.kind === 'tell' ? `:${st.pos}/${st.send}` : ''}`);
  }
  return { steps, log, s };
}

describe('inactivityStep', () => {
  it('is off with nobody on the list, or unreadable dates', () => {
    expect(inactivityStep(state({ contacts: 0, now: run(40) }), [])).toEqual({
      kind: 'none',
      why: 'off',
    });
    expect(inactivityStep(state({ lastMemberSeen: 'x', now: run(40) }), [])).toMatchObject({
      why: 'off',
    });
    expect(inactivityStep(state({ now: 'later' }), [])).toMatchObject({ why: 'off' });
  });

  it('does nothing while the household uses the portal', () => {
    expect(inactivityStep(state({ now: run(10) }), [])).toEqual({ kind: 'none', why: 'active' });
    expect(inactivityStep(state({ now: run(20, -15) }), [])).toMatchObject({ why: 'active' });
  });

  it('warns the members once after warnDays', () => {
    expect(inactivityStep(state({ now: run(20) }), [])).toEqual({ kind: 'warn' });
    expect(inactivityStep(state({ now: run(22), warnedAt: run(20) }), [])).toMatchObject({
      why: 'active',
    });
  });

  it('never warns when the warning would not come before the first person is told', () => {
    expect(inactivityStep(state({ warnDays: 30, now: run(29) }), [])).toMatchObject({
      why: 'active',
    });
  });

  it('tells the first person after more than alertDays, warned or not (an overdue first message still goes)', () => {
    expect(inactivityStep(state({ now: run(30), warnedAt: run(20) }), [])).toEqual({
      kind: 'tell',
      pos: 0,
      send: 1,
    });
    expect(inactivityStep(state({ now: run(45) }), [])).toEqual({ kind: 'tell', pos: 0, send: 1 });
  });

  it('waits remindEveryDays between messages, allowing for a run that starts a little earlier', () => {
    const log = [entry(0, 1, run(30, 5))];
    expect(inactivityStep(state({ now: run(31) }), log)).toEqual({ kind: 'none', why: 'waiting' });
    expect(inactivityStep(state({ now: run(32, -3) }), log)).toEqual({
      kind: 'tell',
      pos: 0,
      send: 2,
    });
  });

  it('sends each reminder, then tells the next person, then the next', () => {
    expect(inactivityStep(state({ now: run(34) }), [entry(0, 2, run(32))])).toEqual({
      kind: 'tell',
      pos: 0,
      send: 3,
    });
    expect(inactivityStep(state({ now: run(36) }), [entry(0, 3, run(34))])).toEqual({
      kind: 'tell',
      pos: 0,
      send: 4,
    });
    expect(inactivityStep(state({ now: run(38) }), [entry(0, 4, run(36))])).toEqual({
      kind: 'tell',
      pos: 1,
      send: 1,
    });
    expect(
      inactivityStep(state({ now: run(46) }), [entry(0, 4, run(36)), entry(1, 4, run(44))]),
    ).toEqual({ kind: 'tell', pos: 2, send: 1 });
  });

  it('with no reminders, tells the next person one interval later', () => {
    expect(inactivityStep(state({ reminders: 0, now: run(32) }), [entry(0, 1, run(30))])).toEqual({
      kind: 'tell',
      pos: 1,
      send: 1,
    });
  });

  it('stops the chain as soon as anyone confirms, and says who', () => {
    const log = [entry(0, 4, run(36)), entry(1, 1, run(38), { confirmedAt: run(38, 300) })];
    expect(inactivityStep(state({ now: run(39) }), log)).toEqual({
      kind: 'confirmed',
      pos: 1,
      at: run(38, 300),
    });
    // a confirmation by an earlier person later on also stops it
    const late = [entry(0, 4, run(36), { confirmedAt: run(39) }), entry(1, 1, run(38))];
    expect(inactivityStep(state({ now: run(40) }), late)).toMatchObject({
      kind: 'confirmed',
      pos: 0,
    });
  });

  it('does nothing more once the chain is closed', () => {
    const log = [entry(0, 1, run(30), { confirmedAt: run(31) })];
    expect(inactivityStep(state({ now: run(33), alertedAt: run(32) }), log)).toEqual({
      kind: 'none',
      why: 'closed',
    });
  });

  it('says the list is used up when the last person had every reminder and nobody confirmed', () => {
    const log = [entry(0, 4, run(36)), entry(1, 4, run(44)), entry(2, 4, run(52))];
    expect(inactivityStep(state({ now: run(54) }), log)).toEqual({ kind: 'exhausted' });
    // a person removed from the list mid-chain: the chain does not run past the end
    expect(inactivityStep(state({ contacts: 2, now: run(54) }), log)).toEqual({
      kind: 'exhausted',
    });
  });

  it('a member coming back ends the chain: the old entries and stamps belong to the earlier absence', () => {
    const back = '2026-11-05T09:00:00.000Z';
    const log = [entry(0, 4, run(36)), entry(1, 2, run(40))];
    expect(
      inactivityStep(
        state({
          lastMemberSeen: back,
          now: '2026-11-06T00:30:00Z',
          warnedAt: run(20),
          alertedAt: null,
        }),
        log,
      ),
    ).toEqual({ kind: 'none', why: 'active' });
    // and a closed earlier chain does not block the next one
    expect(
      inactivityStep(
        state({ lastMemberSeen: back, now: '2026-12-15T00:30:00Z', alertedAt: run(33) }),
        log,
      ),
    ).toEqual({ kind: 'tell', pos: 0, send: 1 });
  });

  it('day by day: one step per run, never two messages to anyone on one run, nobody skipped', () => {
    const { steps, s } = simulate(70);
    expect(steps).toEqual([
      '20:warn',
      '30:tell:0/1',
      '32:tell:0/2',
      '34:tell:0/3',
      '36:tell:0/4',
      '38:tell:1/1',
      '40:tell:1/2',
      '42:tell:1/3',
      '44:tell:1/4',
      '46:tell:2/1',
      '48:tell:2/2',
      '50:tell:2/3',
      '52:tell:2/4',
      '54:exhausted',
    ]);
    expect(s.alertedAt).toBe(run(54));
  });

  it('day by day with a confirmation: the next run notes it and nothing more is sent', () => {
    const { steps } = simulate(70, {}, { pos: 1, day: 40 });
    expect(steps[steps.length - 1]).toBe('40:confirmed');
    expect(steps.filter((x) => x.includes('tell'))).toHaveLength(5);
  });

  it('missed job days do not bunch messages: the next run takes one step and the rest follow', () => {
    // the job did not run between day 31 and day 50
    const log = [entry(0, 1, run(31))];
    expect(inactivityStep(state({ now: run(50) }), log)).toEqual({ kind: 'tell', pos: 0, send: 2 });
    log[0] = entry(0, 2, run(50));
    expect(inactivityStep(state({ now: run(51) }), log)).toMatchObject({ why: 'waiting' });
  });
});

describe('chainOf and lastChain', () => {
  const other = '2026-08-01T00:00:00.000Z';
  const log = [
    entry(1, 1, run(39)),
    entry(0, 4, run(37)),
    entry(0, 2, '2026-09-05T00:30:00Z', { absenceFrom: other }),
  ];
  it('keeps only this absence, in order', () => {
    expect(chainOf(log, SEEN).map((e) => e.pos)).toEqual([0, 1]);
    expect(chainOf(log, other)).toHaveLength(1);
  });
  it('names the people of the latest chain from the current list', () => {
    const v = lastChain(log, ['Ragini'])!;
    expect(v.absenceFrom).toBe(SEEN);
    expect(v.people.map((x) => [x.name, x.sends])).toEqual([
      ['Ragini', 4],
      ['Person 2 (no longer on the list)', 1],
    ]);
    expect(lastChain([], [])).toBeNull();
  });
});

describe('dates, counts and names', () => {
  it('counts whole days of absence', () => {
    expect(daysAbsent(SEEN, run(20))).toBe(20);
    expect(daysAbsent(SEEN, SEEN)).toBe(0);
    expect(daysAbsent(SEEN, '2026-09-01T00:00:00Z')).toBe(0);
  });
  it('gives the date of the first 00:30 UTC run after the days have passed', () => {
    expect(runDateAfter('2026-10-01T10:00:00Z', 30)).toBe('2026-11-01');
    expect(runDateAfter('2026-10-01T00:10:00Z', 30)).toBe('2026-10-31');
    expect(runDateAfter('2026-10-01T00:30:00Z', 30)).toBe('2026-11-01');
  });
  it('joins names in plain English', () => {
    expect(peopleList([])).toBe('');
    expect(peopleList(['Ragini'])).toBe('Ragini');
    expect(peopleList(['Ragini', 'Ravi'])).toBe('Ragini and Ravi');
    expect(peopleList(['Ragini', '', 'Ravi', 'Meera'])).toBe('Ragini, Ravi and Meera');
  });
  it('works out the days from one person to the next', () => {
    expect(escalationDays(3, 2)).toBe(8);
    expect(escalationDays(0, 1)).toBe(1);
  });
});

describe('alertSettingsProblem', () => {
  const ok = { warnDays: 20, reminders: 3, remindEveryDays: 2 };
  it('accepts sensible numbers', () => {
    expect(alertSettingsProblem(ok, 30)).toBeNull();
    expect(alertSettingsProblem({ warnDays: 3, reminders: 0, remindEveryDays: 14 }, 30)).toBeNull();
  });
  it('refuses a warning outside 3 to 365, fractional, or not before the first message', () => {
    expect(alertSettingsProblem({ ...ok, warnDays: null }, 30)).toMatch(/3 to 365/);
    expect(alertSettingsProblem({ ...ok, warnDays: 2 }, 30)).toMatch(/3 to 365/);
    expect(alertSettingsProblem({ ...ok, warnDays: 4.5 }, 30)).toMatch(/whole number/);
    expect(alertSettingsProblem({ ...ok, warnDays: 30 }, 30)).toMatch(/fewer than the 30 days/);
  });
  it('refuses reminders outside 0 to 10 and intervals outside 1 to 14', () => {
    expect(alertSettingsProblem({ ...ok, reminders: 11 }, 30)).toMatch(/Reminders/);
    expect(alertSettingsProblem({ ...ok, reminders: null }, 30)).toMatch(/Reminders/);
    expect(alertSettingsProblem({ ...ok, remindEveryDays: 0 }, 30)).toMatch(/between reminders/);
    expect(alertSettingsProblem({ ...ok, remindEveryDays: 15 }, 30)).toMatch(/between reminders/);
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

  it('reads the saved list in order, drops broken entries and keeps at most ten', () => {
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
      ...'CDEFGHIJKL'.split('').map((name) => ({ name })),
    ];
    const cs = alertContactsFromJson(raw);
    expect(cs).toHaveLength(10);
    expect(cs[0]).toEqual({
      id: 'a',
      name: 'Ragini',
      email: 'ragini@example.com',
      phone: '+919820000000',
      whatsappKey: '123456',
    });
    expect(cs[1]).toEqual({ id: 'c2', name: 'Ravi', email: '', phone: '', whatsappKey: '' });
    expect(cs.map((c) => c.name).join('')).toBe('RaginiRaviCDEFGHIJ');
    expect(alertContactsFromJson({})).toEqual([]);
  });

  it('never lets the key reach a page, and names who is not activated or not reachable', () => {
    const cs = alertContactsFromJson([
      { id: 'a', name: 'Ragini', phone: '+6591234567', whatsappKey: 'Key77zz' },
      { id: 'b', name: 'Ravi', phone: '+6598765432' },
      { id: 'c', name: 'Meera', email: 'm@example.com' },
    ]).map(alertContactView);
    expect(JSON.stringify(cs)).not.toContain('Key77zz');
    expect(cs[0]!.keySaved).toBe(true);
    expect(whatsAppNotActivated(cs)).toEqual(['Ravi']);
    expect(unreachable(cs)).toEqual(['Ravi']);
  });
});

describe('inactivityWarning', () => {
  const input = {
    daysAbsent: 21,
    alertDate: '2026-11-01',
    contactNames: ['Ragini', 'Ravi'],
    reminders: 3,
    remindEveryDays: 2,
    appUrl: 'https://portal.example.com/',
    postponeToken: 'tok_abc',
  };
  it('asks, says when the first person is told, and carries the postpone link', () => {
    const w = inactivityWarning(input);
    expect(w.subject).toBe('Are you all right? Sign in to the family portal to postpone');
    expect(w.text).toContain(
      'Are you all right?\n\nNobody has used the family portal for 21 days. Sign in to postpone — otherwise on 1 Nov 2026 Ragini will be told how to open the family handbook.',
    );
    expect(w.text).toContain("I'm fine — postpone: https://portal.example.com/postpone/tok_abc");
    expect(w.text).toContain('Or sign in: https://portal.example.com/login');
    expect(w.text).toContain(
      'If Ragini does not confirm receiving it, Ragini is reminded 3 times, 2 days apart, and 8 days after the first message Ravi is told the same way',
    );
    expect(w.html).toContain('href="https://portal.example.com/postpone/tok_abc"');
  });
  it('covers one reminder a day, no reminders, one person, no names, and escapes HTML', () => {
    expect(inactivityWarning({ ...input, reminders: 1, remindEveryDays: 1 }).text).toContain(
      'is reminded once, a day apart, and 2 days after',
    );
    expect(inactivityWarning({ ...input, reminders: 0 }).text).toContain(
      'Ragini 2 days after the first message Ravi',
    );
    expect(inactivityWarning({ ...input, contactNames: ['Ragini'], reminders: 0 }).text).toContain(
      'Ragini is told only once, and nobody else is told',
    );
    expect(inactivityWarning({ ...input, contactNames: ['Ragini'] }).text).toContain(
      'apart, and nobody else is told: the list has one person.',
    );
    expect(inactivityWarning({ ...input, contactNames: [] }).text).toContain(
      'the first person on your list will be told',
    );
    expect(inactivityWarning({ ...input, contactNames: ['<b>'] }).html).toContain('&lt;b&gt;');
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

  it('explains, asks for the confirmation, links, says how to sign in, where the password is kept and whom to call', () => {
    const a = familyAlert(input, { recipientName: 'Ragini', confirmToken: 'tokXYZ' });
    expect(a.subject).toBe("Asha's family portal: how to open the family handbook");
    expect(a.text).toMatch(/^Dear Ragini,/);
    expect(a.text).toContain('Nobody from the household has signed in to it for 31 days');
    expect(a.text).toContain(
      'Please let the portal know you have received this: https://portal.example.com/confirm/tokXYZ',
    );
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
    expect(a.html).toContain('href="https://portal.example.com/confirm/tokXYZ"');
    expect(a.html).toContain('I have received this');
    expect(a.chat).toContain(
      'Please confirm you have received this: https://portal.example.com/confirm/tokXYZ',
    );
    expect(a.text).not.toMatch(/PDF|₹|\d{6,}/);
  });

  it('marks reminders', () => {
    const r = familyAlert(input, {
      recipientName: 'Ragini',
      confirmToken: 't',
      send: 3,
      reminders: 3,
    });
    expect(r.subject).toBe("Reminder: Asha's family portal: how to open the family handbook");
    expect(r.text).toContain('Reminder 2 of 3: nobody has confirmed this message yet.');
    expect(r.html).toContain('Reminder 2 of 3');
    expect(r.chat).toContain('Reminder 2 of 3');
    expect(familyAlert(input, { send: 2 }).text).toContain('Reminder 1: nobody');
  });

  it('works without a confirmation link, a family login, a password note or anyone to call', () => {
    const a = familyAlert({ ...input, familyLogins: [], passwordWhere: '', callFirst: null });
    expect(a.text).toMatch(/^Hello,/);
    expect(a.text).not.toContain('/confirm/');
    expect(a.text).toContain('Sign in with the family login Asha set up for you');
    expect(a.text).not.toContain('Where the password is kept');
    expect(a.text).not.toContain('Call first');
    expect(a.chat).toContain('Sign in with the family login Asha set up for you.');
    const c = familyAlert({ ...input, callFirst: { name: 'Ravi', relation: '', phone: '' } });
    expect(c.text).toContain('Call first: Ravi.');
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
    expect(a.chat).toContain('locked until a household member releases it: ask Asha and Vikram');
    expect(familyAlert({ ...input, mode: 'manual', released: true }).text).not.toContain('locked');
    expect(familyAlert({ ...input, mode: 'manual', releaseBy: [] }).text).toContain(
      'releases it to sign in',
    );
    expect(familyAlert({ ...input, mode: 'manual', releaseBy: [] }).chat).toContain('releases it.');
  });

  it('marks the members copy and the test', () => {
    const c = familyAlert(input, { copyOf: 'Ragini' });
    expect(c.subject).toMatch(/^Copy: /);
    expect(c.text).toMatch(/^A copy for the household: the message below went to Ragini today\./);
    expect(familyAlert(input, { copyOf: 'Ragini', send: 2 }).text).toContain('today (reminder 1)');
    const t = familyAlert(input, { test: true, confirmToken: 'test' });
    expect(t.subject).toMatch(/^\[TEST\] /);
    expect(t.text).toMatch(/^TEST: this is a test sent only to you/);
    expect(t.html).toContain('TEST: this is a test');
    expect(t.chat).toMatch(/^TEST/);
  });

  it('keeps the WhatsApp version short and leaves the password note to the e-mail when one goes too', () => {
    const both = familyAlert(input, {
      recipientName: 'Ragini',
      emailToo: true,
      confirmToken: 'x'.repeat(43),
    });
    expect(both.chat).toContain('Open: https://portal.example.com/login');
    expect(both.chat).toContain('The e-mail sent to you says where the password is kept.');
    expect(both.chat).not.toContain('1Password');
    expect(both.chat.length).toBeLessThan(1000);
    expect(familyAlert(input, { recipientName: 'Ragini' }).chat).toContain('1Password');
  });

  it('shortens a long password note, escapes HTML and has a fallback for the owner', () => {
    const a = familyAlert({ ...input, ownerName: '', passwordWhere: `<i>${'x'.repeat(400)}` });
    expect(a.text).toContain('…');
    expect(a.html).toContain('&lt;i&gt;');
    expect(a.subject).toContain("The household's family portal");
    expect(a.text).toContain("from the household's family portal");
  });
});

describe('confirmedNote', () => {
  it('tells the members who confirmed and when, for the record', () => {
    const n = confirmedNote({
      name: 'Ragini',
      at: '2026-11-02T03:00:00Z',
      appUrl: 'https://portal.example.com',
    });
    expect(n.subject).toBe('Ragini confirmed the family portal message');
    expect(n.text).toContain(
      'Ragini confirmed on 2 Nov 2026 that they received the message about the family handbook.',
    );
    expect(n.text).toContain('Nobody else will be told during this absence.');
    expect(n.html).toContain('href="https://portal.example.com/login"');
  });
});
