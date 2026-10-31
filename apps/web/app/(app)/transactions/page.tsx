import { MovementsView } from '../reconcile/view';

export const dynamic = 'force-dynamic';

/** Transactions: every bank line with what it counts as and its tag, the statements, the interest the banks reported, the feed. */
export default function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; tab?: string; tag?: string }>;
}) {
  return <MovementsView section="transactions" searchParams={searchParams} />;
}
