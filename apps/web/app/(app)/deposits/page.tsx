import Link from 'next/link';
import { personStyles } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { loadContext } from '@/lib/data';
import { buildDeposits, type DepositAsset } from '@/lib/deposits';
import { groupByMonth, summariseDeposits } from '@/lib/deposits-summary';
import { loadPortfolio } from '@/lib/portfolio-data';
import { CoverTab, DepositKpis, MaturitiesTab, RegisterTab, liveLinks } from './Parts';

export const dynamic = 'force-dynamic';

const TABS = ['deposits', 'maturities', 'cover'] as const;

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; p?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'deposits';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, fdRows, portfolio, ownerName }, assets, banks, settings] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('assets')
      .select(
        'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
      ),
    supabase.from('institutions').select('id, name'),
    loadSettings(supabase as unknown as SupabaseClient),
  ]);
  const depositAssets: DepositAsset[] = (assets.data ?? []).map((a) => ({
    id: a.id as string,
    ownerId: a.owner_id as string,
    institutionId: (a.institution_id as string | null) ?? null,
    type: a.type as string,
    status: a.status as string,
    nickname: a.nickname as string,
    accountKind: (a.account_kind as string | null) ?? null,
    isJoint: !!a.is_joint,
    jointHolderId: (a.joint_holder_id as string | null) ?? null,
  }));
  const bankName = new Map((banks.data ?? []).map((b) => [b.id as string, b.name as string]));
  const v = buildDeposits(
    depositAssets,
    portfolio.valued,
    fdRows,
    bankName,
    ownerName,
    today,
    settings.config.deposits.insuranceLimit,
  );
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = sp.p && styles[sp.p] ? sp.p : null;
  const windowDays = Math.max(...settings.config.deposits.maturityAlertDays);
  // the person filter narrows the lists and the figures; insurance cover is always the whole household
  const shown = tab === 'cover' || !who ? v.fds : v.fds.filter((f) => f.ownerId === who);
  const s = summariseDeposits(shown, windowDays);
  const overBanks = Object.values(v.cover.byBank).filter((b) => b.uninsured > 0).length;

  return (
    <>
      <PageHead
        title="Deposits"
        subtitle="Every fixed deposit, when it matures and what comes back, and how much of your money the deposit insurance covers."
        pills={[
          s.confirm.length > 0
            ? { label: `${s.confirm.length} to confirm`, tone: 'warn' }
            : { label: 'Nothing to confirm', tone: 'ok' },
          ...(v.cover.uninsured > 0
            ? [{ label: 'money above the insured limit', tone: 'warn' as const }]
            : []),
        ]}
        actions={
          <>
            <Link className="btn primary" href="/monthly">
              Update deposits
            </Link>
            <Link className="btn" href="/accounts">
              Accounts
            </Link>
          </>
        }
      />
      <DepositKpis s={s} v={v} windowDays={windowDays} />
      <Tabs
        base="/deposits"
        current={tab}
        keep={who ? { p: who } : {}}
        tabs={[
          { key: 'deposits', label: 'Deposits', badge: s.runningCount },
          { key: 'maturities', label: 'Maturities', badge: s.confirm.length },
          { key: 'cover', label: 'Insurance cover', badge: overBanks },
        ]}
      />
      {tab !== 'cover' && (
        <PersonFilter
          people={Object.values(styles)}
          basePath="/deposits"
          current={who}
          keep={{ tab }}
        />
      )}
      <ListingTools name={`deposits-${tab}`}>
        {tab === 'deposits' && <RegisterTab fds={shown} styles={styles} links={liveLinks} />}
        {tab === 'maturities' && (
          <MaturitiesTab
            s={s}
            months={groupByMonth(shown)}
            windowDays={windowDays}
            links={liveLinks}
            styles={styles}
          />
        )}
        {tab === 'cover' && <CoverTab v={v} links={liveLinks} />}
      </ListingTools>
    </>
  );
}
