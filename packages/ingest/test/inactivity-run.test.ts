import { describe, expect, it } from 'vitest';
import type { ChainEntry, StoredAlertContact } from '@fwos/core';
import { alertLinkKey, alertToken, hashToken } from '../src/alert-tokens';
import {
  cleanEmails,
  emailChannel,
  lineOf,
  runInactivity,
  whatsappChannel,
  type InactivityRunRow,
  type InactivityStore,
} from '../src/inactivity-run';

const SECRET = 'service-role-key-for-tests-only';
const H = 'hh-1';
const SEEN = '2026-10-01T00:20:00.000Z';
const DAY = 86_400_000;
const run = (d: number) => new Date(Date.parse(SEEN) + d * DAY + 10 * 60_000).toISOString();
const APP = 'https://portal.example.com';

const people: StoredAlertContact[] = [
  {
    id: 'a',
    name: 'Ragini',
    email: 'ragini@example.com',
    phone: '+6591234567',
    whatsappKey: 'K1234',
  },
  { id: 'b', name: 'Ravi', email: 'ravi@example.com', phone: '', whatsappKey: '' },
  { id: 'c', name: 'Meera', email: '', phone: '+6598765432', whatsappKey: '' },
];

function world(
  o: Partial<InactivityRunRow> = {},
  members = ['owner@example.com', 'RAGINI@example.com', '', 'owner@example.com'],
) {
  const row: InactivityRunRow = {
    householdId: H,
    mode: 'inactive',
    inactiveDays: 30,
    warnDays: 20,
    warnEveryDays: 1,
    reminders: 3,
    remindEveryDays: 2,
    released: false,
    lastMemberSeen: SEEN,
    warnedAt: null,
    alertedAt: null,
    contacts: people,
    ...o,
  };
  const log: (ChainEntry & { tokenHash: string })[] = [];
  const mails: { to: string[]; subject: string; text: string; html: string }[] = [];
  const chats: { phone: string; key: string; text: string }[] = [];
  const lines: string[] = [];
  const db = { postponeHash: null as string | null, closedAt: null as string | null };
  let failMail = false;
  let refuseStart = false;
  const store: InactivityStore = {
    rows: async () => [row],
    chain: async () => log.map((e) => ({ ...e })),
    memberEmails: async () => members,
    facts: async () => ({
      ownerName: 'Asha',
      familyLogins: ['family@example.com'],
      passwordWhere: 'In the family vault',
      callFirst: { name: 'Ravi Menon', relation: 'brother', phone: '+65 9000 0000' },
      releaseBy: ['Asha'],
    }),
    async claimWarn(_h, seen, prev, at, hash) {
      if (seen !== row.lastMemberSeen || prev !== row.warnedAt) return false;
      row.warnedAt = at;
      db.postponeHash = hash;
      return true;
    },
    async unclaimWarn(_h, _at, prev) {
      row.warnedAt = prev;
    },
    async startPerson(_h, absenceFrom, pos, tokenHash, at) {
      if (refuseStart || log.some((e) => e.pos === pos)) return false;
      log.push({
        absenceFrom,
        pos,
        sends: 1,
        firstSentAt: at,
        lastSentAt: at,
        confirmedAt: null,
        tokenHash,
      });
      return true;
    },
    async remindPerson(_h, _a, pos, fromSends, tokenHash, at) {
      const e = log.find((x) => x.pos === pos);
      if (!e || e.sends !== fromSends || e.confirmedAt) return false;
      Object.assign(e, { sends: fromSends + 1, lastSentAt: at, tokenHash });
      return true;
    },
    async close(_h, _seen, at) {
      row.alertedAt = at;
      db.closedAt = at;
      return true;
    },
  };
  const mailer = {
    async send(m: { to: string[]; subject: string; text: string; html: string }) {
      if (failMail) throw new Error('550 mailbox ragini@example.com unavailable');
      mails.push(m);
      return { id: 'x' };
    },
  };
  const deps = {
    mailer,
    channels: [
      emailChannel(mailer),
      whatsappChannel({
        async send(to: { phone: string; key: string }, text: string) {
          chats.push({ ...to, text });
          return { ok: true };
        },
      }),
    ],
  };
  const go = (d: number, dryRun = false) =>
    runInactivity(store, deps, {
      now: run(d),
      appUrl: APP,
      serverSecret: SECRET,
      dryRun,
      log: (l) => lines.push(l),
    });
  return {
    row,
    log,
    mails,
    chats,
    lines,
    db,
    go,
    failMails: (v: boolean) => (failMail = v),
    refuseStart: (v: boolean) => (refuseStart = v),
    clear: () => {
      mails.length = 0;
      chats.length = 0;
    },
  };
}

const key = alertLinkKey(SECRET);
const confirmLink = (pos: number) => `${APP}/confirm/${alertToken(key, 'confirm', H, SEEN, pos)}`;
const PRIVATE = /ragini|ravi|meera|asha|example\.com|\+65|6591234567|K1234|confirm\/|postpone\//i;

