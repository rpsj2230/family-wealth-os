import type { Metadata } from 'next';
import Link from 'next/link';
import {
  bankOverview,
  DEFAULT_CONFIG,
  depositsByBank,
  filterBlocksByOwner,
  fixedDepositBlocks,
  maturityLadder,
} from '@fwos/core';
import { DepositOverviewPanel } from '@/app/(app)/deposits/Overview';
import {
  CoverTab,
  MaturitiesTab,
  RegisterTab,
  type DepositLinks,
} from '@/app/(app)/deposits/Parts';
import { DemoShell } from '@/components/DemoShell';
import { HiddenDepositsNote } from '@/components/HiddenDepositsNote';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { buildDeposits, type DepositAsset } from '@/lib/deposits';
import { groupByMonth, summariseDeposits } from '@/lib/deposits-summary';
import { DEMO_TODAY, demoModel } from '@/lib/demo-fixture';
import { bankBase, depositsExplain } from '@/lib/explain-money';
import { maturedHref, showsMatured } from '@/lib/matured-list';

export const metadata: Metadata = {
  title: 'Sample deposits',
  robots: { index: false, follow: false },
};

const TABS = ['deposits', 'maturities', 'cover'] as const;

const links: DepositLinks = {
  bank: () => null,
  asset: () => '/demo/asset',
  monthly: () => '/demo/monthly',
  edit: '/demo/accounts/edit',
  editOne: () => '/demo/accounts',
  sample: true,
};

/** Public preview of the Deposits page with invented banks, people and amounts: no private data is read. */
export default async function DemoDeposits({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; p?: string; matured?: string }>;
}) {
  const sp = await searchParams;
  const showAll = showsMatured(sp.matured);
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'deposits';
  const m = demoModel();
  const assets: DepositAsset[] = m.assets.map((a) => ({
    id: a.id,
    ownerId: a.owner_id,
    institutionId: a.institution_id ?? null,
    type: a.type,
    status: a.status,
    nickname: a.nickname,
    accountKind: a.account_kind,
    isJoint: !!a.is_joint,
    jointHolderId: null,
  }));
  const v = buildDeposits(
    assets,
    m.portfolio.valued,
    m.fds,
    new Map(Object.entries(m.institutionNames)),
    new Map(m.people.map((x) => [x.id, x.name])),
    DEMO_TODAY,
    DEFAULT_CONFIG.deposits.insuranceLimit,
  );
  const who = sp.p && m.styles[sp.p] ? sp.p : null;
  const windowDays = Math.max(...DEFAULT_CONFIG.deposits.maturityAlertDays);
  const shown = tab === 'cover' || !who ? v.fds : v.fds.filter((f) => f.ownerId === who);
  const s = summariseDeposits(shown, windowDays);
  const hiddenFds = shown.filter((f) => f.listState === 'hidden');
  const registerFds = showAll ? shown : shown.filter((f) => f.listState !== 'hidden');
  const hiddenCounts = {
    hidden: hiddenFds.length,
    confirmed: hiddenFds.filter((f) => ['matured', 'renewed', 'closed'].includes(f.status)).length,
  };
  const keepQuery = { tab: tab === 'deposits' ? null : tab, p: who };
  const overBanks = Object.values(v.cover.byBank).filter((b) => b.uninsured > 0).length;
  const blocks = fixedDepositBlocks(m.blocks);
  const scoped = who && tab !== 'cover' ? filterBlocksByOwner(blocks, who) : blocks;
  const overview = bankOverview(scoped, {
    today: DEMO_TODAY,
    soonDays: DEFAULT_CONFIG.reminders.maturitySoonDays,
    defaultSavingsRate: DEFAULT_CONFIG.estimates.savingsRate,
    tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
  });
  const todayIso = DEMO_TODAY.toISOString().slice(0, 10);
  const depBanks = depositsByBank(scoped, todayIso);
  const depLadder = maturityLadder(scoped);
  const exD = depositsExplain(
    overview,
    bankBase({
      today: todayIso,
      scope: who ? (m.styles[who]?.name ?? null) : null,
      blocks: scoped,
      savingsRate: DEFAULT_CONFIG.estimates.savingsRate,
      tdsRate: DEFAULT_CONFIG.estimates.interestTdsRate,
    }),
    true,
    {
      cover: { limit: v.cover.limit, uninsured: v.cover.uninsured, banksOver: overBanks },
      toConfirm: s.confirm.length,
      banks: depBanks,
      ladder: depLadder,
    },
  );
  return (
    <DemoShell>
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
            <Link className="btn primary" href="/demo/monthly">
              Update deposits
            </Link>
            <Link className="btn" href="/demo/accounts">
              Accounts
            </Link>
          </>
        }
      />
      <DepositOverviewPanel
        ex={exD}
        o={overview}
        banks={depBanks}
        ladder={depLadder}
        cover={{ limit: v.cover.limit, uninsured: v.cover.uninsured, banksOver: overBanks }}
        toConfirm={s.confirm.length}
        styles={m.styles}
        scope={who ? (m.styles[who]?.name ?? null) : null}
        sample
      />
      <Tabs
        base="/demo/deposits"
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
          people={Object.values(m.styles)}
          basePath="/demo/deposits"
          current={who}
          keep={{ tab }}
        />
      )}
      <ListingTools name={`deposits-${tab}`}>
        {tab === 'deposits' && (
          <>
            <RegisterTab
              fds={registerFds}
              styles={m.styles}
              links={links}
              allHidden={hiddenCounts.hidden > 0}
            />
            <HiddenDepositsNote
              counts={hiddenCounts}
              showAll={showAll}
              showHref={maturedHref('/demo/deposits', keepQuery, true)}
              hideHref={maturedHref('/demo/deposits', keepQuery, false)}
            />
          </>
        )}
        {tab === 'maturities' && (
          <MaturitiesTab
            s={s}
            months={groupByMonth(shown)}
            windowDays={windowDays}
            windows={DEFAULT_CONFIG.deposits.maturityAlertDays}
            today={todayIso}
            links={links}
            styles={m.styles}
          />
        )}
        {tab === 'cover' && <CoverTab v={v} links={links} />}
      </ListingTools>
    </DemoShell>
  );
}
