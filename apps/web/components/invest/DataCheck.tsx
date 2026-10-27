import Link from 'next/link';
import { formatInr, unitsText, type LedgerVerdict, type PersonLedgerSummary } from '@fwos/core';
import { niceDate } from '@/lib/dates';
import './invest.css';

/** The small status chip of one fund: icon and words (never colour alone), with the full sentence on hover. */
export function LedgerChip({ chip }: { chip: LedgerVerdict['chip'] }) {
  return (
    <span className={`ledgerchip ${chip.tone}`} title={chip.title}>
      <span aria-hidden="true">{chip.icon}</span> {chip.label}
    </span>
  );
}

/**
 * Under a person's header on Investments: how many of their funds reconcile with their statements, what the rest need, and one
 * plain instruction to fix it. Opens by itself when something needs doing; a clean history stays one line.
 */
export function DataCheck({
  summary,
  fundHref,
}: {
  summary: PersonLedgerSummary;
  fundHref: (id: string) => string;
}) {
  const s = summary;
  const clean = s.need.length === 0 && !s.startsLate;
  return (
    <div className={`datacheck ${clean ? 'ok' : 'warn'}`} data-testid="data-check">
      <p className="dc-line">
        <span className="dc-icon" aria-hidden="true">
          {clean ? '✓' : '⚠'}
        </span>
        <b>Data check</b>
        <span>{s.headline}</span>
        {s.earliestTxnOn && !s.lateNote && (
          <span className="muted">Earliest transaction on file: {niceDate(s.earliestTxnOn)}.</span>
        )}
      </p>
      {s.lateNote && <p className="dc-late small">{s.lateNote}</p>}
      {(s.need.length > 0 || s.fix) && (
        <details className="dc-more" open={s.need.length > 0 && s.need.length <= 3}>
          <summary>
            {s.need.length > 0
              ? `Show the ${s.need.length} fund${s.need.length === 1 ? '' : 's'} that need${s.need.length === 1 ? 's' : ''} attention`
              : 'How to fix this'}
          </summary>
          {s.need.length > 0 && (
            <ul className="dc-list">
              {s.need.map((n) => (
                <li key={n.assetId}>
                  <Link href={fundHref(n.assetId)}>{n.name}</Link>
                  <span>{n.why}</span>
                </li>
              ))}
            </ul>
          )}
          {s.fix && <p className="dc-fix small">{s.fix}</p>}
        </details>
      )}
    </div>
  );
}

const inr = (n: number) => formatInr(Math.round(n));
const u = (n: number | null) => (n === null ? '–' : unitsText(n));

/**
 * "Does this add up?" on a fund's page: the first and last line, how many, the units and the money three ways (by the lines, on the
 * latest statement line and as the fund records them), the dates where lines are missing, and what to do. Never hides a mismatch: it
 * is open whenever something does not add up.
 */