describe('runInactivity', () => {
  it('does nothing while the household uses the portal', async () => {
    const w = world();
    const r = await w.go(10);
    expect(r[0]).toMatchObject({ step: 'none', sends: 0 });
    expect(w.mails).toHaveLength(0);
    expect(w.lines).toEqual(['inactivity: none']);
  });

  it('warns every member once (no duplicates, no empty addresses) with a working postpone link, and again the next day with the same link', async () => {
    const w = world();
    await w.go(20);
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0]!.to).toEqual(['owner@example.com', 'ragini@example.com']);
    expect(w.mails[0]!.text).toContain('otherwise in 10 days, on 31 Oct 2026, Ragini will be told');
    const link = w.mails[0]!.text.match(/postpone\/([A-Za-z0-9_-]+)/)![1]!;
    expect(hashToken(link)).toBe(w.db.postponeHash);
    expect(w.row.warnedAt).toBe(run(20));
    expect(w.lines).toEqual(['inactivity: warn sends=2']);
    await w.go(21);
    expect(w.mails).toHaveLength(2);
    expect(w.mails[1]!.text).toContain(`postpone/${link}`);
    expect(w.mails[1]!.text).toContain('in 9 days');
  });

  it('takes a warning back when it could not be sent, so the next run tries again', async () => {
    const w = world();
    w.failMails(true);
    const r = await w.go(20);
    expect(r[0]).toMatchObject({ step: 'warn', failed: 1, note: 'not_sent' });
    expect(w.row.warnedAt).toBeNull();
    expect(w.lines[0]).toBe('inactivity: warn sends=0 failed=1 not sent; tried again next run');
  });

  it('does not warn when no member has an e-mail address', async () => {
    const w = world({}, ['', 'not-an-address']);
    expect((await w.go(20))[0]).toMatchObject({ step: 'warn', note: 'not_sent' });
  });

  it('tells the first person by e-mail and WhatsApp with their own link, and the members get a separate copy without it', async () => {
    const w = world({}, ['owner@example.com', 'vikram@example.com', '']);
    await w.go(31);
    expect(w.log).toHaveLength(1);
    expect(w.log[0]).toMatchObject({ pos: 0, sends: 1 });
    expect(hashToken(confirmLink(0).split('/confirm/')[1]!)).toBe(w.log[0]!.tokenHash);
    const own = w.mails.find((m) => m.to.includes('ragini@example.com'))!;
    expect(own.to).toEqual(['ragini@example.com']);
    expect(own.text).toMatch(/^Dear Ragini,/);
    expect(own.text).toContain(confirmLink(0));
    expect(w.chats).toHaveLength(1);
    expect(w.chats[0]!).toMatchObject({ phone: '+6591234567', key: 'K1234' });
    expect(w.chats[0]!.text).toContain(confirmLink(0));
    const copy = w.mails.find((m) => m.to.includes('owner@example.com'))!;
    expect(copy.to).toEqual(['owner@example.com', 'vikram@example.com']);
    expect(copy.subject).toMatch(/^Copy: /);
    expect(copy.text).toMatch(/^Copy for the household: sent to Ragini\./);
    expect(copy.text + copy.html).not.toContain('/confirm/');
    expect(w.lines).toEqual(['inactivity: chain step=first pos=0 sends=4']);
  });

  it('a member who is also the trusted person gets the message once, as the person', async () => {
    const w = world();
    await w.go(31);
    const toRagini = w.mails.filter((m) => m.to.includes('ragini@example.com'));
    expect(toRagini).toHaveLength(1);
    expect(toRagini[0]!.text).toContain(confirmLink(0));
    const copy = w.mails.find((m) => m.subject.startsWith('Copy: '))!;
    expect(copy.to).toEqual(['owner@example.com']);
  });

  it('every reminder carries the same working link, and the members get a copy of each', async () => {
    const w = world();
    await w.go(31);
    w.clear();
    await w.go(33);
    expect(w.log[0]).toMatchObject({ sends: 2 });
    const own = w.mails.find((m) => m.to.includes('ragini@example.com'))!;
    expect(own.subject).toMatch(/^Reminder: /);
    expect(own.text).toContain('Reminder 1 of 3');
    expect(own.text).toContain(confirmLink(0));
    expect(hashToken(confirmLink(0).split('/confirm/')[1]!)).toBe(w.log[0]!.tokenHash);
    const copy = w.mails.find((m) => m.subject.startsWith('Copy: '))!;
    expect(copy.text).toMatch(/^Copy for the household: sent to Ragini \(reminder 1 of 3\)\./);
    expect(copy.text).not.toContain('/confirm/');
    expect(w.lines.at(-1)).toBe('inactivity: chain step=remind pos=0 sends=3');
  });

  it('after the reminders, tells the next person; someone without any channel still counts and the copy still goes', async () => {
    const w = world({ reminders: 0 });
    await w.go(31);
    await w.go(33);
    expect(w.log.map((e) => e.pos)).toEqual([0, 1]);
    w.clear();
    const r = await w.go(35); // Meera: a WhatsApp number but no key, no e-mail
    expect(r[0]).toMatchObject({ step: 'first', pos: 2, failed: 1 });
    expect(w.chats).toHaveLength(0);
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0]!.text).toMatch(/^Copy for the household: sent to Meera\./);
    await w.go(37);
    expect(w.lines.at(-1)).toBe('inactivity: chain step=exhausted sends=0 nobody confirmed');
    expect(w.db.closedAt).toBe(run(37));
    await w.go(39);
    expect(w.lines.at(-1)).toBe('inactivity: none');
  });

  it('stops as soon as someone confirms and tells the members who and when', async () => {
    const w = world();
    await w.go(31);
    w.log[0]!.confirmedAt = '2026-11-01T10:00:00.000Z';
    w.clear();
    const r = await w.go(32);
    expect(r[0]).toMatchObject({ step: 'confirmed', pos: 0 });
    expect(w.mails).toHaveLength(1);
    expect(w.mails[0]!.to).toEqual(['owner@example.com', 'ragini@example.com']);
    expect(w.mails[0]!.text).toContain('Ragini confirmed on 1 Nov 2026');
    expect(w.db.closedAt).toBe(run(32));
    w.clear();
    await w.go(40);
    expect(w.mails).toHaveLength(0);
  });

  it('keeps the chain open for the note alone when the note could not be sent', async () => {
    const w = world();
    await w.go(31);
    w.log[0]!.confirmedAt = run(31);
    w.failMails(true);
    expect((await w.go(32))[0]).toMatchObject({ step: 'confirmed', note: 'not_sent' });
    expect(w.db.closedAt).toBeNull();
  });

  it('sends nothing when another run already recorded the step', async () => {
    const w = world();
    w.refuseStart(true);
    const r = await w.go(31);
    expect(r[0]).toMatchObject({ step: 'first', note: 'already_done' });
    expect(w.mails).toHaveLength(0);
    expect(w.chats).toHaveLength(0);
  });

  it('a dry run decides and logs, and records and sends nothing', async () => {
    for (const [d, line] of [
      [20, 'inactivity: warn sends=0 (dry run: nothing sent or recorded)'],
      [31, 'inactivity: chain step=first pos=0 sends=0 (dry run: nothing sent or recorded)'],
    ] as const) {
      const w = world();
      await w.go(d, true);
      expect(w.lines).toEqual([line]);
      expect(w.mails).toHaveLength(0);
      expect(w.log).toHaveLength(0);
      expect(w.row.warnedAt).toBeNull();
    }
  });

  it('never logs a name, an address, a number, a key or a token', async () => {
    const w = world();
    for (let d = 0; d < 70; d++) await w.go(d);
    w.failMails(true);
    await w.go(71);
    expect(w.lines.length).toBeGreaterThan(10);
    for (const l of w.lines) expect(l).not.toMatch(PRIVATE);
  });

  it('logs a household that could not be checked without the error text', async () => {
    const lines: string[] = [];
    const store = {
      rows: async () => [{ householdId: H, contacts: people } as unknown as InactivityRunRow],
      chain: async () => {
        throw new Error('relation emergency_alert_log for ragini@example.com');
      },
    } as unknown as InactivityStore;
    const r = await runInactivity(
      store,
      { mailer: { send: async () => ({}) }, channels: [] },
      { now: run(31), appUrl: APP, serverSecret: SECRET, log: (l) => lines.push(l) },
    );
    expect(r[0]).toMatchObject({ step: 'error' });
    expect(lines).toEqual(['inactivity: could not be checked for one household']);
  });
});

