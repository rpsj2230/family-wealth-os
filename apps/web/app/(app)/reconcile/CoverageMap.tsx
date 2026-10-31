import Link from 'next/link';
import { formatInr, type Disagreement, type StatementCoverageRow } from '@fwos/core';
import { niceDate } from '@/lib/dates';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const month = (k: string) => `${MON[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
const range = (r: { from: string; to: string }) =>
  r.from === r.to ? month(r.from) : `${month(r.from)} – ${month(r.to)}`;

/**
 * Transactions > Bank statements: is every statement there? For each bank account, the months from its first record to today (or
 * its last record) its statements cover in full, the months missing, and the breaks in the chain (days no statement covers; a
 * statement that does not open where the one before closed). Inside the covered periods the bank's own balances are the account's
 * balances; a typed balance there that differs from the bank's is listed below, with the bank's figure.
 */
export function CoverageMap({
  rows,
  labels,
  disagreements,
  sample = false,
}: {
  rows: StatementCoverageRow[];
  labels: Record<string, string>;
  disagreements: Disagreement[];
  sample?: boolean;
}) {
  const months = rows.reduce((a, r) => a + r.months.length, 0);
  const full = rows.reduce((a, r) => a + r.full, 0);
  const complete = rows.filter((r) => r.full === r.months.length && r.breaks.length === 0).length;
  const name = (id: string) => labels[id] ?? 'An account';
  const sorted = [...rows].sort(
    (a, b) => a.full / (a.months.length || 1) - b.full / (b.months.length || 1),
  );
  return (
    <section className="card rc" aria-labelledby="rc-cov" data-testid="rc-s-coverage">
      <h2 id="rc-cov">Are all the statements here?</h2>
      <p className="small">
        <strong>{months > 0 ? ((full / months) * 100).toFixed(1) : '0'}%</strong> of the account
        months are covered by a bank statement in full; {complete} of {rows.length} account
        {rows.length === 1 ? '' : 's'} are complete, with no break in the chain. Inside the covered
        months the bank&rsquo;s own balances are used, not the typed ones.
      </p>
      <div className="rc-scroll">
        <table className="table small">
          <thead>
            <tr>
              <th scope="col">Account</th>
              <th scope="col" className="num">
                Months covered
              </th>
              <th scope="col">Missing</th>
              <th scope="col">Breaks in the chain</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.assetId}>
                <th scope="row">
                  {sample ? (
                    name(r.assetId)
                  ) : (
                    <Link href={`/asset/${r.assetId}`}>{name(r.assetId)}</Link>
                  )}
                </th>
                <td className="num">
                  {r.full} of {r.months.length}
                </td>
                <td>{r.missing.length ? r.missing.map(range).join(', ') : '—'}</td>
                <td>
                  {r.breaks.length
                    ? r.breaks
                        .map((b) =>
                          b.kind === 'gap'
                            ? `no statement ${niceDate(b.from)} to ${niceDate(b.to)}`
                            : `opens at ${formatInr(Math.round(b.opened))} on ${niceDate(b.on)}, the one before closed at ${formatInr(Math.round(b.closed))}`,
                        )
                        .join('; ')
                    : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {disagreements.length > 0 && (
        <details className="small">
          <summary>
            {disagreements.length} typed balance{disagreements.length === 1 ? '' : 's'} differ
            {disagreements.length === 1 ? 's' : ''} from the bank&rsquo;s (the bank&rsquo;s is used)
          </summary>
          <ul className="list">
            {disagreements.slice(0, 50).map((d) => (
              <li key={`${d.assetId}|${d.date}`}>
                {name(d.assetId)}, {niceDate(d.date)}: typed {formatInr(Math.round(d.typed))}, the
                bank {formatInr(Math.round(d.bank))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
