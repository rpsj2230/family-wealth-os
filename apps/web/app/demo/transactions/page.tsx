import { DemoMovementsView } from '../reconcile/view';

export { metadata } from '../reconcile/view';

/** Sample: Transactions, the statements and the interest the banks reported. */
export default function DemoTransactions({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  return <DemoMovementsView section="transactions" searchParams={searchParams} />;
}
