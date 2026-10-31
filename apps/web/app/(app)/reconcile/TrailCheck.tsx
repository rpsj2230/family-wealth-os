import Link from 'next/link';
import {
  formatInr,
  formatInrCompact,
  twoWayPeople,
  type Classified,
  type StmtLine,
} from '@fwos/core';
import { niceDate } from '@/lib/dates';
import { recordTwoWayLoan } from './statement-actions';

const INTERNAL = new Set(['own_transfer', 'fd_funding', 'fd_proceeds', 'fund_buy', 'fund_sell']);

/**
 * Transactions > Bank statements: how complete the money trail is, and the people who both received money and paid some back.
 *  - The trail: every line that moves money between your own holdings (accounts, deposits, funds) should name the holding on its
 *    other side. Those that do not are listed, largest first: each is a break in the chain from where money came from to where it is.
 *  - People who paid you back: listed once each, to be recorded as money lent if that is what it was (never assumed).
 */
export function TrailCheck({
  lines,
  classified,
  labels,
  ownNames,
  ownerNames,
  borrowers,
  minimum,
  sample = false,
  act = recordTwoWayLoan,
}: {
  lines: StmtLine[];
  classified: Classified[];
  labels: Record<string, string>;
  ownNames: string[];
  ownerNames: Record<string, string>;
  /** people already recorded as owing money */
  borrowers: string[];
  /** Settings: the asking limit */
  minimum: number;
  sample?: boolean;
  act?: (f: FormData) => Promise<void>;
}) {
  const byId = new Map(lines.map((l) => [l.id, l]));
  const internal = classified.filter((c) => INTERNAL.has(c.cls));
  const open = internal
    .filter((c) => !c.counterpart && !c.remittanceId)
    .map((c) => ({ c, l: byId.get(c.id)! }))
    .filter((x) => x.l)
    .sort((a, b) => Math.abs(b.l.amount) - Math.abs(a.l.amount));
  const sum = (xs: { amount: number }[]) => xs.reduce((a, x) => a + Math.abs(x.amount), 0);
  const all = sum(internal.map((c) => byId.get(c.id)!).filter(Boolean));
  const gap = sum(open.map((x) => x.l));
  const traced = all > 0 ? 1 - gap / all : 1;
  const people = twoWayPeople(lines, classified, { ownNames, borrowers, minimum });
  return (
    <>
      <section className="card rc" aria-labelledby="rc-trail" data-testid="rc-s-trail">
        <h2 id="rc-trail">Money trail: how complete it is</h2>
        <p className="small">
          <strong>{(traced * 100).toFixed(1)}%</strong> of the money moved between your own
          accounts, deposits and funds names the holding on its other side.{' '}
          {open.length === 0
            ? 'Every such line is traced.'
            : `${open.length} line${open.length === 1 ? '' : 's'} (${formatInrCompact(gap)}) do not yet: largest first below. Most are closed by a statement of the other account, or by the deposit's number.`}
        </p>
        {open.length > 0 && (
          <div className="rc-scroll">
            <table className="table small">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Account</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col">As the bank wrote it</th>
                  <th scope="col">Why</th>
                </tr>
              </thead>
              <tbody>
                {open.slice(0, 25).map(({ c, l }) => (
                  <tr key={c.id}>
                    <td>{niceDate(l.date)}</td>
                    <td>
                      {sample ? (
                        (labels[l.assetId] ?? 'An account')
                      ) : (
                        <Link href={`/asset/${l.assetId}/line/${l.id}`}>
                          {labels[l.assetId] ?? 'An account'}
                        </Link>
                      )}
                    </td>
                    <td className="num">{formatInr(Math.round(l.amount))}</td>
                    <td>{l.narration || '—'}</td>
                    <td className="muted">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {people.length > 0 && (
        <section className="card rc" aria-labelledby="rc-2way" data-testid="rc-s-people">
          <h2 id="rc-2way">People who were paid and paid back</h2>
          <p className="muted small">
            The bank lines name each of them receiving money from you and, later, paying money in.
            That is often money lent, but it can be a shop or a shared bill, so it is not assumed.
            If it was a loan, record it once: every line naming them, past and future, is then money
            lent and paid back.
          </p>
          <ul className="rc-list">
            {people.map((p) => (
              <li key={p.name} className="rc-item">
                <div className="rc-what">
                  <strong>{p.name}</strong>
                  <div className="small">
                    Paid {formatInr(Math.round(p.out))} ({p.outLines} line
                    {p.outLines === 1 ? '' : 's'}) from {niceDate(p.firstOut)}; paid back{' '}
                    {formatInr(Math.round(p.into))} ({p.inLines} line{p.inLines === 1 ? '' : 's'}),
                    the last on {niceDate(p.lastIn)}.
                    {ownerNames[p.ownerId]
                      ? ` Paid mostly from ${ownerNames[p.ownerId]}’s accounts.`
                      : ''}
                  </div>
                </div>
                {!sample && (
                  <form action={act}>
                    <input type="hidden" name="name" value={p.name} />
                    <input type="hidden" name="owner" value={p.ownerId} />
                    <input type="hidden" name="lent" value={String(Math.round(p.out))} />
                    <input type="hidden" name="lent_on" value={p.firstOut} />
                    <button className="btn">Record as money lent</button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
