import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '@fwos/core';
import { MAIL_PASSWORD_FAILED, openStatement } from '../src/cas-open';
import type { InboxRow } from '../src/inbox-run';
import {
  describeRead,
  runStatementScan,
  scanLine,
  type FullMessage,
  type ImportedFromMail,
  type MailboxReader,
  type ScanConfig,
  type StatementIo,
} from '../src/statement-scan';
import type { MailHead, MailSearch } from '../src/statement-mail';
import { PDF_EXTRA, PDF_PAN } from './statement-pdfs';

const PAN = 'ABCDE1234F';
const OWN = 'asha.owner@home.example.test';

/** A pretend mailbox: it records every call, and has no way to change anything. */
function fakeMailbox(messages: { head: MailHead; full?: Partial<FullMessage> }[]) {
  const calls = { search: [] as MailSearch[], heads: [] as number[][], downloads: [] as number[] };
  const reader: MailboxReader = {
    async search(q) {
      calls.search.push(q);
      // the server matches "From contains X" and the date
      return messages
        .filter((m) => m.head.from.toLowerCase().includes(q.from) && m.head.date >= q.since)
        .map((m) => m.head.uid);
    },
    async heads(uids) {
      calls.heads.push(uids);
      return messages.filter((m) => uids.includes(m.head.uid)).map((m) => m.head);
    },
    async download(uid) {
      calls.downloads.push(uid);
      const m = messages.find((x) => x.head.uid === uid);
      if (!m) return null;
      return {
        from: m.head.from,
        subject: m.head.subject,
        text: 'Please find your statement attached.',
        date: m.head.date,
        attachments: [{ filename: 'statement.pdf', content: PDF_PAN }],
        ...m.full,
      };
    },
  };
  return { reader, calls };
}

function fakeIo(over: Partial<StatementIo> = {}, known: Record<string, InboxRow['outcome']> = {}) {
  const rows: InboxRow[] = [];
  const imports: string[] = [];
  const io: StatementIo = {
    async seen(id) {
      const hit = rows.find((r) => r.messageId === id);
      const o = hit?.outcome ?? known[id];
      return o ? { outcome: o } : null;
    },
    async record(row) {
      rows.push(row);
    },
    async importPdf(m) {
      imports.push(m.messageId);
      return { outcome: 'imported', reason: '', people: ['Asha'], funds: 3, transactions: 12 };
    },
    ...over,
  };
  return { io, rows, imports };
}

const head = (uid: number, day: string, over: Partial<MailHead> = {}): MailHead => ({
  uid,
  messageId: `<m${uid}@mail>`,
  from: 'CAMS Mailback Server <donotreply@camsonline.com>',
  subject: 'Consolidated Account Statement - CAMS Mailback Request',
  date: new Date(`${day}T04:00:00Z`),
  size: 120_000,
  hasPdf: true,
  authResults: null,
  ...over,
});

