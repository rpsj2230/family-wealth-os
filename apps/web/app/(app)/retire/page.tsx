import { holdingsFromAssets, settingsFromJson, withPeople } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { RetireClient } from '@/components/RetireClient';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { savePlanSettings } from './actions';

const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export const dynamic = 'force-dynamic';

export default async function RetirePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, portfolio }, settingsRow, sips, peopleRows] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('plan_settings').select('settings').maybeSingle(),
    supabase.from('mf_positions').select('sip_monthly, sip_stopped'),
    supabase.from('owners').select('dob, plan_role'),
  ]);
  const holdings = holdingsFromAssets(portfolio.valued);
  const sipMonthly = (sips.data ?? [])
    .filter((x) => !x.sip_stopped)
    .reduce((s, x) => s + Number(x.sip_monthly ?? 0), 0);
  const total = holdings.cash + holdings.equity + holdings.locked;
  const soft = portfolio.netWorth.estimateTotals.byBasis;
  const softShare =
    total > 0
      ? (soft.carried_forward + soft.estimated) /
        Math.max(1, soft.calculated + soft.carried_forward + soft.estimated)
      : 1;
  return (
    <>
      <PageHead
        title="Can I retire now?"
        subtitle="An honest answer from your own holdings, SIPs and spending, not a promise. Change an assumption below and watch the answer move."
        pills={[
          { label: `values as of ${niceDate(today.toISOString().slice(0, 10))}`, tone: 'info' },
        ]}
      />
      <RetireClient
        tab={tab}
        base="/retire"
        initial={withPeople(settingsFromJson(settingsRow.data?.settings), peopleRows.data ?? [])}
        holdings={holdings}
        sipMonthly={sipMonthly}
        asOf={today.toISOString().slice(0, 10)}
        softShare={softShare}
        save={savePlanSettings}
      />
    </>
  );
}
