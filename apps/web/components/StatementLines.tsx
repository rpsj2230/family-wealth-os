import Link from 'next/link';
import { formatInr } from '@fwos/core';
import type { AccountLine } from '@fwos/data';
import { niceDate } from '@/lib/dates';
import { TransactionsTable } from './TransactionsTable';

/**
 * Every line of the account's bank statements as a working table (components/TransactionsTable.tsx): search, periods, filters,
 * sort, pages and export. A line opens its own page: what it is, why, and where its money came from (its trail).
 */
export function StatementLines({
  assetId,
  lines,
  hrefTemplate = `/asset/${assetId}/line/{id}`,
  answerHref = '/transactions?tab=statements',
  fileName = 'transactions',
}: {
  assetId: string;
  lines: AccountLine[];
  /** a line's page, with {id} for the line */
  hrefTemplate?: string;
  answerHref?: string;
  fileName?: string;
}) {
  if (lines.length === 0) return null;
  const open = lines.filter((l) => l.toAnswer).length;
  const first = lines.reduce((a, l) => (l.date < a ? l.date : a), lines[0]!.date);
  const last = lines.reduce((a, l) => (l.date > a ? l.date : a), lines[0]!.date);
  return (
    <section className="detailsection" aria-labelledby="sl-h" data-testid="statement-lines">
      <h2 id="sl-h">Transactions</h2>
      <p className="muted small">
        From the bank statements, {niceDate(first)} to {niceDate(last)}:{' '}
        {formatInr(lines.filter((l) => l.amount > 0).reduce((s, l) => s + l.amount, 0))} in,{' '}
        {formatInr(lines.filter((l) => l.amount < 0).reduce((s, l) => s - l.amount, 0))} out.
        {open > 0 && (
          <>
            {' '}
            {open} still to answer in <Link href={answerHref}>Explain movements</Link>.
          </>
        )}{' '}
        Open a line to see what it was and where its money came from.
      </p>
      <TransactionsTable rows={lines} hrefTemplate={hrefTemplate} fileName={fileName} />
    </section>
  );
}
