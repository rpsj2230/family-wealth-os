import { DEFAULT_CONFIG } from '@fwos/core';
import { buildGmailModel, type GmailModel } from './gmail-statements';

/** An invented Gmail statements card for the public sample: two people, a scan that read three statements, two requests. */
export function demoGmailModel(): GmailModel {
  return buildGmailModel({
    config: DEFAULT_CONFIG.statementMail,
    today: '2026-10-26',
    now: new Date('2026-10-26T09:00:00Z'),
    people: [
      { id: 'p1', name: 'Anil', panSaved: true, passwords: 1 },
      { id: 'p2', name: 'Beena', panSaved: true, passwords: 0 },
    ],
    requests: [
      {
        id: 'r1',
        owner_id: 'p1',
        registrar: 'cams',
        requested_on: '2026-10-25',
        status: 'asked',
        arrived_on: null,
      },
      {
        id: 'r2',
        owner_id: 'p2',
        registrar: 'kfintech',
        requested_on: '2026-10-20',
        status: 'asked',
        arrived_on: null,
      },
      {
        id: 'r3',
        owner_id: 'p1',
        registrar: 'mfcentral',
        requested_on: '2026-10-02',
        status: 'arrived',
        arrived_on: '2026-10-03',
      },
    ],
    scans: [
      {
        trigger: 'schedule',
        requested_at: null,
        started_at: '2026-10-26T00:40:20Z',
        finished_at: '2026-10-26T00:41:05Z',
        mailbox: 'a***@g***.com',
        found: 3,
        imported: 2,
        problems: 1,
        ok: true,
        note: null,
        detail: [
          {
            date: '2026-10-20',
            registrar: 'CAMS',
            person: 'Anil',
            outcome: 'imported',
            text: 'Fund statement from CAMS: 6 funds, 12 transactions added',
          },
          {
            date: '2026-10-12',
            registrar: 'KFintech',
            person: 'Beena',
            outcome: 'partial',
            text: 'Fund statement from KFintech: 3 funds, 4 transactions added (check: Sample Index Fund)',
          },
          {
            date: '2026-10-03',
            registrar: 'CAMS',
            person: null,
            outcome: 'failed',
            text: "Could not open: none of the saved passwords fits. Ask for the statement again with your PAN as the password, or add this statement's password under Statement passwords.",
          },
        ],
      },
    ],
  });
}
