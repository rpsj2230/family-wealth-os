import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CONFIG } from '@fwos/core';
import {
  CoverTab,
  DepositKpis,
  MaturitiesTab,
  RegisterTab,
  type DepositLinks,
} from '@/app/(app)/deposits/Parts';
import { DemoShell } from '@/components/DemoShell';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { PersonFilter } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { buildDeposits, type DepositAsset } from '@/lib/deposits';
import { groupByMonth, summariseDeposits } from '@/lib/deposits-summary';
import { DEMO_TODAY, demoModel } from '@/lib/demo-fixture';

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
  sample: true,
};

/** Public preview of the Deposits page with invented banks, people and amounts: no private data is read. */
export default async function DemoDeposits({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; p?: string }>;
}) {
  const sp = await searchParams;
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
  const overBanks = Object.values(v.cover.byBank).filter((b) => b.uninsured > 0).length;
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
      <DepositKpis s={s} v={v} windowDays={windowDays} />
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
        {tab === 'deposits' && <RegisterTab fds={shown} styles={m.styles} links={links} />}
        {tab === 'maturities' && (
          <MaturitiesTab
            s={s}
            months={groupByMonth(shown)}
            windowDays={windowDays}
            links={links}
            styles={m.styles}
          />
        )}
        {tab === 'cover' && <CoverTab v={v} links={links} />}
      </ListingTools>
    </DemoShell>
  );
}
