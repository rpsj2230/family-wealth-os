import Link from 'next/link';
import { formatInr } from '@fwos/core';
import type { AccountLine } from '@fwos/data';
import { niceDate } from '@/lib/dates';
import './statementlines.css';

const signed = (n: number) => `${n >= 0 ? '+' : '−'}${formatInr(Math.abs(n))}`;

/**
 * Every line of the account's bank statements, newest first, by year. A line opens its own page: what it is, why, and where its
 * money came from (its trail).
 */
export function StatementLines({
  assetId,
  lines,
  lineHref = (l) => `/asset/${assetId}/line/${l}`,
  answerHref = '/reconcile?tab=statements',
}: {
  assetId: string;
  lines: AccountLine[];
  lineHref?: (lineId: string) => string;
  answerHref?: string;
}) {
  if (lines.length === 0) return null;
  const years = [...new Set(lines.map((l) => l.date.slice(0, 4)))];
  const ins = lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0);
  const outs = lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0);
  const open = lines.filter((l) => l.toAnswer).length;
  return (
    <section className="detailsection" aria-labelledby="sl-h" data-testid="statement-lines">
      <h2 id="sl-h">Transactions from the bank statements</h2>
      <p className="muted small">
        {lines.length} lines from {niceDate(lines[lines.length - 1]!.date)} to{' '}
        {niceDate(lines[0]!.date)}: {formatInr(ins)} in, {formatInr(outs)} out.
        {open > 0 && (
          <>
            {' '}
            {open} still to answer in <Link href={answerHref}>Explain movements</Link>.
          </>
        )}{' '}
        Open a line to see what it was and where its money came from.
      </p>
      {years.map((y, i) => (
        <details key={y} className="sl-year" open={i === 0}>
          <summary>
            {y}{' '}
            <span className="muted small">
              · {lines.filter((l) => l.date.startsWith(y)).length} lines
            </span>
          </summary>
          <div className="sl-scroll">
            <table className="table small">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">What the bank wrote</th>
                  <th scope="col">What it is</th>
                  <th scope="col" className="num">
                    Amount
                  </th>
                  <th scope="col" className="num">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines
                  .filter((l) => l.date.startsWith(y))
                  .map((l) => (
                    <tr key={l.id} className={l.toAnswer ? 'sl-ask' : undefined}>
                      <td className="sl-date">
                        <Link href={lineHref(l.id)}>{niceDate(l.date)}</Link>
                      </td>
                      <td className="sl-narr">
                        <Link href={lineHref(l.id)}>{l.narration || '—'}</Link>
                      </td>
                      <td>{l.kind}</td>
                      <td className={`num ${l.amount >= 0 ? 'good' : ''}`}>{signed(l.amount)}</td>
                      <td className="num muted">
                        {l.balance === null ? '—' : formatInr(l.balance)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </details>
      ))}
    </section>
  );
}
