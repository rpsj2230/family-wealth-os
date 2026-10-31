import { redirect } from 'next/navigation';
import { DemoMovementsView } from './view';

export { metadata } from './view';

/** Sample: Explain movements, only what needs you; the statements and interest tabs moved to Transactions. */
export default async function DemoReconcile({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  if (sp.tab === 'statements' || sp.tab === 'interest' || sp.tab === 'lines' || sp.tab === 'feed')
    redirect(`/demo/transactions?tab=${sp.tab === 'interest' ? 'interest' : 'statements'}`);
  return <DemoMovementsView section="actions" searchParams={Promise.resolve(sp)} />;
}
