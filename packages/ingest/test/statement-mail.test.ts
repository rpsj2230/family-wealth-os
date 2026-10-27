import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@fwos/core';
import {
  authVerdict,
  forwardedRegistrar,
  gmailSearchUrl,
  isRegistrarSender,
  judgeHead,
  lookBackDays,
  maskAddress,
  matchingSender,
  oldestFirst,
  registrarName,
  requestSentence,
  requestState,
  searchPlan,
  sinceDate,
  type MailHead,
} from '../src/statement-mail';

const SENDERS = DEFAULT_CONFIG.statementMail.senders;
const OWN = ['asha.owner@home.example.test'];
const head = (over: Partial<MailHead> = {}): MailHead => ({
  uid: 1,
  messageId: '<a@b>',
  from: 'CAMS Mailback Server <donotreply@camsonline.com>',
  subject: 'Consolidated Account Statement - CAMS Mailback Request',
  date: new Date('2026-10-20T04:00:00Z'),
  size: 200_000,
  hasPdf: true,
  authResults: null,
  ...over,
});
const rules = { senders: SENDERS, ownAddresses: OWN, maxBytes: 15 * 1_048_576 };

describe('the default senders (Settings, not logic)', () => {
  it('cover the four registrars and depositories seen in real statement mail', () => {
    for (const from of [
      'CAMS Mailback Server <donotreply@camsonline.com>',
      'samfS@kfintech.com',
      'NSDL <NSDL-CAS@nsdl.co.in>',
      'eCAS@cdslstatement.com',
      'noreply@mfcentral.com',
    ])
      expect(isRegistrarSender(from, SENDERS), from).toBe(true);
  });
  it('are plain domains a person can edit', () => {
    expect(SENDERS.every((s) => /^[a-z0-9.-]+$/.test(s))).toBe(true);
  });
});

describe('isRegistrarSender: only the real address counts', () => {
  it('refuses a registrar name on someone else’s address', () => {
    expect(isRegistrarSender('CAMS Mailback Server <statements@evil.example>', SENDERS)).toBe(
      false,
    );
    expect(isRegistrarSender('"donotreply@camsonline.com" <attacker@evil.example>', SENDERS)).toBe(
      false,
    );
  });
  it('refuses look-alike domains', () => {
    for (const a of [
      'donotreply@camsonline.com.evil.example',
      'donotreply@evilcamsonline.com',
      'donotreply@camsonline.com.evil.example',
      'donotreply@kfintech.co',
      'donotreply@camsonline.co.in',
      'kfintech.com@evil.example',
    ])
      expect(isRegistrarSender(a, SENDERS), a).toBe(false);
  });
  it('covers sub-domains of an allowed domain, and exact addresses when an address is listed', () => {
    expect(isRegistrarSender('x@mail.camsonline.com', SENDERS)).toBe(true);
    expect(matchingSender('only@one.example.test', ['only@one.example.test'])).toBe(
      'only@one.example.test',
    );
    expect(matchingSender('other@one.example.test', ['only@one.example.test'])).toBeNull();
  });
  it('is not case sensitive and ignores a message with no address', () => {
    expect(isRegistrarSender('X <DoNotReply@CAMSOnline.COM>', SENDERS)).toBe(true);
    expect(isRegistrarSender('no address here', SENDERS)).toBe(false);
  });
  it('names the registrar for the screen (a label only)', () => {
    expect(registrarName('donotreply@camsonline.com')).toBe('CAMS');
    expect(registrarName('samfs@kfintech.com')).toBe('KFintech');
    expect(registrarName('nsdl-cas@nsdl.co.in')).toBe('NSDL');
    expect(registrarName('ecas@cdslstatement.com')).toBe('CDSL');
    expect(registrarName('a@other.example.test')).toBe('other.example.test');
  });
});

describe('judgeHead', () => {
  it('reads a statement from CAMS whatever its subject says', () => {
    expect(judgeHead(head(), rules)).toEqual({ kind: 'read', via: 'registrar', registrar: 'CAMS' });
    expect(judgeHead(head({ subject: 'Something else entirely' }), rules).kind).toBe('read');
  });
  it('passes over mail from anyone else, and mail with no PDF, without a trace', () => {
    expect(judgeHead(head({ from: 'a <a@evil.example>' }), rules)).toMatchObject({
      kind: 'ignore',
      record: false,
    });
    expect(judgeHead(head({ hasPdf: false }), rules)).toMatchObject({
      kind: 'ignore',
      record: false,
      why: 'no_pdf',
    });
  });
  it('records a PDF over the size limit and one that failed Gmail’s sender check', () => {
    expect(judgeHead(head({ size: 16 * 1_048_576 }), rules)).toMatchObject({
      kind: 'ignore',
      record: true,
      why: 'too_big',
    });
    expect(
      judgeHead(
        head({ authResults: 'mx.google.com; dmarc=fail (p=REJECT) header.from=camsonline.com' }),
        rules,
      ),
    ).toMatchObject({ kind: 'ignore', record: true, why: 'failed_auth' });
  });
  it('accepts a forwarded copy from your own address only when it looks like a statement', () => {
    const fw = head({
      from: 'Asha <asha.owner@home.example.test>',
      subject: 'Fwd: Consolidated Account Statement',
    });
    expect(judgeHead(fw, rules)).toEqual({ kind: 'read', via: 'forward', registrar: 'forwarded' });
    expect(judgeHead({ ...fw, subject: 'Holiday photos' }, rules)).toMatchObject({
      kind: 'ignore',
      record: false,
    });
  });
  it('does not treat a stranger who borrows your display name as you', () => {
    expect(
      judgeHead(
        head({
          from: 'Asha <asha.owner@home.example.test.evil.example>',
          subject: 'Fwd: statement',
        }),
        rules,
      ),
    ).toMatchObject({ kind: 'ignore' });
  });
});