describe('helpers', () => {
  it('cleans member addresses: lower case, each once, empty and broken ones skipped', () => {
    expect(cleanEmails([' A@x.com ', 'a@x.com', '', 'nope', 'b@y.org'])).toEqual([
      'a@x.com',
      'b@y.org',
    ]);
  });
  it('writes each kind of line', () => {
    const b = { householdId: H, sends: 2, failed: 0 };
    expect(lineOf({ ...b, step: 'remind', pos: 1, note: 'done' })).toBe(
      'inactivity: chain step=remind pos=1 sends=2',
    );
    expect(lineOf({ ...b, step: 'first', pos: 0, note: 'already_done' })).toBe(
      'inactivity: chain step=first pos=0 sends=2 (already done by another run)',
    );
  });
  it('e-mail and WhatsApp channels say whom they reach and never throw', async () => {
    const e = emailChannel({ send: async () => Promise.reject(new Error('x')) });
    expect(e.reaches(people[0]!)).toBe(true);
    expect(e.reaches(people[2]!)).toBe(false);
    expect(await e.send(people[0]!, { subject: '', text: '', html: '', chat: '' })).toBe(false);
    const wa = whatsappChannel({ send: async () => Promise.reject(new Error('x')) });
    expect(wa.reaches(people[0]!)).toBe(true);
    expect(wa.reaches(people[2]!)).toBe(false);
    expect(await wa.send(people[0]!, { subject: '', text: '', html: '', chat: '' })).toBe(false);
  });
});
