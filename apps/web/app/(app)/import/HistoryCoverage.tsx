import Link from 'next/link';
import {
  coverageSentence,
  monthLabel,
  type Coverage,
  type CoverageState,
  type PersonStyle,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { PersonBadge } from '@/components/Person';
import './history.css';

const STATE_WORD: Record<CoverageState, string> = {
  value: 'has a value',
  terms: 'held (value from its terms)',
  gap: 'missing',
  late: 'not updated',
  none: 'nothing',
};

/** A row's months as a strip of small cells; each cell is also named for screen readers by the sentence under the strip. */
function Strip({ row, months }: { row: Coverage['rows'][number]; months: string[] }) {
  const years: { year: string; count: number }[] = [];
  for (const m of months) {
    const y = m.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last.year === y) last.count++;
    else years.push({ year: y, count: 1 });
  }
  return (
    <div className="cov-strip" aria-hidden="true">
      <div
        className="cov-cells"
        style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
      >
        {row.cells.map((c) => (
          <span
            key={c.month}
            className={`cov-cell ${c.state}`}
            title={`${monthLabel(c.month)}: ${STATE_WORD[c.state]}`}
          />
        ))}
      </div>
      <div
        className="cov-years"
        style={{ gridTemplateColumns: `repeat(${months.length}, minmax(0, 1fr))` }}
      >
        {years.map((y) => (
          <span key={y.year} style={{ gridColumn: `span ${y.count}` }}>
            {y.count >= 3 ? y.year : ''}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Every savings or cash account and every deposit, month by month, in plain words: which months have a value, where the history has
 * holes and how many. Rows with holes come first. Built from the dated values on file, so it grows as history is imported.
 */
export function HistoryCoverage({
  coverage,
  people,
  demo = false,
}: {
  coverage: Coverage;
  /** by person name, so a person keeps one colour everywhere */
  people: Record<string, PersonStyle>;
  demo?: boolean;
}) {
  const { rows, months, totals } = coverage;
  if (rows.length === 0)
    return (
      <section className="card hist-cov" id="history-coverage" aria-labelledby="history-coverage-h">
        <h2 id="history-coverage-h">History coverage</h2>
        <p className="empty">
          No accounts or deposits yet. Import your workbook first, then bring in the older monthly
          tabs.
        </p>
      </section>
    );
  const sorted = [...rows].sort(
    (a, b) =>
      b.gapMonths.length + b.lateMonths.length - (a.gapMonths.length + a.lateMonths.length) ||
      a.kind.localeCompare(b.kind) ||
      a.label.localeCompare(b.label),
  );
  const first = months[0];
  return (
    <section className="card hist-cov" id="history-coverage" aria-labelledby="history-coverage-h">
      <h2 id="history-coverage-h">History coverage</h2>
      <p className="small" data-testid="cov-summary">
        {totals.accounts} accounts and deposits
        {first ? `, from ${monthLabel(first)}` : ''}.{' '}
        {totals.withGaps === 0 && totals.late === 0
          ? 'Every month with a balance is filled in.'
          : `${totals.withGaps} ${totals.withGaps === 1 ? 'has' : 'have'} months missing (${totals.gaps} in all)${totals.late ? `, ${totals.late} not updated lately` : ''}.`}
      </p>
      <p className="small muted hist-legend">
        <span className="cov-leg">
          <span className="cov-key value" /> has a balance
        </span>
        <span className="cov-leg">
          <span className="cov-key terms" /> deposit held (value from its terms)
        </span>
        <span className="cov-leg">
          <span className="cov-key gap" /> missing month
        </span>
        <span className="cov-leg">
          <span className="cov-key late" /> not updated since
        </span>
        <span className="cov-leg">
          <span className="cov-key none" /> before it started or after it closed
        </span>
      </p>
      <ul className="cov-list">
        {sorted.map((r) => (
          <li key={r.id} className="cov-row" data-testid="cov-row">
            <div className="cov-head">
              {r.bank && <BankBadge name={r.bank} size={22} />}
              <strong className="cov-name">{r.label}</strong>
              <PersonBadge p={people[r.owner]} name />
              <span className="statuspill">{r.kind === 'fd' ? 'Deposit' : 'Savings'}</span>
              {r.status !== 'active' && <span className="statuspill">{r.status}</span>}
              {r.gapMonths.length > 0 && (
                <span className="statuspill warn">
                  {r.gapMonths.length} {r.gapMonths.length === 1 ? 'month' : 'months'} missing
                </span>
              )}
            </div>
            <div role="img" aria-label={`${r.label}: ${coverageSentence(r)}`}>
              <Strip row={r} months={months} />
            </div>
            <p className="small muted cov-text">{coverageSentence(r)}</p>
          </li>
        ))}
      </ul>
      {demo && <p className="small muted">Invented figures for this sample.</p>}
      <p className="small">
        Missing months are filled by importing older monthly tabs:{' '}
        <Link href="/import">Import &gt; Excel workbook &gt; History from all monthly tabs</Link>.
      </p>
    </section>
  );
}