export function AddsUp({
  verdict,
  value,
  nav,
  navDate,
  sourceNote,
}: {
  verdict: LedgerVerdict;
  /** the value shown for the fund and the price it rests on */
  value: number;
  nav: number | null;
  navDate: string | null;
  sourceNote: string;
}) {
  const v = verdict;
  const ok = v.status === 'complete';
  const at = (units: number | null) => (units !== null && nav !== null ? inr(units * nav) : '–');
  return (
    <details className={`addsup card wide ${ok ? 'ok' : 'warn'}`} open={!ok} data-testid="adds-up">
      <summary>
        <h2 id="adds-up-h">Does this add up?</h2>
        <span className={`ledgerchip ${v.chip.tone}`}>
          <span aria-hidden="true">{v.chip.icon}</span> {v.chip.label}
        </span>
      </summary>
      {v.status === 'no_transactions' ? (
        <p className="small">No transaction is on file for this fund, so nothing can be checked.</p>
      ) : (
        <>
          <dl className="au-facts">
            <div>
              <dt>First transaction</dt>
              <dd>{v.firstTxnOn ? niceDate(v.firstTxnOn) : '–'}</dd>
            </div>
            <div>
              <dt>Last transaction</dt>
              <dd>{v.lastTxnOn ? niceDate(v.lastTxnOn) : '–'}</dd>
            </div>
            <div>
              <dt>Lines on file</dt>
              <dd>
                {v.txnCount}
                {v.sources.length > 0 && <span className="muted"> · {v.sources.join(', ')}</span>}
              </dd>
            </div>
            <div>
              <dt>Held before the first line</dt>
              <dd>
                {v.openingUnits === null ? 'not known' : `${unitsText(v.openingUnits)} units`}
              </dd>
            </div>
          </dl>
          <div className="cmpwrap">
            <table className="tbl lines cmp au-table">
              <thead>
                <tr>
                  <th />
                  <th className="num">By the lines</th>
                  <th className="num">Last line on the statement</th>
                  <th className="num">Recorded on the fund</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>Units held</td>
                  <td className="num" data-label="By the lines">
                    {u(v.unitsBySum)}
                    {v.openingUnits === null && <span className="fl-s">opening not known</span>}
                  </td>
                  <td className="num" data-label="Last line on the statement">
                    {u(v.statementUnits)}
                    {v.statementOn && <span className="fl-s">{niceDate(v.statementOn)}</span>}
                  </td>
                  <td className="num" data-label="Recorded on the fund">
                    {u(v.positionUnits)}
                    {v.positionUnitsAsOf && (
                      <span className="fl-s">counted {niceDate(v.positionUnitsAsOf)}</span>
                    )}
                  </td>
                </tr>
                <tr>
                  <td>
                    Value at the latest price
                    {nav !== null && navDate && (
                      <span className="fl-s">
                        ₹{nav.toLocaleString('en-IN', { maximumFractionDigits: 4 })} on{' '}
                        {niceDate(navDate)}
                      </span>
                    )}
                  </td>
                  <td className="num" data-label="By the lines">
                    {at(v.unitsBySum)}
                  </td>
                  <td className="num" data-label="Last line on the statement">
                    {at(v.statementUnits)}
                  </td>
                  <td className="num" data-label="Recorded on the fund">
                    {at(v.positionUnits)}
                    <span className="fl-s">shown: {inr(value)}</span>
                  </td>
                </tr>
                <tr>
                  <td>Cost of the units held</td>
                  <td className="num" data-label="By the lines">
                    {v.investedByLedger === null ? '–' : inr(v.investedByLedger)}
                    <span className="fl-s">
                      put in {inr(v.boughtAmount)}, taken out {inr(v.soldAmount)}
                    </span>
                  </td>
                  <td className="num" data-label="Last line on the statement">
                    –
                  </td>
                  <td className="num" data-label="Recorded on the fund">
                    {v.positionInvested === null ? '–' : inr(v.positionInvested)}
                    {v.investedDifference !== null && (
                      <span className="fl-s fail">
                        differs by {inr(Math.abs(v.investedDifference))}
                      </span>
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {v.breaks.length > 0 && (
            <div className="au-breaks">
              <h3>Where the lines do not follow each other</h3>
              <ul>
                {v.breaks.map((b, i) => (
                  <li key={i}>
                    {b.from === b.to
                      ? `On ${niceDate(b.to)}`
                      : `Between ${niceDate(b.from)} and ${niceDate(b.to)}`}
                    {b.folio ? ` (folio …${b.folio.slice(-4)})` : ''}:{' '}
                    {b.unexplained > 0
                      ? `${unitsText(b.unexplained)} units appear that no line explains`
                      : `${unitsText(-b.unexplained)} units disappear that no line explains`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {v.duplicates.length > 0 && (
            <div className="au-breaks">
              <h3>Lines that may be on file twice</h3>
              <ul>
                {v.duplicates.map((d, i) => (
                  <li key={i}>
                    {niceDate(d.date)}: {unitsText(Math.abs(d.units))} units, {inr(d.amount)} (
                    {d.sources.join(' and ')})
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <ul className="au-notes small">
        {v.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
        <li className="muted">{sourceNote}</li>
      </ul>
      {v.fix && <p className="au-fix small">{v.fix}</p>}
    </details>
  );
}
