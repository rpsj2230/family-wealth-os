import Link from 'next/link';
import {
  bankOverview,
  buildBankBlocks,
  depositsByBank,
  filterBlocksByOwner,
  fixedDepositBlocks,
  maturityLadder,
  personStyles,
} from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { ParamTabs } from '@/components/ParamTabs';
import { Tabs } from '@/components/Tabs';
import { loadContext } from '@/lib/data';
import { buildDeposits, type DepositAsset } from '@/lib/deposits';
import { groupByMonth, summariseDeposits } from '@/lib/deposits-summary';
import { loadPortfolio } from '@/lib/portfolio-data';
import { saveForeignBanks } from './actions';
import { DepositOverviewPanel } from './Overview';
import { CoverTab, MaturitiesTab, RegisterTab, liveLinks } from './Parts';

export const dynamic = 'force-dynamic';

const TABS = ['deposits', 'maturities', 'cover'] as const;

export default async function DepositsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; p?: string; g?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'deposits';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, assetRows, obsRows, fdRows, portfolio, ownerName }, assets, banks, settings] =
    await Promise.all([
      loadPortfolio(supabase),
      supabase
        .from('assets')
        .select(
          'id, owner_id, institution_id, type, status, nickname, account_kind, is_joint, joint_holder_id',
        ),
      supabase.from('institutions').select('id, name, deposit_insured'),
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
    new Set(
      (banks.data ?? []).filter((b) => b.deposit_insured === false).map((b) => b.id as string),
    ),
  );
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = sp.p && styles[sp.p] ? sp.p : null;
  const group = sp.g === 'bank' || sp.g === 'owner' ? sp.g : 'none';
  const windowDays = Math.max(...settings.config.deposits.maturityAlertDays);
  // the person filter narrows the lists and the figures; insurance cover is always the whole household
  const shown = tab === 'cover' || !who ? v.fds : v.fds.filter((f) => f.ownerId === who);
  const s = summariseDeposits(shown, windowDays);
  const blocks = fixedDepositBlocks(
    buildBankBlocks({
      assets: assetRows,
      observations: obsRows,
      fds: fdRows,
      portfolio,
      institutionNames: Object.fromEntries(bankName),
      today,
    }),
  );
  const scoped = who && tab !== 'cover' ? filterBlocksByOwner(blocks, who) : blocks;
  const overview = bankOverview(scoped, {
    today,
    soonDays: settings.config.reminders.maturitySoonDays,
    defaultSavingsRate: settings.config.estimates.savingsRate,
    tdsRate: settings.config.estimates.interestTdsRate,
  });
  const todayIso = today.toISOString().slice(0, 10);
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
      <DepositOverviewPanel
        o={overview}
        banks={depositsByBank(scoped, todayIso)}
        ladder={maturityLadder(scoped)}
        cover={{ limit: v.cover.limit, uninsured: v.cover.uninsured, banksOver: overBanks }}
        toConfirm={s.confirm.length}
        styles={styles}
        scope={who ? (styles[who]?.name ?? null) : null}
      />
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
        {tab === 'deposits' && (
          <>
            <ParamTabs
              base="/deposits"
              param="g"
              label="Group the deposits"
              current={group}
              keep={{ tab, p: who ?? undefined }}
              tabs={[
                { key: 'none', label: 'One list' },
                { key: 'bank', label: 'By bank' },
                { key: 'owner', label: 'By person' },
              ]}
            />
            <RegisterTab fds={shown} styles={styles} links={liveLinks} group={group} />
          </>
        )}
        {tab === 'maturities' && (
          <MaturitiesTab
            s={s}
            months={groupByMonth(shown)}
            windowDays={windowDays}
            links={liveLinks}
            styles={styles}
          />
        )}
        {tab === 'cover' && (
          <CoverTab
            v={v}
            links={liveLinks}
            banks={(banks.data ?? [])
              .map((b) => ({
                id: b.id as string,
                name: b.name as string,
                outside: b.deposit_insured === false,
              }))
              .sort((a, b) => a.name.localeCompare(b.name))}
            saveForeign={saveForeignBanks}
          />
        )}
      </ListingTools>
    </>
  );
}