describe('forwardedRegistrar', () => {
  const body = (from: string) =>
    `Hello\n---------- Forwarded message ---------\nFrom: ${from}\nDate: Mon, 26 Oct 2026\nSubject: Consolidated Account Statement\nTo: <me@home.example.test>\n\nAttached.`;
  it('finds an allowed original sender', () => {
    expect(
      forwardedRegistrar(
        'Fwd: Consolidated Account Statement',
        body('CAMS <donotreply@camsonline.com>'),
        SENDERS,
      ),
    ).toEqual({ address: 'donotreply@camsonline.com', registrar: 'CAMS' });
  });
  it('refuses a forward whose original sender is not allowed, or that is not a forward', () => {
    expect(forwardedRegistrar('Fwd: x', body('Bank <alerts@evil.example>'), SENDERS)).toBeNull();
    expect(forwardedRegistrar('Offers', 'From: x <donotreply@camsonline.com>', SENDERS)).toBeNull();
  });
});

describe('authVerdict', () => {
  it('lets a fail win over a pass a sender wrote itself', () => {
    expect(authVerdict('mx.google.com; dmarc=pass header.from=camsonline.com')).toBe('pass');
    expect(authVerdict('dmarc=pass; x; dmarc=fail')).toBe('fail');
    expect(authVerdict(null)).toBe('unknown');
    expect(authVerdict('spf=neutral')).toBe('unknown');
  });
});

describe('the search plan', () => {
  it('asks the server for one sender at a time, always since a date', () => {
    const since = new Date('2026-09-01T00:00:00Z');
    const plan = searchPlan(
      ['camsonline.com', 'kfintech.com'],
      ['asha.owner@home.example.test'],
      since,
    );
    expect(plan).toEqual([
      { from: 'camsonline.com', since },
      { from: 'kfintech.com', since },
      { from: 'asha.owner@home.example.test', since },
    ]);
    expect(plan.every((q) => q.since instanceof Date && q.from.length > 3)).toBe(true);
  });
  it('drops entries that are not a domain or an address, and repeats', () => {
    expect(
      searchPlan(['  CAMSonline.com ', 'camsonline.com', 'not valid', ''], [], new Date(0)),
    ).toHaveLength(1);
  });
  it('looks back far on the first scan and a short way afterwards', () => {
    const c = DEFAULT_CONFIG.statementMail;
    expect(lookBackDays(true, c)).toBe(400);
    expect(lookBackDays(false, c)).toBe(35);
    expect(sinceDate(new Date('2026-10-27T00:00:00Z'), 35).toISOString().slice(0, 10)).toBe(
      '2026-09-22',
    );
  });
  it('reads oldest first', () => {
    const list = [
      { uid: 3, date: new Date('2026-10-03') },
      { uid: 1, date: new Date('2026-09-01') },
      { uid: 2, date: new Date('2026-09-01') },
    ];
    expect(oldestFirst(list).map((x) => x.uid)).toEqual([1, 2, 3]);
  });
});

describe('small helpers', () => {
  it('masks an address', () => {
    expect(maskAddress('asha.rao@mail.example.test')).toBe('a***@m***.test');
    expect(maskAddress('nonsense')).toBe('');
  });
  it('builds a Gmail search link from domains only', () => {
    const url = gmailSearchUrl(['camsonline.com', 'kfintech.com', 'bad entry']);
    expect(decodeURIComponent(url)).toBe(
      'https://mail.google.com/mail/u/0/#search/from:(camsonline.com OR kfintech.com) has:attachment',
    );
  });
});

describe('requests for a full statement', () => {
  const day = (iso: string) => iso;
  it('waits, becomes late after the Settings number of days, and ends when it arrives', () => {
    const r = { status: 'asked' as const, requestedOn: '2026-10-25' };
    expect(requestState(r, '2026-10-26', 2)).toBe('waiting');
    expect(requestState(r, '2026-10-27', 2)).toBe('late');
    expect(requestState({ ...r, status: 'arrived' }, '2026-12-01', 2)).toBe('arrived');
    expect(requestState({ ...r, status: 'cancelled' }, '2026-12-01', 2)).toBe('cancelled');
  });
  it('says it in plain words', () => {
    const r = { owner: 'Asha', registrar: 'cams' as const, requestedOn: '2026-10-27' };
    expect(requestSentence(r, 'waiting', 2, day)).toBe(
      'Requested from CAMS for Asha on 2026-10-27: waiting. Your Gmail is scanned daily; it is imported when it arrives.',
    );
    expect(requestSentence(r, 'late', 2, day)).toContain('not arrived after 2 days');
    expect(requestSentence({ ...r, arrivedOn: '2026-10-28' }, 'arrived', 2, day)).toContain(
      'arrived on 2026-10-28',
    );
  });
});
