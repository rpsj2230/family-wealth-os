import Link from 'next/link';
import { formatInr, formatInrCompact, type HistoryReview } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { HistoryAnswer } from '@/lib/history-data';
import { recordHistory, undoHistory } from './actions';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(Math.round(n)))}`;
const monthName = (key: string) =>
  new Date(`${key}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
/** a day in the middle of the month, but never after its last day with records */
const midMonth = (from: string, through: string) => {
  const mid = `${from.slice(0, 7)}-15`;
  return mid > through ? through : mid < from ? from : mid;
};
const KIND: Record<string, string> = {
  contribution: 'Money from outside',
  withdrawal: 'Money withdrawn',
  income: 'Earnings the app did not estimate',
};

/**
 * Explain movements > Earlier months: the months whose money moved in or out with nothing to say what it was, largest first, each with
 * the holdings that changed most, a short form to say what it was, the answers already given (with Undo) and the pairs of months that
 * cancel out.
 */
export function History({
  review,
  answers,
  holdings,
  opening,
  minimum,
  act = { record: recordHistory, undo: undoHistory },
  sample = false,
}: {
  review: HistoryReview;
  answers: HistoryAnswer[];
  holdings: { id: string; label: string }[];
  opening: string | null;
  minimum: number;
  /** the actions the forms run (on the public sample, ones that save nothing) */
  act?: { record: (f: FormData) => Promise<void>; undo: (f: FormData) => Promise<void> };
  /** the public sample: holdings have no pages of their own */
  sample?: boolean;
}) {
  const label = new Map(holdings.map((h) => [h.id, h.label]));
  const share = review.openTotal > 0 ? review.listedTotal / review.openTotal : 0;
  return (
    <>
      <section className="card rc" aria-labelledby="rc-h">
        <h2 id="rc-h">Earlier months: money that moved with nothing to say what it was</h2>
        <p className="muted small">
          From the monthly balances since {opening ? niceDate(opening) : 'the first records'}, the
          app works out each month&apos;s interest and price changes. Whatever is left over is money
          that came in or went out. Until you say what it was, it counts as your own money and never
          as profit. Answering the largest months first settles most of it.
        </p>
        <p className="small" data-testid="rc-h-cover">
          {review.open.length === 0
            ? 'Nothing above the limit is waiting.'
            : `${review.open.length} month${review.open.length === 1 ? '' : 's'} listed: ${formatInrCompact(review.listedTotal)} of ${formatInrCompact(review.openTotal)} not yet explained (${Math.round(share * 100)}%).`}{' '}
          {review.small.count > 0 &&
            `${review.small.count} smaller month${review.small.count === 1 ? '' : 's'} (under ${formatInr(minimum)} each, ${formatInrCompact(review.small.total)} in all) are left out; the limit is in `}
          {review.small.count > 0 && (
            <Link
              href={sample ? '/demo/settings?tab=rules#estimates' : '/settings?tab=rules#estimates'}
            >
              Settings
            </Link>
          )}
          {review.small.count > 0 && '.'}
        </p>
        {review.open.length > 0 && (
          <ul className="rc-list">
            {review.open.map((m) => {
              const into = m.amount > 0;
              const likely =
                m.changes.find((c) => Math.sign(c.change) === Math.sign(m.amount)) ?? m.changes[0];
              return (
                <li key={m.key} className="rc-item" data-month={m.key}>
                  <div className="rc-what">
                    <strong>{monthName(m.key)}</strong>
                    <div className="rc-amount">{signed(m.amount)}</div>
                    <div className="muted small">
                      {into ? 'came in' : 'went out'} with nothing to say what it was
                      {m.firstRecorded?.length && m.gross !== undefined
                        ? ` (of ${signed(m.gross)}; ${m.firstRecorded.map((f) => `${label.get(f.assetId) ?? f.name} first recorded at ${formatInrCompact(f.value)}`).join(', ')} is already explained)`
                        : ''}
                    </div>
                    {m.changes.length > 0 && (
                      <ul className="small rc-changes">
                        {m.changes.map((c) => (
                          <li key={c.assetId}>
                            {sample ? (
                              <strong>{label.get(c.assetId) ?? c.name}</strong>
                            ) : (
                              <Link href={`/asset/${c.assetId}`}>
                                {label.get(c.assetId) ?? c.name}
                              </Link>
                            )}{' '}
                            {c.before === null
                              ? `appeared at ${formatInrCompact(c.after ?? 0)}`
                              : c.after === null
                                ? `ended (was ${formatInrCompact(c.before)})`
                                : `${signed(c.change)}`}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <form action={act.record} className="rc-form">
                    <input type="hidden" name="month" value={m.key} />
                    <fieldset>
                      <legend className="small">It was</legend>
                      <label className="rc-choice">
                        <input type="radio" name="answer" value="outside" defaultChecked={into} />
                        Money from outside (salary, a remittance, a gift, a sale)
                      </label>
                      <label className="rc-choice">
                        <input type="radio" name="answer" value="out" defaultChecked={!into} />
                        Money withdrawn (spent, given, sent abroad)
                      </label>
                      <label className="rc-choice">
                        <input type="radio" name="answer" value="income" />
                        Earnings the app did not estimate (interest, a bonus, a refund)
                      </label>
                    </fieldset>
                    <label>
                      Into or from
                      <select name="asset" defaultValue={likely?.assetId ?? ''} required>
                        <option value="" disabled>
                          Choose…
                        </option>
                        {holdings.map((h) => (
                          <option key={h.id} value={h.id}>
                            {h.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      On
                      <input
                        type="date"
                        name="on"
                        defaultValue={midMonth(m.from, m.through)}
                        min={m.from}
                        max={m.through}
                        required
                      />
                    </label>
                    <label>
                      Amount (₹)
                      <input
                        name="amount"
                        inputMode="decimal"
                        defaultValue={String(Math.abs(Math.round(m.amount)))}
                        required
                      />
                    </label>
                    <button className="btn primary">Save</button>
                    <span className="muted small">
                      Part of it? Type that part: the rest stays listed.
                    </span>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {review.settled.length > 0 && (
        <section className="card rc" aria-labelledby="rc-fr" data-testid="rc-h-settled">
          <h2 id="rc-fr">Months explained by the records themselves</h2>
          <p className="muted small">
            The money of these months is an account or deposit first entered in the records that
            month: money that was already yours, not new money. It counts as own money, never as
            profit, and needs no answer.
          </p>
          <ul className="list small">
            {review.settled.map((m) => (
              <li key={m.key}>
                <strong>{monthName(m.key)}</strong> {signed(m.gross ?? m.amount)}:{' '}
                {(m.firstRecorded ?? [])
                  .map(
                    (f) =>
                      `${label.get(f.assetId) ?? f.name} first recorded at ${formatInrCompact(f.value)}`,
                  )
                  .join(', ')}
              </li>
            ))}
          </ul>
        </section>
      )}

      {answers.length > 0 && (
        <section className="card rc" aria-labelledby="rc-a">
          <h2 id="rc-a">Your answers for earlier months</h2>
          <ul className="rc-list">
            {answers.map((a) => (
              <li key={a.key} className="rc-item">
                <div className="rc-what">
                  <strong>{KIND[a.kind] ?? a.kind}</strong> · {formatInr(Math.round(a.amount))} on{' '}
                  {niceDate(a.on)}
                  {a.assetId && (
                    <span className="muted small"> · {label.get(a.assetId) ?? 'a holding'}</span>
                  )}
                </div>
                <form action={act.undo}>
                  <input type="hidden" name="key" value={a.key} />
                  <button className="btn ghost">Undo</button>
                </form>
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.cancelling.length > 0 && (
        <section className="card rc" aria-labelledby="rc-c">
          <h2 id="rc-c">Months that cancel out: nothing to answer</h2>
          <p className="muted small">
            The same sum left in one month and came back in a month or two: most likely a transfer
            between your own accounts that the monthly tabs recorded in two different months. Own
            money is unchanged by it.
          </p>
          <ul className="list small">
            {review.cancelling.map((p) => (
              <li key={p.first.key}>
                {monthName(p.first.key)} {signed(p.first.amount)} and {monthName(p.second.key)}{' '}
                {signed(p.second.amount)}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
