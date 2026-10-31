import Link from 'next/link';
import { formatInr, type InterestCheckRow } from '@fwos/core';
import { recordInterestDifference, undoInterestDifference } from './actions';

/** A year you settled: the earnings recorded against the interest reported. */
export interface InterestAnswer {
  key: string;
  ownerId: string;
  fy: string;
  /** + when the banks paid more than the estimate, − when less */
  amount: number;
  assetId: string | null;
}

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;
const statement = (k: 'ais' | '26as') => (k === 'ais' ? 'AIS' : 'Form 26AS');
const yearEnd = (fy: string) => `31 March ${Number(fy.slice(0, 4)) + 1}`;

/**
 * Transactions > Interest: for each person and finished year, the interest the banks reported to the tax department (AIS, or
 * Form 26AS) against what the app estimated for the same taxable accounts, before tax at source. A difference beyond the tolerance can
 * be recorded as that year's earnings in one step, and taken back.
 */
export function Interest({
  rows,
  answers,
  ownerName,
  accountsOf,
  act = { record: recordInterestDifference, undo: undoInterestDifference },
  sample = false,
}: {
  rows: InterestCheckRow[];
  answers: InterestAnswer[];
  ownerName: Record<string, string>;
  /** each person's own bank accounts, labelled, for where the difference is recorded */
  accountsOf: Record<string, { id: string; label: string }[]>;
  act?: { record: (f: FormData) => Promise<void>; undo: (f: FormData) => Promise<void> };
  sample?: boolean;
}) {
  const answered = new Map(answers.map((a) => [`${a.ownerId}|${a.fy}`, a]));
  const label = new Map(Object.values(accountsOf).flatMap((l) => l.map((a) => [a.id, a.label])));
  const flagged = rows.filter((r) => r.flagged && !answered.has(`${r.ownerId}|${r.fy}`)).length;
  const upload = sample ? null : '/tax/filing';
  return (
    <section className="card rc" aria-labelledby="rc-i">
      <h2 id="rc-i">Interest: what the banks reported against the app&apos;s estimate</h2>
      <p className="muted small">
        Banks report the interest they paid each person to the tax department, in the Annual
        Information Statement (AIS) and Form 26AS. The app compares it, year by year, with the
        interest it estimated for the same accounts and deposits (NRO and resident only: NRE
        interest is tax-free and not reported). A difference means the app&apos;s rates or dates
        were off. Recording it puts that year&apos;s interest into lifetime profit; it does not
        change any balance.
      </p>
      <p className="small" data-testid="rc-i-cover">
        {rows.length === 0
          ? 'No AIS or Form 26AS has been added yet. '
          : `${rows.length} statement${rows.length === 1 ? '' : 's'} compared; ${flagged === 0 ? 'nothing to settle' : `${flagged} year${flagged === 1 ? '' : 's'} to settle`}. `}
        {upload ? (
          <>
            Add a year&apos;s AIS (preferred) or Form 26AS on <Link href={upload}>Tax filing</Link>.
          </>
        ) : (
          'In your own portal, a year’s AIS or Form 26AS is added on Tax filing.'
        )}
      </p>
      {rows.length > 0 && (
        <ul className="rc-list">
          {rows.map((r) => {
            const key = `${r.ownerId}|${r.fy}`;
            const done = answered.get(key);
            const accounts = accountsOf[r.ownerId] ?? [];
            return (
              <li
                key={key}
                className="rc-item"
                data-fy={r.fy}
                data-state={
                  done
                    ? 'settled'
                    : !r.complete
                      ? 'running'
                      : !r.covered
                        ? 'before'
                        : r.flagged
                          ? 'flagged'
                          : 'ok'
                }
              >
                <div className="rc-what">
                  <strong>
                    {ownerName[r.ownerId] ?? 'Someone'} · {r.fy}
                  </strong>
                  <div className="small">
                    {statement(r.kind)} reports {formatInr(Math.round(r.reported))}; the app
                    estimated {formatInr(Math.round(r.estimated))}.
                  </div>
                  <div className="rc-amount">{signed(r.difference)}</div>
                  <div className="muted small">
                    {done
                      ? `Settled: ${signed(done.amount)} recorded as earnings${done.assetId && label.get(done.assetId) ? ` on ${label.get(done.assetId)}` : ''}.`
                      : !r.complete
                        ? `The year is still running: compare after ${yearEnd(r.fy)}, once the banks have reported it all.`
                        : !r.covered
                          ? 'The year starts before your first records, so there is nothing to compare it with.'
                          : r.flagged
                            ? r.difference > 0
                              ? 'The banks paid more than the app estimated.'
                              : 'The banks paid less than the app estimated.'
                            : 'Close enough: nothing to do.'}
                  </div>
                  {r.bySource.length > 0 && (
                    <details className="small">
                      <summary>By payer</summary>
                      <ul className="list">
                        {r.bySource.map((s) => (
                          <li key={s.source}>
                            {s.source}: {formatInr(Math.round(s.amount))}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
                {done ? (
                  <form action={act.undo} className="rc-form">
                    <input type="hidden" name="key" value={done.key} />
                    <button className="btn ghost">Undo</button>
                  </form>
                ) : r.flagged ? (
                  <form action={act.record} className="rc-form">
                    <input type="hidden" name="fy" value={r.fy} />
                    <input type="hidden" name="owner" value={r.ownerId} />
                    <input
                      type="hidden"
                      name="direction"
                      value={r.difference > 0 ? 'more' : 'less'}
                    />
                    <label>
                      Record on
                      <select name="asset" defaultValue={accounts[0]?.id ?? ''} required>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {accounts.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Amount (₹)
                      <input
                        name="amount"
                        inputMode="decimal"
                        defaultValue={String(Math.abs(Math.round(r.difference)))}
                        required
                      />
                    </label>
                    <button className="btn primary">
                      Record as {r.difference > 0 ? 'extra' : 'less'} earnings for {r.fy}
                    </button>
                    <span className="muted small">
                      Dated {yearEnd(r.fy)}. Any of the person&apos;s accounts will do: only the
                      year&apos;s profit changes.
                    </span>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
