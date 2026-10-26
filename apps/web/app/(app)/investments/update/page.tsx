import Link from 'next/link';
import { FundTransactionForm } from '@/components/FundTransactionForm';
import { FundUpdateGrid, type FundInput } from '@/components/FundUpdateGrid';
import { loadContext } from '@/lib/data';
import { loadInvestmentView } from '@/lib/investments';

export const dynamic = 'force-dynamic';

export default async function UpdateFundsPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const view = await loadInvestmentView(supabase);
  const funds: FundInput[] = view.groups.flatMap((g) =>
    g.funds.map((f) => ({
      assetId: f.assetId,
      name: f.name,
      owner: g.name,
      units: f.units,
      nav: f.nav,
      navDate: f.navDate,
      invested: f.invested,
      value: f.value,
      sipMonthly: f.sipMonthly,
      sipStopped: f.sipStopped,
    })),
  );
  return (
    <>
      <div className="pagehead">
        <h1>Update funds</h1>
        <Link className="btn ghost" href="/investments">
          Back to Investments
        </Link>
      </div>
      <p className="muted">
        Once a month: enter the units you hold and the price (NAV) of each fund, from your fund app
        or the monthly statement. The value, the history graphs and the forecast follow from these.
        Prices are also fetched every day for funds you have matched, so most months only the units
        and amount put in change. A fund statement (Import page) fills all of this in on its own.
      </p>
      <section className="card">
        <FundUpdateGrid funds={funds} today={view.today} />
      </section>
      <FundTransactionForm
        today={view.today}
        funds={funds.map((f) => ({ id: f.assetId, name: f.name, owner: f.owner }))}
      />
    </>
  );
}
