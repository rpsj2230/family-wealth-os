import { redirect } from 'next/navigation';
import { MovementsView, TRANSACTION_TABS } from './view';

export const dynamic = 'force-dynamic';

/** Explain movements: only what needs you. The tabs that moved to Transactions are sent there, so old links keep working. */
export default async function Reconcile({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; tab?: string; tag?: string }>;
}) {
  const sp = await searchParams;
  if ((TRANSACTION_TABS as readonly string[]).includes(sp.tab ?? '')) {
    const q = new URLSearchParams(
      Object.entries(sp).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
    redirect(`/transactions?${q.toString()}`);
  }
  return <MovementsView section="actions" searchParams={Promise.resolve(sp)} />;
}
