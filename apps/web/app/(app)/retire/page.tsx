import { holdingsFromAssets, settingsFromJson, withPeople } from '@fwos/core';
import { RetireClient } from '@/components/RetireClient';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { savePlanSettings } from './actions';

export const dynamic = 'force-dynamic';

export default async function RetirePage() {
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
      <h1>Can I retire now?</h1>
      <p className="muted">
        An honest answer from your own numbers and the assumptions below, not a promise. It uses
        your actual holdings, your SIPs, your spending, inflation and how long the plan has to last.
      </p>
      <RetireClient
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
