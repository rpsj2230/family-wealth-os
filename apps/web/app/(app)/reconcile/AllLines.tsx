import { TransactionsTable, type TxnRow } from '@/components/TransactionsTable';

/**
 * Explain movements > All transactions: every bank statement line of every account, with what it counts as and its tag, to search,
 * filter by tag, account or period, and export. Opened from "Where the money went, by tag" with that tag chosen. A line opens its
 * own page, where its tag can be changed if it is wrong.
 */
export function AllLines({ rows, tag }: { rows: TxnRow[]; tag: string }) {
  return (
    <section className="card" aria-labelledby="al-h" data-testid="all-lines">
      <h2 id="al-h">All transactions</h2>
      <p className="muted small">
        Every line of every account, tagged by itself. Choose a tag to see all its lines; open a
        line to see why it was tagged so, and change the tag there if it is wrong.
      </p>
      <TransactionsTable
        rows={rows}
        hrefTemplate="/asset/{asset}/line/{id}"
        fileName="all-transactions"
        initialTag={tag}
      />
    </section>
  );
}
