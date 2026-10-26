import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  RULES,
  planLossHarvest,
  personStyles,
  type HarvestPosition,
} from '@fwos/core';
import { planHarvest } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { Checklist, HarvestCard, LossCard } from '@/app/(app)/tax/Parts';

export const metadata: Metadata = {
  title: 'Sample tax harvest',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const TODAY = '2026-11-20';
const sip = (from: string, n: number, units: number, cost: number) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { acquiredOn: d.toISOString().slice(0, 10), units, cost };
  });

/** Public preview of the tax harvest page with invented funds: no private data is read. */
export default function DemoTaxHarvest() {
  const positions: HarvestPosition[] = [
    {
      assetId: 'a',
      ownerId: 'p1',
      fund: 'Sample Small Cap Fund (SIP)',
      value: 0,
      invested: 0,
      startedOn: '2025-02-10',
      sipActive: true,
      nav: 120,
      taxClass: 'equity',
      lots: sip('2025-02-10', 16, 100, 8000),
    },
    {
      assetId: 'b',
      ownerId: 'p1',
      fund: 'Sample Bluechip Fund',
      value: 0,
      invested: 0,
      startedOn: '2021-03-01',
      sipActive: false,
      nav: 90,
      taxClass: 'equity',
      lots: [{ acquiredOn: '2021-03-01', units: 1500, cost: 90_000 }],
    },
    {
      assetId: 'c',
      ownerId: 'p1',
      fund: 'Sample US Index Fund of Funds',
      value: 150_000,
      invested: 100_000,
      startedOn: '2022-01-01',
      sipActive: false,
      taxClass: 'other_long',
    },
    {
      assetId: 'd',
      ownerId: 'p1',
      fund: 'Sample Mid Cap Fund (recent buys)',
      value: 0,
      invested: 0,
      startedOn: '2026-01-10',
      sipActive: true,
      nav: 70,
      taxClass: 'equity',
      lots: sip('2026-01-10', 10, 100, 8500),
    },
  ].map((p) => {
    const units = p.lots ? p.lots.reduce((a, l) => a + l.units, 0) : 0;
    return p.lots
      ? {
          ...p,
          value: units * (p.nav as number),
          invested: p.lots.reduce((a, l) => a + (l.cost ?? 0), 0),
        }
      : p;
  }) as HarvestPosition[];
  const plan = planHarvest(positions, TODAY, { rules: RULES, config: DEFAULT_CONFIG.harvest });
  const losses = planLossHarvest(positions, TODAY, {
    ytd: { p1: { stcg: 12_000, ltcg: 0 } },
    plannedGain: { p1: plan.plans[0]?.totalGain ?? 0 },
    rules: RULES,
    config: DEFAULT_CONFIG.harvest,
  });
  const styles = personStyles([{ id: 'p1', name: 'Person A' }]);
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            Sample screen with invented funds. <Link href="/login">Sign in</Link> to see your own.
          </p>
          <PageHead
            title="Tax"
            subtitle="Worked out from your funds, nothing to type. Each person can book ₹1,25,000 of long-term equity-fund gain a year with no tax; what is not used by 31 March is lost."
            pills={[
              { label: `FY ${plan.fy}`, tone: 'info' },
              { label: '131 days to 31 Mar 2027', tone: 'ok' },
            ]}
          />
          <Tabs
            base="/demo/tax-harvest"
            current="harvest"
            tabs={[
              { key: 'harvest', label: 'Gain harvest' },
              {
                key: 'losses',
                label: 'Loss harvest',
                badge: losses.plans[0]?.candidates.length ?? 0,
              },
              { key: 'refunds', label: 'Refunds' },
              { key: 'more', label: 'How it works' },
            ]}
          />
          {plan.plans.map((pp) => (
            <HarvestCard key={pp.ownerId} pp={pp} person={styles.p1} today={TODAY} />
          ))}
          {losses.plans.map((pl) => (
            <LossCard key={pl.ownerId} pl={pl} person={styles.p1} />
          ))}
          <Checklist plan={plan} today={TODAY} />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
