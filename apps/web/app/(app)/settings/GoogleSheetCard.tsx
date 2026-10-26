'use client';

import Link from 'next/link';
import { useRef, useState, useTransition } from 'react';
import { saveGoogleSheet, testGoogleSheet, type GsheetTestState } from '../gsheet/actions';
import { niceDate } from '@/lib/dates';
import type { SheetSyncInfo } from '@/lib/sheet-sync-status';
import { Field, SaveRow, Tick, useForm } from './fields';
import '@/components/sheetsync.css';

/** What the connection is, when it was last tested and what the last sync did. Never shows the key: it cannot be read back. */
export function GoogleSheetCard({
  info,
  demo = false,
  demoTest,
}: {
  info: SheetSyncInfo;
  demo?: boolean;
  /** the sample's test result, shown when the test button is pressed on the public pages */
  demoTest?: GsheetTestState;
}) {
  const { res, act, pending: saving } = useForm(saveGoogleSheet);
  const [test, setTest] = useState<GsheetTestState | null>(null);
  const [testing, startTest] = useTransition();
  const keyBox = useRef<HTMLTextAreaElement>(null);
  const tested = info.tested
    ? `${niceDate(info.tested.at)}: ${info.tested.ok ? 'working' : 'not working'}${info.tested.note ? ` (${info.tested.note})` : ''}`
    : 'not tested yet';

  return (
    <section className="card" id="google-sheet" aria-labelledby="gs-h">
      <div className="sectionhead">
        <h3 id="gs-h">Google Sheet</h3>
        <span className={`pill ${info.connected ? 'ok' : 'warn'}`}>
          {info.connected
            ? 'Connected'
            : info.hasId || info.keySet
              ? 'Half set up'
              : 'Not connected'}
        </span>
      </div>
      <p className="muted small">
        Writes the app’s figures into this month’s tab of your monthly Google Sheet, in the sheet’s
        own format: it copies last month’s tab, or, if this month’s tab exists, keeps a hidden copy
        and replaces its data. It connects through a free Google service account that you create
        once. Start a sync from{' '}
        <Link href={demo ? '/demo/import#google-sheet' : '/import#google-sheet'}>Import</Link> or
        the Monthly update page.
      </p>

      <dl className="gs-facts">
        <dt>Spreadsheet</dt>
        <dd>
          {info.sheetUrl ? (
            <a href={info.sheetUrl} target="_blank" rel="noreferrer">
              Open in Google Sheets
            </a>
          ) : (
            'not set'
          )}
        </dd>
        <dt>Service-account key</dt>
        <dd>{info.keySet ? 'saved on the server (it cannot be shown again)' : 'not saved'}</dd>
        <dt>Share the sheet with</dt>
        <dd>{info.email ? <code>{info.email}</code> : 'shown here once a key is saved'}</dd>
        <dt>Last test</dt>
        <dd className={info.tested ? (info.tested.ok ? 'ok' : 'fail') : 'muted'}>{tested}</dd>
        <dt>Last sync</dt>
        <dd className={info.last ? (info.last.ok ? '' : 'fail') : 'muted'}>
          {info.last
            ? `${info.last.ok ? '' : 'failed: '}${info.last.month ? `${info.last.month}, ` : ''}${niceDate(info.last.at)}${info.last.note ? `: ${info.last.note}` : ''}`
            : 'none yet'}
        </dd>
      </dl>

      <div className="aiconn" aria-live="polite">
        <button
          type="button"
          className="btn"
          disabled={testing || (!demo && !info.connected)}
          title={
            demo
              ? undefined
              : !info.connected
                ? 'Save the sheet’s link and the key first'
                : undefined
          }
          onClick={() =>
            startTest(async () => setTest(demoTest ? demoTest : await testGoogleSheet()))
          }
        >
          {testing ? 'Testing… (up to a minute)' : 'Test connection'}
        </button>
        {test && !testing && (
          <>
            <p
              className={`notice ${test.ok ? 'ok' : 'warn'} small`}
              role={test.ok ? 'status' : 'alert'}
            >
              {test.ok
                ? `All good. The next sync fills “${test.target}”${test.template ? `, copied from “${test.template}”` : ''}.`
                : 'Not working yet. See the steps below.'}
            </p>
            <ul className="list small">
              {test.steps.map((s, i) => (
                <li key={i} className={s.ok ? 'pass' : 'fail'}>
                  <strong>{s.ok ? 'OK' : 'Problem'}</strong> — {s.text}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <details className="gs-steps" open={!info.connected}>
        <summary>
          <strong>How to connect (about ten minutes, free)</strong>
        </summary>
        <ol className="stepper small">
          <li>
            In <strong>console.cloud.google.com</strong> create a project (any name), or pick one
            you have.
          </li>
          <li>
            <strong>APIs &amp; Services &gt; Library</strong>: search for “Google Sheets API” and
            press <strong>Enable</strong>.
          </li>
          <li>
            <strong>IAM &amp; Admin &gt; Service Accounts &gt; Create service account</strong>. Any
            name; it needs no role.
          </li>
          <li>
            Open the account, then <strong>Keys &gt; Add key &gt; Create new key &gt; JSON</strong>.
            A .json file downloads. Treat it like a password.
          </li>
          <li>
            Open your Google Sheet, press <strong>Share</strong>, add the account’s e-mail address
            (the <code>client_email</code> in the file, ending <code>.iam.gserviceaccount.com</code>
            ) as <strong>Editor</strong>. The sheet must be a real Google Sheet; an Excel file
            opened in Sheets needs File &gt; Save as Google Sheets first.
          </li>
          <li>
            Paste the sheet’s link and the key below, press <strong>Save</strong>, then{' '}
            <strong>Test connection</strong>.
          </li>
        </ol>
        <p className="small muted">
          The full guide, with what is written and what never is, is in
          docs/runbooks/google-sheet-sync.md.
        </p>
      </details>

      <form action={act} className="form" aria-busy={saving}>
        <fieldset disabled={demo} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
          <div className="formgrid">
            <Field
              label="Link or ID of the Google Sheet"
              hint="The address of the sheet from your browser, or just the long text between /d/ and /edit. It is not a secret. Leave empty to keep the saved one."
              wide
            >
              <input
                name="sheet"
                inputMode="url"
                autoComplete="off"
                placeholder={
                  info.hasId
                    ? 'a sheet is saved; paste to replace'
                    : 'https://docs.google.com/spreadsheets/d/…'
                }
              />
            </Field>
            <Field
              label={info.keySet ? 'Service-account key (one is saved)' : 'Service-account key'}
              hint={
                info.keySet
                  ? 'Leave empty to keep the saved key. It cannot be shown again; a new one replaces it.'
                  : 'Paste the whole content of the .json file, or choose the file. It is stored on the server and cannot be shown again.'
              }
              wide
            >
              <textarea
                ref={keyBox}
                name="key"
                className="gs-key"
                autoComplete="off"
                spellCheck={false}
                placeholder={info.keySet ? '••••••••' : '{ "type": "service_account", … }'}
              />
            </Field>
            <label className="fld">
              <span className="fld-label">…or choose the key file</span>
              <input
                type="file"
                accept=".json,application/json"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file && keyBox.current) keyBox.current.value = await file.text();
                }}
              />
            </label>
          </div>
          {info.keySet && <Tick name="clear" label="Remove the connection and the saved key" />}
          <SaveRow label="Save" pending={saving} res={res} />
        </fieldset>
        {demo && <p className="small muted">This is a sample: nothing can be saved here.</p>}
      </form>
    </section>
  );
}
