import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@fwos/core';
import { demoGmailModel } from './demo-gmail';
import {
  RUN_HOURS_UTC,
  RUN_MINUTE_UTC,
  buildGmailModel,
  itemsOf,
  lastScanText,
  scanRequestedText,
  type ScanRow,
} from './gmail-statements';

const cfg = DEFAULT_CONFIG.statementMail;
const people = [
  { id: 'p1', name: 'Asha', panSaved: true, passwords: 0 },
  { id: 'p2', name: 'Ravi', panSaved: false, passwords: 2 },
];
const scan = (over: Partial<ScanRow> = {}): ScanRow => ({
  trigger: 'schedule',
  requested_at: null,
  started_at: '2026-10-27T00:40:00Z',
  finished_at: '2026-10-27T00:41:00Z',
  mailbox: 'a***@g***.com',
  found: 2,
  imported: 2,
  problems: 0,
  ok: true,
  note: null,
  detail: [],
  ...over,
});
const build = (
  scans: ScanRow[],
  requests = [] as Parameters<typeof buildGmailModel>[0]['requests'],
) =>
  buildGmailModel({
    config: cfg,
    scans,
    requests,
    people,
    today: '2026-10-27',
    now: new Date('2026-10-27T03:00:00Z'),
  });

describe('the Gmail statements card model', () => {
  it('says plainly that nothing has run yet', () => {
    const m = build([]);
    expect(m.never).toBe(true);
    expect(m.last).toBeNull();
    expect(lastScanText(m)).toBe('No scan yet.');
    expect(m.mailbox).toBeNull();
  });

  it('reports the last scan in one line, with the masked mailbox', () => {
    const m = build([scan()]);
    expect(m.mailbox).toBe('a***@g***.com');
    expect(lastScanText(m)).toMatch(
      /^Last scan 27 Oct 2026, 08:41: 2 statements found, 2 imported, 0 problems$/,
    );
  });

  it('shows what stopped a scan that did not finish', () => {
    const m = build([scan({ ok: false, note: 'The scan stopped: Invalid credentials' })]);
    expect(m.last).toMatchObject({ ok: false, line: 'The scan stopped: Invalid credentials' });
  });

  it('knows about a waiting Scan now, and a scan that is reading now', () => {
    const waiting = build([
      scan({
        requested_at: '2026-10-27T01:00:00Z',
        started_at: null,
        finished_at: null,
        ok: null,
        trigger: 'requested',
      }),
      scan(),
    ]);
    expect(waiting.waiting).toEqual({ requestedAt: '2026-10-27T01:00:00Z' });
    expect(waiting.last?.ok).toBe(true);
    const running = build([
      scan({ started_at: '2026-10-27T02:50:00Z', finished_at: null, ok: null }),
    ]);
    expect(running.running).toBe(true);
    const stale = build([
      scan({ started_at: '2026-10-26T02:50:00Z', finished_at: null, ok: null }),
    ]);
    expect(stale.running).toBe(false);
  });

  it('lists the newest statements first, keeps eight, and reads stored details defensively', () => {
    const detail = Array.from({ length: 10 }, (_, n) => ({
      date: `2026-10-${String(n + 10).padStart(2, '0')}`,
      registrar: 'CAMS',
      person: 'Asha',
      outcome: 'imported',
      text: `Fund statement from CAMS: ${n} funds`,
    }));
    const m = build([scan({ detail })]);
    expect(m.items).toHaveLength(8);
    expect(m.items[0]!.date).toBe('2026-10-19');
    expect(itemsOf('nonsense')).toEqual([]);
    expect(
      itemsOf([{ date: 1 }, null, { date: '2026-10-01', text: 'x', outcome: 'weird' }]),
    ).toEqual([]);
  });

  it('turns requests into plain sentences with a state', () => {
    const m = build(
      [scan()],
      [
        {
          id: 'a',
          owner_id: 'p1',
          registrar: 'cams',
          requested_on: '2026-10-27',
          status: 'asked',
          arrived_on: null,
        },
        {
          id: 'b',
          owner_id: 'p2',
          registrar: 'kfintech',
          requested_on: '2026-10-20',
          status: 'asked',
          arrived_on: null,
        },
        {
          id: 'c',
          owner_id: 'p1',
          registrar: 'mfcentral',
          requested_on: '2026-10-02',
          status: 'arrived',
          arrived_on: '2026-10-03',
        },
        {
          id: 'd',
          owner_id: 'p1',
          registrar: 'cams',
          requested_on: '2026-10-01',
          status: 'cancelled',
          arrived_on: null,
        },
      ],
    );
    expect(m.requests.map((r) => r.state)).toEqual(['waiting', 'late', 'arrived']);
    expect(m.requests[0]!.sentence).toBe(
      'Requested from CAMS for Asha on 27 Oct 2026: waiting. Your Gmail is scanned daily; it is imported when it arrives.',
    );
    expect(m.requests[1]!.sentence).toContain('not arrived after 2 days');
    expect(m.requests[2]!.sentence).toContain('arrived on 3 Oct 2026');
  });

  it('carries only how many extra passwords there are, never a password', () => {
    const m = build([scan()]);
    expect(m.people.map((p) => p.passwords)).toEqual([0, 2]);
    expect(Object.keys(m.people[0]!).sort()).toEqual(['id', 'name', 'panSaved', 'passwords']);
  });

  it('builds a Gmail search link from domains only', () => {
    const url = decodeURIComponent(build([]).searchUrl);
    expect(url).toContain('from:(camsonline.com OR kfintech.com');
    expect(url).not.toMatch(/@/);
  });
});

describe('Scan now', () => {
  it('says when the job runs, and how to run it at once', () => {
    const t = scanRequestedText();
    expect(t).toContain('every 6 hours');
    expect(t).toContain('0:40, 6:40, 12:40, 18:40 UTC');
    expect(t).toContain('Run workflow');
  });

  it('matches the schedule of the workflow', () => {
    const yml = readFileSync(
      new URL('../../../.github/workflows/statements.yml', import.meta.url),
      'utf8',
    );
    const cron = /cron:\s*'(\d+) ([\d,]+) \* \* \*'/.exec(yml);
    expect(cron).not.toBeNull();
    expect(Number(cron![1])).toBe(RUN_MINUTE_UTC);
    expect(cron![2]!.split(',').map(Number)).toEqual([...RUN_HOURS_UTC]);
    expect(yml).toContain('workflow_dispatch:');
    expect(yml).toContain('STATEMENTS_FORCE');
  });
});

describe('the sample card', () => {
  it('is built by the same code, with invented people and no real address', () => {
    const m = demoGmailModel();
    expect(m.items.length).toBe(3);
    expect(m.requests.map((r) => r.state)).toEqual(['waiting', 'late', 'arrived']);
    expect(JSON.stringify(m)).not.toMatch(/[A-Za-z0-9._-]+@[A-Za-z]/);
  });
});

describe('the actions never send a password back', () => {
  it('uses the typed password only to call the saving function', () => {
    const src = readFileSync(
      new URL('../app/(app)/import/gmail-actions.ts', import.meta.url),
      'utf8',
    );
    const uses = src
      .split('\n')
      .filter((l) => /\bpassword\b/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l));
    // the form field is read once, checked for length, and passed to the function; it is never put in a message
    expect(uses.join('\n')).not.toMatch(/message:[^\n]*\bpassword\b[^,\n]*\+|\$\{password\}/);
    expect(src).not.toMatch(/console\./);
  });
});
