import { fmtUnits, formatInr, longDate, sourceLabel } from '@fwos/core';

/** A line a fund statement replaced: kept out of every figure, listed here so nothing is lost. */
export interface ReplacedRow {
  id: string;
  date: string;
  kind: string;
  amount: number;
  units: number;
  source: string;
  /** the date of the statement that replaced it, and the day it was set aside */
  statementOn: string | null;
  replacedOn: string | null;
}

const KIND_WORD: Record<string, string> = {
  purchase: 'Purchase',
  sip: 'SIP instalment',
  switch_in: 'Switch in',
  dividend_reinvest: 'Dividend reinvested',
  bonus: 'Bonus units',
  redeem: 'Sale',
  switch_out: 'Switch out',
  other: 'Other',
};

/**
 * "Replaced by the statement": the lines a detailed fund statement replaced (they came from an app export, the workbook, an estimate
 * or were typed by hand). Collapsed: they are not counted in any figure on the page, and nothing is deleted, so they can be reviewed.
 */
export function ReplacedLines({ rows }: { rows: ReplacedRow[] }) {
  if (rows.length === 0) return null;
  return (
    <details className="disclose replaced-lines">
      <summary>
        Replaced by the statement ({rows.length} line{rows.length === 1 ? '' : 's'})
      </summary>
      <p className="muted small">
        The fund statement is the most accurate record. These lines differed from it, so they are
        left out of every figure here. They are kept, not deleted.
      </p>
      <div className="replaced-scroll">
        <table className="tbl lines responsive">
          <thead>
            <tr>
              <th>Date</th>
              <th>What</th>
              <th>Came from</th>
              <th className="num">Amount</th>
              <th className="num">Units</th>
              <th>Replaced by</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td data-label="Date">{longDate(r.date)}</td>
                <td data-label="What">{KIND_WORD[r.kind] ?? r.kind}</td>
                <td data-label="Came from">{sourceLabel(r.source)}</td>
                <td data-label="Amount" className="num">
                  {formatInr(Math.abs(r.amount))}
                </td>
                <td data-label="Units" className="num">
                  {fmtUnits(Math.abs(r.units))}
                </td>
                <td data-label="Replaced by">
                  {r.statementOn
                    ? `statement dated ${longDate(r.statementOn)}`
                    : 'a fund statement'}
                  {r.replacedOn ? ` (set aside ${longDate(r.replacedOn.slice(0, 10))})` : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
