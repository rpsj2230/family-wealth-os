/**
 * What the "Read my fund statements from Gmail" card shows: built from the scan log, the requests for full statements and the
 * Settings numbers. The builder is pure (tested); the loader only reads. The signed-in page and /demo/import draw the same card from a
 * `GmailModel`, so the sample can never look different.
 */
import {
  cleanSenders,
  gmailSearchUrl,
  requestSentence,
  requestState,
  scanLine,
  type RequestRegistrar,
  type RequestState,
  type ScanItem,
} from '@fwos/ingest';
import { longDate } from '@fwos/core';
import type { AppConfig } from '@fwos/core';
import { whenText } from './ai-key-view';

/** When the job starts (UTC), matching `.github/workflows/statements.yml`; a test keeps the two together. */
export const RUN_MINUTE_UTC = 40;
export const RUN_HOURS_UTC = [0, 6, 12, 18] as const;

export interface ScanRow {
  trigger: 'schedule' | 'requested' | 'manual';
  requested_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  mailbox: string | null;
  found: number;
  imported: number;
  problems: number;
  ok: boolean | null;
  note: string | null;
  detail: unknown;
}

export interface RequestRow {
  id: string;
  owner_id: string;
  registrar: RequestRegistrar;
  requested_on: string;
  status: 'asked' | 'arrived' | 'cancelled';
  arrived_on: string | null;
}

export interface GmailPerson {
  id: string;
  name: string;
  panSaved: boolean;
  /** how many extra statement passwords are saved (never the passwords) */
  passwords: number;
}

export interface GmailRequestView {
  id: string;
  owner: string;
  registrar: RequestRegistrar;
  state: RequestState;
  sentence: string;
}

export interface GmailModel {
  enabled: boolean;
  /** the masked Gmail address the job read last, or null before the first scan */
  mailbox: string | null;
  senders: string[];
  searchUrl: string;
  waitDays: number;
  /** a Scan now is waiting for the job */
  waiting: { requestedAt: string } | null;
  /** the job is reading now */
  running: boolean;
  last: { at: string; line: string; ok: boolean; trigger: ScanRow['trigger'] } | null;
  /** the statements met in the latest scans, newest first */
  items: (ScanItem & { key: string })[];
  requests: GmailRequestView[];
  people: GmailPerson[];
  /** the job has never run */
  never: boolean;
}

const MAX_ITEMS = 8;
/** A scan that started and never finished more than this long ago is not still running. */
const STALE_RUN_MS = 60 * 60 * 1000;

/** The items kept with a scan, read defensively (they are JSON). */
export function itemsOf(detail: unknown): ScanItem[] {
  if (!Array.isArray(detail)) return [];
  const out: ScanItem[] = [];
  for (const x of detail) {
    if (!x || typeof x !== 'object') continue;
    const r = x as Record<string, unknown>;
    if (typeof r.date !== 'string' || typeof r.text !== 'string') continue;
    const outcome = r.outcome;
    if (
      outcome !== 'imported' &&
      outcome !== 'partial' &&
      outcome !== 'failed' &&
      outcome !== 'ignored'
    )
      continue;
    out.push({
      date: r.date,
      registrar: typeof r.registrar === 'string' ? r.registrar : 'Unknown',
      person: typeof r.person === 'string' ? r.person : null,
      outcome,
      text: r.text,
    });
  }
  return out;
}

export function buildGmailModel(i: {
  config: AppConfig['statementMail'];
  /** newest first */
  scans: ScanRow[];
  requests: RequestRow[];
  people: GmailPerson[];
  today: string;
  now: Date;
}): GmailModel {
  const finished = i.scans.filter((s) => s.finished_at && s.ok !== null);
  const lastScan = finished[0] ?? null;
  const waitingRow = i.scans.find((s) => s.requested_at && !s.started_at) ?? null;
  const running = i.scans.some(
    (s) =>
      s.started_at && !s.finished_at && i.now.getTime() - Date.parse(s.started_at) < STALE_RUN_MS,
  );
  const names = new Map(i.people.map((p) => [p.id, p.name]));
  const items: GmailModel['items'] = [];
  for (const s of finished)
    for (const [n, it] of itemsOf(s.detail).entries())
      items.push({ ...it, key: `${s.finished_at}-${n}` });
  items.sort((a, b) => b.date.localeCompare(a.date));
  return {
    enabled: i.config.enabled,
    mailbox: finished.find((s) => s.mailbox)?.mailbox ?? null,
    senders: cleanSenders(i.config.senders),
    searchUrl: gmailSearchUrl(i.config.senders),
    waitDays: i.config.requestWaitDays,
    waiting: waitingRow?.requested_at ? { requestedAt: waitingRow.requested_at } : null,
    running,
    last: lastScan
      ? {
          at: lastScan.finished_at!,
          ok: lastScan.ok === true,
          trigger: lastScan.trigger,
          line:
            lastScan.ok === true
              ? scanLine({
                  found: lastScan.found,
                  imported: lastScan.imported,
                  problems: lastScan.problems,
                  waiting: 0,
                })
              : (lastScan.note ?? 'The scan did not finish.'),
        }
      : null,
    items: items.slice(0, MAX_ITEMS),
    requests: i.requests
      .filter((r) => r.status !== 'cancelled')
      .map((r) => {
        const owner = names.get(r.owner_id) ?? 'someone';
        const state = requestState(
          { status: r.status, requestedOn: r.requested_on },
          i.today,
          i.config.requestWaitDays,
        );
        return {
          id: r.id,
          owner,
          registrar: r.registrar,
          state,
          sentence: requestSentence(
            { owner, registrar: r.registrar, requestedOn: r.requested_on, arrivedOn: r.arrived_on },
            state,
            i.config.requestWaitDays,
            longDate,
          ),
        };
      }),
    people: i.people,
    never: finished.length === 0,
  };
}

/** "Last scan 27 Oct 2026, 08:40: 2 statements found, 2 imported, 0 problems". */
export const lastScanText = (m: GmailModel): string =>
  m.last
    ? `Last scan ${whenText(m.last.at)}: ${m.last.line}`
    : m.waiting
      ? 'No scan yet; one is requested.'
      : 'No scan yet.';

/** When the next start of the job is, in words a person can use. */
export const runTimesText = (): string =>
  `${RUN_HOURS_UTC.map((h) => `${h}:${String(RUN_MINUTE_UTC).padStart(2, '0')}`).join(', ')} UTC`;

/** The sentence shown after pressing Scan now. */
export const scanRequestedText = (): string =>
  `Scan requested. The job looks for requests when it starts, which is every 6 hours (${runTimesText()}), so it will run within about 6 hours. To run it at once: on GitHub open Actions, choose “Read fund statements from Gmail” and press Run workflow.`;
