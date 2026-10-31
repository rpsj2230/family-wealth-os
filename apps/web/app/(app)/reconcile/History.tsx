import Link from 'next/link';
import { formatInr, formatInrCompact, type HistoryReview } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import type { HistoryAnswer } from '@/lib/history-data';
import { markClosed, recordHistory, undoHistory } from './actions';

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
/** What the records say about a month by themselves, in words: accounts first recorded, accounts closed into another. */
function explainedBy(m: HistoryReview['open'][number], label: Map<string, string>): string {
  return [
    ...(m.firstRecorded ?? []).map(
      (f) => `${label.get(f.assetId) ?? f.name} first recorded at ${formatInrCompact(f.value)}`,
    ),
    ...(m.closedInto ?? []).map(
      (c) =>
        `${label.get(c.assetId) ?? c.name} (${formatInrCompact(c.value)}) closed into ${label.get(c.into) ?? c.intoName}`,
    ),
  ].join(', ');
}

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
  minimumPct = 0,
  act = { record: recordHistory, undo: undoHistory, close: markClosed },
  sample = false,
}: {
  review: HistoryReview;
  answers: HistoryAnswer[];
  holdings: { id: string; label: string }[];
  opening: string | null;
  minimum: number;
  /** Settings: the share of net worth below which a month is not asked about either */
  minimumPct?: number;
  /** the actions the forms run (on the public sample, ones that save nothing) */
  act?: {
    record: (f: FormData) => Promise<void>;
    undo: (f: FormData) => Promise<void>;
    close?: (f: FormData) => Promise<void>;
  };
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
            `${review.small.count} smaller month${review.small.count === 1 ? '' : 's'} (each under ${minimumPct > 0 ? `the larger of ${formatInr(minimum)} and ${(minimumPct * 100).toFixed(2)}% of net worth` : formatInr(minimum)}, ${formatInrCompact(review.small.total)} in all) ${review.small.count === 1 ? 'is' : 'are'} counted as your own money but not asked about; the limits are in `}
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
                      {m.gross !== undefined && explainedBy(m, label)
                        ? ` (of ${signed(m.gross)}; ${explainedBy(m, label)} is already explained)`
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
            month, or an account&rsquo;s money arriving in another when it was closed: money that
            was already yours, not new money. It counts as own money, never as profit, and needs no
            answer.
          </p>
          <ul className="list small">
            {review.settled.map((m) => (
              <li key={m.key}>
                <strong>{monthName(m.key)}</strong> {signed(m.gross ?? m.amount)}:{' '}
                {explainedBy(m, label)}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.closures.length > 0 && (
        <section className="card rc" aria-labelledby="rc-cl" data-testid="rc-h-closures">
          <h2 id="rc-cl">Accounts that look closed</h2>
          <p className="muted small">
            Nothing has been recorded for these accounts for months while the others were, and soon
            after their last record the same sum arrived in another of your accounts. While they are
            still counted, that money counts twice. Marking one closed stops it counting after its
            last record.
          </p>
          <ul className="rc-list">
            {review.closures.map((c) => (
              <li key={c.assetId} className="rc-item">
                <div className="rc-what">
                  <strong>{label.get(c.assetId) ?? c.name}</strong>
                  <div className="small">
                    {formatInrCompact(c.value)} last recorded {niceDate(c.lastOn)}; the same sum
                    arrived in {label.get(c.into) ?? c.intoName} by {niceDate(c.on)}.
                  </div>
                </div>
                {act.close && !sample && (
                  <form action={act.close}>
                    <input type="hidden" name="asset" value={c.assetId} />
                    <button className="btn primary">Mark closed</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {review.byStatements.length > 0 && (
        <section className="card rc" aria-labelledby="rc-bs" data-testid="rc-h-statements">
          <h2 id="rc-bs">Months the bank statements decide</h2>
          <p className="muted small">
            Every account that moved in these months is covered by its bank statements for the whole
            month, so each line is sorted on its own (between your accounts, deposits, funds, money
            in or out). A line that still needs you is asked once, on Transactions → Bank
            statements, never here.
          </p>
          <ul className="list small">
            {review.byStatements.map((m) => (
              <li key={m.key}>
                <strong>{monthName(m.key)}</strong> {signed(m.amount)}
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
