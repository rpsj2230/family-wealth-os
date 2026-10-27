import Link from 'next/link';
import { changeLines, longDate, type AutomationCard, type StoredChange } from '@fwos/core';
import { AutomationCards } from '@/components/AutomationCards';
import { Tabs } from '@/components/Tabs';
import { TaxFileForm } from '@/app/(app)/tax/filing/TaxFileForm';
import { CasForm, FundCsvForm, ImportForm, SyncLayoutForm } from './ImportForm';
import { FundChanges } from '@/components/FundChanges';
import type { PersonPreview } from '@/lib/fund-import';
import { GmailStatements } from './GmailStatements';
import type { GmailModel } from '@/lib/gmail-statements';
import { HistoryPanel } from './HistoryPanel';
import { ImportDoor } from './ImportDoor';
import { plainCountName } from '@/lib/import-detect';
import type { SyncView } from '@fwos/ingest';
import { SheetSyncPanel } from '@/components/SheetSync';
import type { SheetSyncInfo } from '@/lib/sheet-sync-status';
import '@/components/datain.css';

/** `start` is the front door (choose any file); the others are the pages for one kind of file. */
export const IMPORT_TABS = ['start', 'workbook', 'cas', 'csv', 'tax'] as const;
export type ImportTab = (typeof IMPORT_TABS)[number];

export interface ImportData {
  today: string;
  /** the financial year whose tax papers are filed now, e.g. 2025-26 */
  taxFy: string;
  owners: { id: string; name: string; panLast4: string | null; hasDob: boolean }[];
  workbook: {
    at: string;
    asOf: string;
    source: string;
    counts: Record<string, number>;
  } | null;
  cas: {
    id: string;
    at: string;
    owner: string | null;
    schemes: number;
    transactions: number;
    outcome: 'imported' | 'partial' | 'failed';
    detail: string | null;
    /** what the import changed, kept with it (statements imported before this was kept have none) */
    changes: { summary: string; notes: string[]; items: StoredChange[] } | null;
    fromEmail: boolean;
  }[];
  tax: {
    owner: string;
    fy: string;
    kind: '26as' | 'ais';
    readBy: 'rules' | 'ai';
    uploadedOn: string;
  }[];
  email: AutomationCard | null;
  /** the Google Sheet connection and its last sync */
  sheet: SheetSyncInfo;
  /** the Gmail statements card (only the Fund statement tab draws it) */
  gmail?: GmailModel | null;
}

/** Reads the change list kept with an import (stored as JSON), or nothing for an older import. */
export function changeRecord(raw: unknown): ImportData['cas'][number]['changes'] {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { summary?: unknown; notes?: unknown; items?: unknown };
  if (typeof r.summary !== 'string') return null;
  return {
    summary: r.summary,
    notes: Array.isArray(r.notes) ? r.notes.filter((n): n is string => typeof n === 'string') : [],
    items: Array.isArray(r.items) ? (r.items as StoredChange[]) : [],
  };
}

const OUTCOME = {
  imported: { tone: 'ok', text: 'Imported' },
  partial: { tone: 'warn', text: 'Waiting for your decision' },
  failed: { tone: 'bad', text: 'Could not be read' },
} as const;

