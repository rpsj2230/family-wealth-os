import { redirect } from 'next/navigation';
import { positionInputFrom, reconcileQueue } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { loadHistoryReview } from '@/lib/history-data';
import { holdingLabels } from '@/lib/holding-label';
import { loadAccess, loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { confirmProceeds, explainBalance, recordFunding } from './actions';
import { History } from './History';
import { Recent } from './Recent';
import './reconcile.css';

export const dynamic = 'force-dynamic';

/**
 * Explain movements: the few answers that make own money and profit exact. Each item comes with the likeliest answer chosen and the
 * reason; nothing is assigned until a person saves it, and saving the same answer twice changes nothing.
 */
export default async function Reconcile({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string; tab?: string }>;
}) {
  const { msg, tab: tabParam } = await searchParams;
  const tab = tabParam === 'history' ? 'history' : 'recent';
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase } = await loadContext();
  const loaded = await loadPortfolio(supabase);
  const { config } = await loadSettings(supabase as unknown as SupabaseClient);
  const today = loaded.today.toISOString().slice(0, 10);
  const position = positionInputFrom({
    assets: loaded.assetRows,
    observations: [...loaded.obsRows, ...loaded.sheetObs],
    fds: loaded.fdRows,
    config,
    today,
    ...(loaded.engine.extras.moves ? { moves: loaded.engine.extras.moves } : {}),
    ...(loaded.engine.extras.rates ? { rates: loaded.engine.extras.rates } : {}),
    ...(loaded.engine.extras.placements ? { placements: loaded.engine.extras.placements } : {}),
  });
  const recentDays = Math.max(config.deposits.hideMaturedAfterDays, 120);
  const q = reconcileQueue({
    position,
    moves: loaded.engine.moves,
    tolerance: config.estimates.unexplainedTolerance,
    sinceDays: recentDays,
    pairDays: config.estimates.transferPairDays,
  });
  const owner = (id: string) => loaded.ownerName.get(id) ?? '';
  const accounts = loaded.assetRows.filter(
    (a) => a.type === 'bank_account' && a.status !== 'gifted',
  );
  const deposits = loaded.assetRows.filter(
    (a) => a.type === 'fixed_deposit' && a.status !== 'gifted',
  );
  const history =
    tab === 'history'
      ? await loadHistoryReview(supabase as unknown as SupabaseClient, loaded, config, recentDays)
      : null;
  // what tells holdings apart in a list: bank, name, last digits, a deposit's amount and maturity, and whose it is
  const banks = await supabase.from('institutions').select('id, name');
  const bankName = new Map(
    ((banks.data ?? []) as { id: string; name: string }[]).map((b) => [b.id, b.name]),
  );
  const fdOf = new Map(loaded.fdRows.map((f) => [f.asset_id, f]));
  const labels = holdingLabels(
    loaded.assetRows.map((a) => {
      const f = fdOf.get(a.id);
      return {
        id: a.id,
        nickname: a.label || a.nickname,
        owner: owner(a.owner_id),
        bank: a.institution_id ? (bankName.get(a.institution_id) ?? null) : null,
        last4: a.identifier_last4 ?? null,
        fd: f ? { principal: Number(f.principal), maturityOn: f.maturity_on } : null,
      };
    }),
  );
  const holdings = loaded.assetRows
    .filter((a) => a.status !== 'gifted')
    .map((a) => ({ id: a.id, label: labels[a.id]! }))
    .sort((x, y) => x.label.localeCompare(y.label));

  return (
    <>
      <PageHead
        title="Explain movements"
        subtitle="Where matured money went, what a balance change was, and where a new deposit's money came from. Your answers make own money and profit exact; until then the amounts are kept apart and never counted as profit."
        pills={[
          q.count === 0
            ? { label: 'Nothing to explain', tone: 'ok' }
            : { label: `${q.count} to explain`, tone: 'warn' },
        ]}
      />
      {msg && (
        <p className="notice ok" role="status">
          {msg}
        </p>
      )}
      <Tabs
        base="/reconcile"
        current={tab}
        tabs={[
          { key: 'recent', label: 'Recent', badge: q.count || null },
          { key: 'history', label: 'Earlier months' },
        ]}
      />
      {history ? (
        <History
          review={history.review}
          answers={history.answers}
          holdings={holdings}
          opening={history.opening}
          minimum={config.capital.reviewMinimum}
        />
      ) : (
        <Recent
          q={q}
          accounts={accounts}
          deposits={deposits}
          ownerName={Object.fromEntries(loaded.ownerName)}
          labels={labels}
          today={today}
          tolerance={config.estimates.unexplainedTolerance}
          act={{ confirmProceeds, explainBalance, recordFunding }}
        />
      )}
    </>
  );
}