const cfg = (over: Partial<ScanConfig> = {}): ScanConfig => ({
  senders: DEFAULT_CONFIG.statementMail.senders,
  ownAddresses: [OWN],
  since: new Date('2025-09-01T00:00:00Z'),
  maxBytes: 15 * 1_048_576,
  maxPerRun: 40,
  retryFailed: false,
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe('runStatementScan', () => {
  it('asks the server for each sender since a date and never lists the rest of the mailbox', async () => {
    const { reader, calls } = fakeMailbox([
      { head: head(1, '2026-10-01') },
      {
        head: head(2, '2026-10-02', {
          from: 'Friend <friend@mail.example.test>',
          subject: 'Lunch?',
        }),
      },
    ]);
    const { io } = fakeIo();
    await runStatementScan(reader, io, cfg());
    expect(calls.search.length).toBe(DEFAULT_CONFIG.statementMail.senders.length + 1);
    expect(calls.search.every((q) => q.since.getTime() === cfg().since.getTime())).toBe(true);
    expect(calls.search.map((q) => q.from)).toContain('camsonline.com');
    expect(calls.search.map((q) => q.from)).toContain(OWN);
    // only the statement was even looked at; the friend's message was never returned by the server
    expect(calls.heads.flat()).toEqual([1]);
    expect(calls.downloads).toEqual([1]);
  });

  it('downloads only messages that pass the checks on their envelope', async () => {
    const { reader, calls } = fakeMailbox([
      { head: head(1, '2026-10-01', { from: 'CAMS <donotreply@camsonline.com.evil.example>' }) },
      { head: head(2, '2026-10-02', { hasPdf: false }) },
      { head: head(3, '2026-10-03', { size: 50 * 1_048_576 }) },
      { head: head(4, '2026-10-04', { authResults: 'dmarc=fail' }) },
      { head: head(5, '2026-10-05') },
    ]);
    const { io, rows } = fakeIo();
    const r = await runStatementScan(reader, io, cfg());
    expect(calls.downloads).toEqual([5]);
    expect(rows.filter((x) => x.outcome === 'ignored').map((x) => x.reason)).toEqual([
      expect.stringContaining('MB limit'),
      expect.stringContaining('sender check'),
    ]);
    expect(r.problems).toBe(2);
    expect(r.imported).toBe(1);
  });

  it('reads oldest first, so a later statement overwrites an earlier one', async () => {
    const { reader } = fakeMailbox([
      { head: head(30, '2026-10-20') },
      { head: head(10, '2026-08-20') },
      { head: head(20, '2026-09-20') },
    ]);
    const { io, imports } = fakeIo();
    await runStatementScan(reader, io, cfg());
    expect(imports).toEqual(['<m10@mail>', '<m20@mail>', '<m30@mail>']);
  });

  it('skips what was handled before, by Message-ID, and reads it only once', async () => {
    const { reader, calls } = fakeMailbox([
      { head: head(1, '2026-10-01') },
      { head: head(2, '2026-10-02') },
    ]);
    const { io, imports } = fakeIo({}, { '<m1@mail>': 'applied' });
    const first = await runStatementScan(reader, io, cfg());
    expect(first.skipped).toBe(1);
    expect(imports).toEqual(['<m2@mail>']);
    const again = await runStatementScan(reader, io, cfg());
    expect(again.skipped).toBe(2);
    expect(again.found).toBe(0);
    expect(calls.downloads).toEqual([2]);
  });

  it('tries a statement again that could not be opened only when asked (a new password may be saved)', async () => {
    const mailbox = () => fakeMailbox([{ head: head(1, '2026-10-01') }]);
    const known = { '<m1@mail>': 'needs_review' as const };
    const quiet = fakeIo({}, known);
    await runStatementScan(mailbox().reader, quiet.io, cfg());
    expect(quiet.imports).toEqual([]);
    const asked = fakeIo({}, known);
    await runStatementScan(mailbox().reader, asked.io, cfg({ retryFailed: true }));
    expect(asked.imports).toEqual(['<m1@mail>']);
    // an error is always tried again
    const err = fakeIo({}, { '<m1@mail>': 'error' });
    await runStatementScan(mailbox().reader, err.io, cfg());
    expect(err.imports).toEqual(['<m1@mail>']);
  });

  it('stops at the limit per scan, oldest first, and says how many wait', async () => {
    const { reader } = fakeMailbox([1, 2, 3, 4].map((n) => ({ head: head(n, `2026-10-0${n}`) })));
    const { io, imports } = fakeIo();
    const r = await runStatementScan(reader, io, cfg({ maxPerRun: 2 }));
    expect(imports).toEqual(['<m1@mail>', '<m2@mail>']);
    expect(r.waiting).toBe(2);
    expect(scanLine(r)).toBe(
      '2 statements found, 2 imported, 0 problems, 2 more waiting for the next scan',
    );
  });

  it('records each message with a clear outcome and sentence', async () => {
    const results: ImportedFromMail[] = [
      { outcome: 'imported', reason: '', people: ['Asha'], funds: 3, transactions: 12 },
      { outcome: 'failed', reason: MAIL_PASSWORD_FAILED, people: [], funds: 0, transactions: 0 },
      {
        outcome: 'partial',
        reason: 'check: Sample Fund',
        people: ['Asha'],
        funds: 1,
        transactions: 0,
      },
    ];
    const { reader } = fakeMailbox([1, 2, 3].map((n) => ({ head: head(n, `2026-10-0${n}`) })));
    let i = 0;
    const { io, rows } = fakeIo({ importPdf: async () => results[i++]! });
    const r = await runStatementScan(reader, io, cfg());
    expect(rows.map((x) => [x.outcome, x.reason])).toEqual([
      ['applied', 'Fund statement from CAMS: 3 funds, 12 transactions added'],
      ['needs_review', MAIL_PASSWORD_FAILED],
      [
        'needs_review',
        'Fund statement from CAMS: 1 fund, no new transactions (check: Sample Fund)',
      ],
    ]);
    expect(r).toMatchObject({ found: 3, imported: 2, problems: 1 });
    expect(r.items.map((x) => x.outcome)).toEqual(['imported', 'failed', 'partial']);
    expect(r.items[0]).toMatchObject({ registrar: 'CAMS', person: 'Asha', date: '2026-10-01' });
    expect(scanLine(r)).toBe('3 statements found, 2 imported, 1 problem');
  });

  it('a failure on one message does not stop the others, and is recorded as an error', async () => {
    const { reader } = fakeMailbox([
      { head: head(1, '2026-10-01') },
      { head: head(2, '2026-10-02') },
    ]);
    let n = 0;
    const { io, rows } = fakeIo({
      importPdf: async () => {
        if (n++ === 0) throw new Error('database unavailable');
        return { outcome: 'imported', reason: '', people: [], funds: 1, transactions: 1 };
      },
    });
    const r = await runStatementScan(reader, io, cfg());
    expect(rows.map((x) => x.outcome)).toEqual(['error', 'applied']);
    expect(r).toMatchObject({ problems: 1, imported: 1 });
  });

  it('accepts a copy you forwarded yourself when the original sender is allowed, and refuses others', async () => {
    const fw = (uid: number, sender: string) => ({
      head: head(uid, `2026-10-0${uid}`, {
        from: `Asha <${OWN}>`,
        subject: 'Fwd: Consolidated Account Statement',
      }),
      full: {
        text: `Forwarded.\n---------- Forwarded message ---------\nFrom: ${sender}\nDate: Mon\nSubject: Consolidated Account Statement\nTo: <${OWN}>\n`,
      },
    });
    const { reader } = fakeMailbox([
      fw(1, 'CAMS <donotreply@camsonline.com>'),
      fw(2, 'Bank <alerts@evil.example>'),
    ]);
    const { io, rows, imports } = fakeIo();
    const r = await runStatementScan(reader, io, cfg());
    expect(imports).toEqual(['<m1@mail>']);
    expect(rows.find((x) => x.messageId === '<m2@mail>')).toMatchObject({ outcome: 'ignored' });
    expect(r.items[0]!.registrar).toBe('CAMS');
  });

  it('passes the PDFs of the message on, and nothing larger than the limit', async () => {
    const { reader } = fakeMailbox([
      {
        head: head(1, '2026-10-01', { size: 50 }),
        full: {
          attachments: [
            { filename: 'small.pdf', content: new Uint8Array(10) },
            { filename: 'big.pdf', content: new Uint8Array(200) },
          ],
        },
      },
    ]);
    const seen: string[][] = [];
    const { io } = fakeIo({
      importPdf: async (m) => {
        seen.push(m.attachments.map((a) => a.filename));
        return { outcome: 'imported', reason: '', people: [], funds: 1, transactions: 0 };
      },
    });
    await runStatementScan(reader, io, cfg({ maxBytes: 100 }));
    expect(seen).toEqual([['small.pdf']]);
  });
});

describe('describeRead', () => {
  it('writes one plain sentence', () => {
    expect(
      describeRead('KFintech', {
        outcome: 'imported',
        reason: '',
        people: [],
        funds: 1,
        transactions: 1,
      }),
    ).toBe('Fund statement from KFintech: 1 fund, 1 transaction added');
    expect(
      describeRead('CAMS', {
        outcome: 'failed',
        reason: 'x broke',
        people: [],
        funds: 0,
        transactions: 0,
      }),
    ).toBe('Could not read: x broke');
  });
});

describe('no AI on this path', () => {
  it('never calls out to any service: a whole scan with real PDFs runs with the network switched off', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('network used');
    });
    vi.stubGlobal('fetch', fetchSpy);
    // a scan that really opens PDFs, through the same opening code the importer uses, with a PAN and an extra password saved
    const people = [
      { ownerId: 'o1', passwords: [PAN, PAN.toLowerCase(), 'Zx9!kLm2'], panLast4: PAN.slice(-4) },
    ];
    const { reader } = fakeMailbox([
      { head: head(1, '2026-10-01') },
      {
        head: head(2, '2026-10-02'),
        full: { attachments: [{ filename: 'p.pdf', content: PDF_EXTRA }] },
      },
      {
        head: head(3, '2026-10-03'),
        full: { attachments: [{ filename: 'q.pdf', content: new Uint8Array([1, 2, 3]) }] },
      },
    ]);
    const { io, rows } = fakeIo({
      async importPdf(m) {
        const o = await openStatement(m.attachments[0]!.content, people, true);
        if (!o.ok)
          return { outcome: 'failed', reason: o.detail, people: [], funds: 0, transactions: 0 };
        return {
          outcome: 'imported',
          reason: '',
          people: ['Asha'],
          funds: o.stmt.schemes.length,
          transactions: 5,
        };
      },
    });
    const r = await runStatementScan(reader, io, cfg());
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(r.imported).toBe(2);
    expect(r.problems).toBe(1);
    // no password, no PAN anywhere that is kept or shown
    const kept = JSON.stringify({ rows, r });
    for (const secret of [PAN, 'Zx9!kLm2']) expect(kept).not.toContain(secret);
  });

  it('the code of the scan has no way to reach an AI service or to change the mailbox', () => {
    const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const files = {
      scan: read('../src/statement-scan.ts'),
      rules: read('../src/statement-mail.ts'),
      open: read('../src/cas-open.ts'),
      worker: read('../../../workers/src/statements.ts'),
    };
    for (const [name, src] of Object.entries(files)) {
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // nothing imports or builds an AI chain, and no usage row is written
      expect(code, name).not.toMatch(
        /ai-chain|aiChainFor|callAi|createAiChain|ai-providers|ai_usage|ai_keys|recordAiUsage/,
      );
      // nothing that changes a mailbox
      expect(code, name).not.toMatch(
        /messageFlags(Add|Remove|Set)|messageMove|messageCopy|messageDelete|mailboxCreate|mailboxDelete|mailboxRename|\.append\(|\.expunge|\.copy\(|\.move\(|\.setFlags|addFlags|removeFlags|\.store\(/,
      );
    }
    // the worker opens the mailbox read-only and uses only the three reading calls of the connection
    expect(files.worker).toMatch(/getMailboxLock\(path, \{ readOnly: true \}\)/);
    const used = [...files.worker.matchAll(/client\.(\w+)\(/g)].map((m) => m[1]);
    expect([...new Set(used)].sort()).toEqual([
      'connect',
      'fetch',
      'fetchOne',
      'getMailboxLock',
      'list',
      'logout',
      'search',
    ]);
  });
});
