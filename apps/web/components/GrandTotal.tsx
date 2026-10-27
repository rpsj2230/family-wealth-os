import { formatInr, type Explain } from '@fwos/core';
import { WhyHead } from './Why';
import './grandtotal.css';

/**
 * The total at the bottom of a list of bank tables: invested or balance, what it pays at maturity, and today's value. The server
 * writes the figures for the person chosen; ListingTools then follows the search and column filters on the page (it adds up the rows that
 * are showing), so the total always matches what can be seen. It must sit inside the same ListingTools as the tables.
 */
export function GrandTotal({
  invested,
  maturity,
  current,
  lines,
  scope,
  why,
}: {
  /** the "?" that says how the totals are worked out */
  why?: Explain;
  invested: number;
  maturity: number;
  current: number;
  /** accounts and deposits counted */
  lines: number;
  scope: string | null;
}) {
  return (
    <section className="card grandtotal" data-grand aria-label="Total of the lines showing">
      <div className="gt-head">
        {why ? (
          <WhyHead why={why}>
            <h2>Total{scope ? ` · ${scope}` : ''}</h2>
          </WhyHead>
        ) : (
          <h2>Total{scope ? ` · ${scope}` : ''}</h2>
        )}
        <span className="gt-sub muted small">
          <b data-gt="n">{lines}</b> lines
          <span data-gt-filtered hidden>
            {' '}
            · only the lines showing under your search or filter
          </span>
        </span>
      </div>
      <dl className="gt-grid">
        <div>
          <dt>Invested / balance</dt>
          <dd data-gt="inv">{formatInr(Math.round(invested))}</dd>
        </div>
        <div>
          <dt>At maturity</dt>
          <dd data-gt="mat">{formatInr(Math.round(maturity))}</dd>
        </div>
        <div>
          <dt>Current value</dt>
          <dd data-gt="cur" className="gt-main">
            {formatInr(Math.round(current))}
          </dd>
        </div>
      </dl>
    </section>
  );
}
