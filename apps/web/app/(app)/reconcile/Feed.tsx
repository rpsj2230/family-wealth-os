import Link from 'next/link';
import { formatInr, type FeedStatusRow } from '@fwos/core';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso: string | null) =>
  iso ? `${Number(iso.slice(8, 10))} ${MON[Number(iso.slice(5, 7)) - 1]} ${iso.slice(2, 4)}` : '—';

const STATE: Record<FeedStatusRow['state'], { label: string; tone: string }> = {
  ok: { label: 'Complete', tone: 'ok' },
  gap: { label: 'Money moved with no alert', tone: 'warn' },
  silent: { label: 'Silent', tone: 'warn' },
  none: { label: 'No e-mails yet', tone: '' },
};

/**
 * Explain movements > Bank feed: for each account, what the bank's e-mails have told us and until when its lines are complete, so it
 * can be seen that nothing was dropped. Money that moved with no alert is listed with the days it can be in; the month's e-statement
 * fills it in by itself, or the rows can be pasted on Import.
 */
export function Feed({
  rows,
  mail,
}: {
  rows: (FeedStatusRow & { label: string })[];
  mail: { since: string; applied: number; waiting: number; passed: number; errors: number };
}) {
  const total = mail.applied + mail.waiting + mail.passed + mail.errors;
  const ok = rows.filter((r) => r.state === 'ok').length;
  return (
    <section className="card" aria-labelledby="feed-h" data-testid="bank-feed">
      <h2 id="feed-h">Bank feed</h2>
      <p className="muted small">
        Every alert and e-statement your banks e-mail is read by itself. An account is complete
        through a day when every balance the bank gave up to then follows from its lines.
      </p>
      <p className="small" role="status">
        Bank e-mails since {day(mail.since)}: <strong>{total}</strong> read: {mail.applied} used,{' '}
        {mail.waiting} waiting for you{mail.waiting ? ' (Inbox)' : ''}, {mail.passed} passed over
        {mail.errors ? `, ${mail.errors} could not be read` : ''}. Accounts complete: {ok} of{' '}
        {rows.length}.
      </p>
      {total === 0 && (
        <p className="notice warn">
          No bank e-mail has reached the app’s mailbox lately. In the mailbox your banks write to,
          forward their mail to the app’s address (one filter covers every bank: Import → Gmail
          statements), or register the app’s address with each bank.
        </p>
      )}
      <div className="tablewrap">
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col">Last alert</th>
              <th scope="col">Last e-statement</th>
              <th scope="col">Last balance by e-mail</th>
              <th scope="col">Complete through</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.accountId}>
                <th scope="row">
                  <Link href={`/asset/${r.accountId}`}>{r.label}</Link>
                </th>
                <td>{day(r.lastAlert)}</td>
                <td>{day(r.lastEStatement)}</td>
                <td>{day(r.lastEmailBalance)}</td>
                <td>{day(r.provenThrough)}</td>
                <td>
                  <span className={`pill ${STATE[r.state].tone}`}>{STATE[r.state].label}</span>
                  {r.gaps.map((g) => (
                    <div key={g.to} className="small muted">
                      {g.amount < 0 ? '−' : '+'}
                      {formatInr(Math.abs(Math.round(g.amount)))} between {day(g.from)} and{' '}
                      {day(g.to)}
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">
        A month the e-mails missed: paste its rows on <Link href="/import">Import</Link> (Paste rows
        from net banking). Rows already on file are never added twice.
      </p>
    </section>
  );
}