/** The import hub: what each kind of file does, what to upload or forward, the password rule, the last result and what needs a look. */
export function ImportHub({
  base,
  tab,
  data,
  demo = false,
  demoSync,
  demoChanges,
}: {
  base: string;
  tab: ImportTab;
  data: ImportData;
  demo?: boolean;
  /** the public sample's stand-in for Google: the preview it shows */
  demoSync?: SyncView;
  /** the public sample's invented preview of a fund statement */
  demoChanges?: PersonPreview[];
}) {
  const casReview = data.cas.filter((c) => c.outcome !== 'imported');
  const taxReview = data.tax.filter((t) => t.readBy === 'ai');
  if (tab === 'start')
    return (
      <>
        <ImportDoor
          owners={data.owners}
          today={data.today}
          taxFy={data.taxFy}
          hasWorkbook={!!data.workbook}
          demo={demo}
        />
        <h2 className="doorsub">Or choose the kind of file yourself</h2>
        <div className="doorkinds">
          <article className="pickcard">
            <h3>Excel workbook</h3>
            <p className="meta">Your banks, savings and deposits, in your sheet&rsquo;s order.</p>
            <p className="small muted">
              {data.workbook ? `Last imported ${longDate(data.workbook.at)}` : 'Not imported yet'}
            </p>
            <div className="cardactions">
              <Link className="btn" href={`${base}?tab=workbook`}>
                Open
              </Link>
            </div>
          </article>
          <article className={`pickcard ${casReview.length ? 'attention' : ''}`}>
            <h3>Fund statement</h3>
            <p className="meta">A PDF from CAMS, KFintech, MF Central or CDSL.</p>
            <p className="small">
              {casReview.length ? (
                <strong>{casReview.length} waiting for you: open it for my suggestion</strong>
              ) : (
                <span className="muted">
                  {data.cas.length ? `Last one ${longDate(data.cas[0]!.at)}` : 'None yet'}
                </span>
              )}
            </p>
            <div className="cardactions">
              <Link className="btn" href={`${base}?tab=cas`}>
                Open
              </Link>
            </div>
          </article>
          <article className="pickcard">
            <h3>Fund app export (CSV)</h3>
            <p className="meta">The transactions file of an investment app, one per person.</p>
            <div className="cardactions">
              <Link className="btn" href={`${base}?tab=csv`}>
                Open
              </Link>
            </div>
          </article>
          <article className={`pickcard ${taxReview.length ? 'attention' : ''}`}>
            <h3>Tax statement</h3>
            <p className="meta">Form 26AS or the Annual Information Statement (AIS).</p>
            <p className="small">
              {taxReview.length ? (
                <strong>{taxReview.length} to check</strong>
              ) : (
                <span className="muted">
                  {data.tax.length ? `${data.tax.length} on file` : 'None yet'}
                </span>
              )}
            </p>
            <div className="cardactions">
              <Link className="btn" href={`${base}?tab=tax`}>
                Open
              </Link>
            </div>
          </article>
        </div>
        {data.email && <AutomationCards cards={[data.email]} />}
        <h2 className="doorsub">Or send this month to your Google Sheet</h2>
        <SheetSyncPanel info={data.sheet} {...(demoSync ? { demoView: demoSync } : {})} />
      </>
    );
  return (
    <>
      <p className="small">
        <Link href={base}>‹ Import any file</Link>
      </p>
      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'workbook', label: 'Excel workbook' },
          { key: 'cas', label: 'Fund statement', badge: casReview.length || null },
          { key: 'csv', label: 'Fund app export (CSV)' },
          { key: 'tax', label: 'Tax statement (26AS, AIS)', badge: taxReview.length || null },
        ]}
      />
      {tab !== 'workbook' && data.email && <AutomationCards cards={[data.email]} />}

      {tab === 'workbook' && (
        <div className="hubgrid">
          <section className="card">
            <h2>Keep your Excel order</h2>
            <p className="muted small">
              Upload your monthly workbook and the screens take its order, labels (NRE, NRO, joint),
              the link between each deposit and its savings account, deposit numbers (last 4 digits)
              and notes. It never changes a balance or a deposit amount, so it is safe to run
              whenever you reorder the sheet.
            </p>
            <fieldset disabled={demo} className="plain">
              <SyncLayoutForm today={data.today} />
            </fieldset>
          </section>
          <section className="card">
            <h2>Last workbook import</h2>
            {data.workbook ? (
              <dl className="lastresult">
                <dt>When</dt>
                <dd>{longDate(data.workbook.at)}</dd>
                <dt>Balances as of</dt>
                <dd>{longDate(data.workbook.asOf)}</dd>
                <dt>File</dt>
                <dd>{data.workbook.source}</dd>
                <dt>Created</dt>
                <dd>
                  {Object.entries(data.workbook.counts)
                    .filter(([, v]) => v > 0)
                    .map(([k, v]) => `${v} ${plainCountName(k)}`)
                    .join(', ') || 'Nothing'}
                </dd>
              </dl>
            ) : (
              <p className="empty">
                No workbook has been imported. Use the box below once, then keep going with the
                Monthly update.
              </p>
            )}
            <div className="rulebox small">
              <p>
                <strong>Rules.</strong> .xlsx up to 5 MB. Account and deposit numbers are cut to the
                last 4 digits. The same file cannot be imported twice. You see a preview, with
                checks against your own sheet, before anything is saved.
              </p>
            </div>
          </section>
          <details className="card" style={{ gridColumn: '1 / -1' }}>
            <summary>History from all monthly tabs: fill in the past months</summary>
            <p className="muted small">
              Reads every monthly tab of the workbook, shows what is missing or different, and adds
              the older balances and closed deposits. Nothing on file is ever changed or deleted
              without your choice.
            </p>
            <HistoryPanel demo={demo} />
          </details>
          <details className="card" style={{ gridColumn: '1 / -1' }}>
            <summary>First time, or a new household: import the whole workbook</summary>
            <fieldset disabled={demo} className="plain">
              <ImportForm today={data.today} />
            </fieldset>
          </details>
        </div>
      )}

      {tab === 'csv' && (
        <div className="hubgrid">
          <section className="card">
            <h2>What this does</h2>
            <p className="small">
              Reads the transactions export of an investment app (columns: Date, Folio Number, Name
              of the Fund, Order, Units, NAV, Current Nav, Amount). For each fund it stores every
              buy and sale, works out the units you hold and the amount invested, spots the monthly
              SIP, and values the fund as units times the current NAV in the file. After that the
              fund follows the live NAV by itself.
            </p>
            <div className="rulebox small">
              <p>
                <strong>Good to know.</strong> Choose all the files of one person together: folios
                of the same fund are combined into one holding. Importing the same file again adds
                nothing twice. Sales are matched to purchases oldest first, which is an
                approximation across folios; a fund statement (CAS) corrects it later. Lines without
                a folio number (for example digital gold) are not mutual funds and are left out.
              </p>
            </div>
          </section>
          <section className="card">
            <h2>Upload the files</h2>
            <fieldset disabled={demo} className="plain">
              <FundCsvForm owners={data.owners} />
            </fieldset>
          </section>
          {demo && demoChanges && (
            <section className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>What a preview looks like (sample)</h2>
              <p className="muted small">
                After you choose the file, the app compares it with what you already have and lists
                only what is new or changed. Everything starts ticked; untick what is wrong. Where
                the app cannot be sure, it says what it found, what it suggests and why: approve the
                suggestion, pick another answer or type what is missing. Nothing is written until
                you press the button.
              </p>
              <FundChanges people={demoChanges} owners={data.owners} />
              <div className="fc-actions">
                <button type="button" className="btn primary" disabled>
                  Apply the selected changes
                </button>
                <span className="muted small">Not available in the sample.</span>
              </div>
            </section>
          )}
        </div>
      )}

      {tab === 'cas' && (
        <div className="hubgrid">
          {data.gmail && (
            <div style={{ gridColumn: '1 / -1', minWidth: 0 }}>
              <GmailStatements model={data.gmail} demo={demo} />
            </div>
          )}
          <section className="card">
            <h2>What this does</h2>
            <p className="small">
              Reads a consolidated fund statement and stores every fund, every transaction, the
              amount invested, the first purchase date and any running SIP. Tax harvesting and the
              annual return (XIRR) then work from your real purchase dates.
            </p>
            <h3>How to get it</h3>
            <ol className="howto small">
              <li>
                On the CAMS or KFintech statement page (or MF Central) ask for a{' '}
                <strong>Detailed</strong> statement, from the first investment to today, including
                folios with zero balance.
              </li>
              <li>Send it to the Gmail address the app reads, once for each person.</li>
              <li>
                {data.gmail?.enabled ? (
                  <>
                    Nothing more: the Gmail scan above finds it by itself. (Labelling a message{' '}
                    <strong>FWOS/Inbox</strong> still works too.)
                  </>
                ) : (
                  <>
                    In Gmail, apply the label <strong>FWOS/Inbox</strong> to mail from
                    camsonline.com, kfintech.com, mfcentral.com, cdslindia.com or nsdl.com with an
                    attachment, or switch the Gmail scan above on. They are then imported by
                    themselves.
                  </>
                )}
              </li>
            </ol>
            <div className="rulebox small">
              <p>
                <strong>Password.</strong> When the form asks for one, type your PAN in capitals.
                Statements that arrive by email are opened with the PAN saved in Settings.
                Statements you upload here are opened with the password you type, which is used once
                and never saved.
              </p>
              <p>
                PAN on file:{' '}
                {data.owners.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 ? ', ' : ''}
                    {o.name} {o.panLast4 ? `(ends ${o.panLast4})` : '(not saved)'}
                  </span>
                ))}
                . <Link href="/settings#people">Change in Settings</Link>
              </p>
            </div>
          </section>
          <section className="card">
            <h2>Upload a statement</h2>
            <fieldset disabled={demo} className="plain">
              <CasForm owners={data.owners} />
            </fieldset>
          </section>
          {demo && demoChanges && (
            <section className="card" style={{ gridColumn: '1 / -1' }}>
              <h2>What a preview looks like (sample)</h2>
              <p className="muted small">
                After you choose the file, the app compares it with what you already have and lists
                only what is new or changed. Everything starts ticked; untick what is wrong. Where
                the app cannot be sure, it says what it found, what it suggests and why: approve the
                suggestion, pick another answer or type what is missing. Nothing is written until
                you press the button.
              </p>
              <FundChanges people={demoChanges} owners={data.owners} />
              <div className="fc-actions">
                <button type="button" className="btn primary" disabled>
                  Apply the selected changes
                </button>
                <span className="muted small">Not available in the sample.</span>
              </div>
            </section>
          )}
          <section className="card" style={{ gridColumn: '1 / -1' }} id="recent-statements">
            <h2>Recent statements</h2>
            {data.cas.length === 0 ? (
              <p className="empty">
                No statement has been imported yet. Forward one to the label, or upload it above.
              </p>
            ) : (
              <table className="tbl lines responsive">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Whose</th>
                    <th>How it came</th>
                    <th className="num">Funds</th>
                    <th className="num">New transactions</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {data.cas.map((c) => (
                    <tr key={c.id}>
                      <td data-label="Date">{longDate(c.at)}</td>
                      <td data-label="Whose">{c.owner ?? 'Not matched'}</td>
                      <td data-label="How it came">{c.fromEmail ? 'Email' : 'Uploaded here'}</td>
                      <td className="num" data-label="Funds">
                        {c.schemes}
                      </td>
                      <td className="num" data-label="New transactions">
                        {c.transactions}
                      </td>
                      <td data-label="Result">
                        <span className={`statuspill ${OUTCOME[c.outcome].tone}`}>
                          {OUTCOME[c.outcome].text}
                        </span>
                        {c.changes ? (
                          <div className="small">
                            <strong>{c.changes.summary}</strong>
                            {c.changes.items.length + c.changes.notes.length > 0 && (
                              <details className="recent-changes">
                                <summary>What changed</summary>
                                <ul className="list small">
                                  {changeLines(c.changes.items).map((l) => (
                                    <li key={l}>{l}</li>
                                  ))}
                                  {c.changes.notes.map((l) => (
                                    <li key={l} className="muted">
                                      {l}
                                    </li>
                                  ))}
                                </ul>
                              </details>
                            )}
                            {c.outcome !== 'imported' && c.detail && (
                              <div className="muted">{c.detail.split('\n').slice(1).join(' ')}</div>
                            )}
                          </div>
                        ) : (
                          c.outcome !== 'imported' &&
                          c.detail && <div className="small">{c.detail}</div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {casReview.length > 0 && (
              <div className="notice warn" role="note" style={{ marginTop: 12 }}>
                <p>
                  <strong>
                    {casReview.length} statement{casReview.length === 1 ? ' is' : 's are'} waiting
                    for you.
                  </strong>
                </p>
                <p className="small">
                  I suggest you upload {casReview.length === 1 ? 'it' : 'each'} again in the box
                  above. If it could not be opened, it is usually protected by a different password:
                  type that password (the one you chose when you requested it, or your PAN). If it
                  was read but a question was left open, the preview shows my suggested answer, and
                  you approve it or pick another.
                </p>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'tax' && (
        <div className="hubgrid">
          <section className="card">
            <h2>What this does</h2>
            <p className="small">
              Reads Form 26AS (tax credited to your PAN) and the Annual Information Statement (what
              banks and fund houses reported about you), then compares them with the tax the app
              expected on your deposit interest and fund sales. Differences are shown for you to
              check; nothing is changed by itself.
            </p>
            <h3>Where to get them</h3>
            <ol className="howto small">
              <li>
                <strong>Form 26AS</strong>: TRACES, as PDF, text or a saved web page.
              </li>
              <li>
                <strong>AIS</strong>: the income-tax e-filing portal, as PDF or JSON.
              </li>
              <li>
                Upload them here, or email them to the label <strong>FWOS/Inbox</strong>; they are
                read by themselves.
              </li>
            </ol>
            <div className="rulebox small">
              <p>
                <strong>Password.</strong> Form 26AS opens with the date of birth as DDMMYYYY. The
                AIS opens with your PAN in small letters followed by the date of birth. The app
                tries these from the date of birth saved in Settings, so there is usually nothing to
                type.
              </p>
              <p>
                Date of birth on file:{' '}
                {data.owners.map((o, i) => (
                  <span key={o.id}>
                    {i > 0 ? ', ' : ''}
                    {o.name} {o.hasDob ? '(saved)' : '(not saved)'}
                  </span>
                ))}
                . <Link href="/settings#people">Change in Settings</Link>
              </p>
            </div>
          </section>
          <section className="card">
            <h2>Upload a tax statement</h2>
            <fieldset disabled={demo} className="plain">
              <TaxFileForm owners={data.owners} fy={data.taxFy} />
            </fieldset>
          </section>
          <section className="card" style={{ gridColumn: '1 / -1' }}>
            <h2>On file</h2>
            {data.tax.length === 0 ? (
              <p className="empty">
                Nothing uploaded yet. Papers for {data.taxFy} are the ones to file with now.
              </p>
            ) : (
              <table className="tbl lines responsive">
                <thead>
                  <tr>
                    <th>Whose</th>
                    <th>Year</th>
                    <th>Statement</th>
                    <th>Uploaded</th>
                    <th>Read by</th>
                  </tr>
                </thead>
                <tbody>
                  {data.tax.map((t) => (
                    <tr key={`${t.owner}${t.fy}${t.kind}`}>
                      <td data-label="Whose">{t.owner}</td>
                      <td data-label="Year">{t.fy}</td>
                      <td data-label="Statement">{t.kind === '26as' ? 'Form 26AS' : 'AIS'}</td>
                      <td data-label="Uploaded">{longDate(t.uploadedOn)}</td>
                      <td data-label="Read by">
                        {t.readBy === 'ai' ? (
                          <span className="statuspill warn">AI: check the figures</span>
                        ) : (
                          <span className="statuspill ok">Rules</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="small">
              See the comparison with your records on{' '}
              <Link href="/tax/filing">Tax filing papers</Link>.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
