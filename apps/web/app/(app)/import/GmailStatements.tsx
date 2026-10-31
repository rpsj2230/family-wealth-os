import Link from 'next/link';
import { longDate } from '@fwos/core';
import { REQUEST_PAGES, bankSenderDomains } from '@fwos/ingest';
import { lastScanText, runTimesText, type GmailModel } from '@/lib/gmail-statements';
import {
  CancelRequest,
  RequestStatement,
  ScanNow,
  StatementPasswords,
  SwitchButton,
} from './GmailForms';
import './gmail.css';

const OUTCOME = {
  imported: { tone: 'ok', text: 'Imported' },
  partial: { tone: 'warn', text: 'Imported, check some' },
  failed: { tone: 'bad', text: 'Not read' },
  ignored: { tone: 'warn', text: 'Skipped' },
} as const;

const STATE_TONE = { waiting: 'info', late: 'warn', arrived: 'ok', cancelled: 'info' } as const;
const STATE_WORD = {
  waiting: 'Waiting',
  late: 'Late',
  arrived: 'Arrived',
  cancelled: 'Cancelled',
} as const;

function MailIcon() {
  return (
    <svg
      className="gm-icon"
      viewBox="0 0 24 24"
      width="28"
      height="28"
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="14"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M4 7.5 12 13l8-5.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * “Read my fund statements from Gmail” on Import > Fund statement: what is switched on, which senders, the last scan and the statements
 * it read, Scan now and Switch off, then the help, the guided request for a full statement and the write-only statement passwords. The
 * signed-in page and the public sample both draw this from a `GmailModel`.
 */
export function GmailStatements({ model: m, demo = false }: { model: GmailModel; demo?: boolean }) {
  const status = !m.enabled
    ? { tone: 'warn', text: 'Switched off' }
    : m.running
      ? { tone: 'info', text: 'Reading now' }
      : m.waiting
        ? { tone: 'info', text: 'Scan requested' }
        : { tone: 'ok', text: 'On' };
  const people = m.people.map((p) => ({ id: p.id, name: p.name, passwords: p.passwords }));
  return (
    <section className="card gm" id="gmail-statements" aria-labelledby="gm-title">
      <header className="gm-head">
        <MailIcon />
        <div className="gm-headtext">
          <h2 id="gm-title">Read my fund statements from Gmail</h2>
          <p className="small">
            Statements e-mailed by CAMS, KFintech, NSDL and CDSL are found in your Gmail and
            imported by themselves. You do not forward or label anything.
          </p>
        </div>
        <span className={`statuspill ${status.tone}`}>{status.text}</span>
      </header>
      <ul className="gm-chips" aria-label="What to expect">
        <li>Read only</li>
        <li>No AI used</li>
        <li>Switch off any time</li>
      </ul>

      <dl className="lastresult gm-facts">
        <dt>Mailbox</dt>
        <dd>
          {m.mailbox ? (
            <>
              <span className="mono">{m.mailbox}</span> (the Gmail the app already uses)
            </>
          ) : (
            'Your Gmail (the one set up for the daily summary)'
          )}
        </dd>
        <dt>Senders</dt>
        <dd>
          <span className="gm-senders">
            {m.senders.map((s) => (
              <span key={s} className="gm-sender">
                {s}
              </span>
            ))}
          </span>{' '}
          <Link href="/settings?tab=rules#gmail-statements">Edit in Settings</Link>
        </dd>
        <dt>Last scan</dt>
        <dd data-testid="gm-last">
          {lastScanText(m)}
          {m.last && !m.last.ok && <span className="statuspill bad"> Did not finish</span>}
        </dd>
      </dl>

      <div className="gm-actions">
        <fieldset disabled={demo} className="plain gm-actionset">
          <ScanNow disabled={!m.enabled || !!m.waiting} />
          <SwitchButton enabled={m.enabled} />
        </fieldset>
      </div>
      {m.waiting && (
        <p className="notice" role="status">
          A scan was requested on {longDate(m.waiting.requestedAt.slice(0, 10))}. The job starts
          every 6 hours ({runTimesText()}) and picks the request up then. To run it at once, open
          Actions on GitHub, choose “Read fund statements from Gmail” and press Run workflow.
        </p>
      )}

      <h3 className="gm-sub">Last statements read</h3>
      {m.items.length === 0 ? (
        <p className="empty small">
          {m.never
            ? 'Nothing has been read yet. The first scan looks back about a year, so the past statements arrive together.'
            : 'The last scan found no new statement.'}
        </p>
      ) : (
        <table className="tbl lines responsive gm-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>From</th>
              <th>Whose</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {m.items.map((it) => (
              <tr key={it.key}>
                <td data-label="Date">{longDate(it.date)}</td>
                <td data-label="From">{it.registrar}</td>
                <td data-label="Whose">{it.person ?? 'Not matched'}</td>
                <td data-label="Result">
                  <span className={`statuspill ${OUTCOME[it.outcome].tone}`}>
                    {OUTCOME[it.outcome].text}
                  </span>
                  <div className="small">{it.text}</div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="small muted">
        What each statement changed is listed under{' '}
        <a href="#recent-statements">Recent statements</a> below.
      </p>

      <details className="disclose gm-help">
        <summary>How to get statements in your Gmail</summary>
        <ol className="howto small">
          <li>
            <strong>Mutual funds (CAMS and KFintech).</strong> On{' '}
            <a href={REQUEST_PAGES.cams.url} target="_blank" rel="noopener noreferrer">
              camsonline.com
            </a>{' '}
            or{' '}
            <a href={REQUEST_PAGES.kfintech.url} target="_blank" rel="noopener noreferrer">
              mfs.kfintech.com
            </a>{' '}
            ask for a <strong>Consolidated Account Statement</strong>, type{' '}
            <strong>Detailed</strong>, and choose the monthly e-mail if it is offered. CAMS sends
            from <span className="mono">donotreply@camsonline.com</span> with the subject
            “Consolidated Account Statement - CAMS Mailback Request”.
          </li>
          <li>
            <strong>Demat holdings (NSDL and CDSL).</strong> Their monthly statement reaches the
            e-mail address registered with your depository account. Ask your broker to put your
            Gmail on it if it is not.
          </li>
          <li>
            <strong>The password to choose.</strong> Choose your{' '}
            <strong>PAN in capital letters</strong> as the password, where the page lets you. The
            app opens the statement with the PAN saved in Settings; nothing more to do.
          </li>
          <li>
            <strong>A family member’s statement</strong> arrives in their mailbox: forward it to the
            Gmail above (your own address, or any address listed under Settings, Bank e-mail
            forwarding, counts). It is read the same way.
          </li>
        </ol>
        <div className="rulebox small">
          <p>
            <strong>How the app reads your Gmail.</strong> It signs in with a Gmail app password
            over IMAP, not with Google sign-in, and opens the mailbox <em>read only</em>. It looks
            only at messages from the senders above, and only downloads those with a PDF. It never
            sends, deletes, labels, moves or marks anything as read, and no AI is used.
          </p>
          <p>
            What is read, and what to do if a statement does not arrive, is in the runbook
            (docs/runbooks/gmail-statements.md). Having trouble finding your statement?{' '}
            <a href={m.searchUrl} target="_blank" rel="noopener noreferrer">
              Search your inbox for these senders
            </a>
            .
          </p>
        </div>
      </details>

      <h3 className="gm-sub" id="request-statement">
        Request a full detailed statement
      </h3>
      <p className="small">
        <strong>Why you press the buttons.</strong> CAMS and KFintech’s request pages use a security
        check that a program must not bypass, and MF Central needs your own sign-in and a one-time
        code. So you ask on their own page, in a new tab, and the app does the rest: it reads the
        statement when it reaches your Gmail. Nothing is sent from here.
      </p>
      <div className="rulebox small">
        <p>
          <strong>Choose exactly these:</strong>
        </p>
        <ul className="gm-choose">
          <li>
            Statement: <strong>Detailed</strong> (not Summary)
          </li>
          <li>
            Period: from your <strong>first investment to today</strong> (MF Central allows up to
            365 days a time, so a full history needs several requests)
          </li>
          <li>
            Include folios with <strong>zero balance</strong>: yes
          </li>
          <li>
            E-mail: the Gmail above
            {m.mailbox ? (
              <>
                {' '}
                (<span className="mono">{m.mailbox}</span>)
              </>
            ) : null}
            , which is set up by the GitHub secret SMTP_USER, not in Settings
          </li>
          <li>
            Password: your <strong>PAN in capital letters</strong>. KFintech wants 8 to 12
            characters with a capital, a small letter, a number and a special character, which a PAN
            does not have: use CAMS, or choose a password there and save it below.
          </li>
        </ul>
      </div>
      <RequestStatement
        people={m.people.map((p) => ({ id: p.id, name: p.name }))}
        disabled={demo || m.people.length === 0}
      />
      {m.requests.length > 0 && (
        <ul className="gm-requests" aria-label="Statements you asked for">
          {m.requests.map((r) => (
            <li key={r.id}>
              <span className={`statuspill ${STATE_TONE[r.state]}`}>{STATE_WORD[r.state]}</span>
              <span className="small">{r.sentence}</span>
              {r.state !== 'arrived' && (
                <fieldset disabled={demo} className="plain">
                  <CancelRequest id={r.id} />
                </fieldset>
              )}
            </li>
          ))}
        </ul>
      )}
      <fieldset disabled={demo} className="plain">
        <ScanNow disabled={!m.enabled || !!m.waiting} />
      </fieldset>

      <details className="disclose gm-help" id="forward-bank-mail">
        <summary>Your banks’ alerts and statements: make sure they get the label</summary>
        <p className="small">
          The app reads your banks’ alerts and monthly statements only under the label set in
          Settings → Connections (FWOS/Inbox unless you changed it), in the Gmail it uses
          {m.mailbox ? (
            <>
              {' '}
              (<span className="mono">{m.mailbox}</span>)
            </>
          ) : null}
          . Nothing else in the mailbox is opened. One filter puts the label on every bank’s mail:
        </p>
        <ol className="small">
          <li>
            In that Gmail, create a filter with this in <em>From</em>, choose{' '}
            <em>Apply the label</em> (the one above), and tick{' '}
            <em>Also apply to matching conversations</em>:
            <pre className="mono gm-query" data-testid="bank-filter">
              {bankSenderDomains().join(' OR ')}
            </pre>
          </li>
          <li>
            If your banks write to another address, forward their mail to this Gmail first (in that
            mailbox: Settings → Forwarding, then a filter with the same <em>From</em> that forwards
            it). Gmail’s forwarding keeps the bank as the sender, so the filter above labels it.
          </li>
          <li>
            In each bank’s net banking, switch on an e-mail alert for every transaction and the
            monthly e-statement.
          </li>
        </ol>
        <p className="small muted">
          Transactions → Bank feed then shows, for every account, the last alert and e-statement
          that came in and up to which day its lines are complete.
        </p>
      </details>

      <details className="disclose gm-help" id="statement-passwords">
        <summary>Statement passwords (your banks’, and a fund statement not on your PAN)</summary>
        <p className="small">
          Some services choose a random password and e-mail it to you separately. If a statement
          could not be opened, type the password you were given for that person’s statement. It is
          saved write-only, like the PAN: it cannot be read back or seen again, only removed, and
          the app never reads a password out of an e-mail. The easier way is to ask for the
          statement again with your PAN as the password.
        </p>
        <p className="small">
          Your banks’ monthly statements are read the same way: save here the password each bank
          gives its statement for that person (often a mix of name and date of birth, or the
          customer ID), and every statement the bank e-mails is imported by itself.
        </p>
        <StatementPasswords people={people} disabled={demo || people.length === 0} />
      </details>
    </section>
  );
}
