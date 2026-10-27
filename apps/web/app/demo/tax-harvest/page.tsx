import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  RULES,
  harvestView,
  personStyles,
  planHarvest,
  planLossHarvest,
  type HarvestPosition,
} from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { Checklist, CostsNote, niceDate, PersonHarvest } from '@/app/(app)/tax/Parts';
import { taxExplain } from '@/lib/explain-tax';

export const metadata: Metadata = {
  title: 'Sample tax harvest',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const TODAY = '2026-11-20';
const sip = (from: string, n: number, units: number, cost: number, estimated = false) =>
  Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return {
      acquiredOn: d.toISOString().slice(0, 10),
      units,
      cost,
      ...(estimated ? { estimated } : {}),
    };
  });

type Raw = Omit<HarvestPosition, 'value' | 'invested'>;

/** Invented funds for two invented people; the value is units times price so every figure agrees. */
function sample(): HarvestPosition[] {
  const raw: Raw[] = [
    {
      assetId: 'a',
      ownerId: 'p1',
      fund: 'Sample Small Cap Fund (SIP)',
      startedOn: '2025-02-10',
      sipActive: true,
      nav: 120,
      taxClass: 'equity',
      exitLoad: { pct: 0.01, days: 90 },
      lots: sip('2025-02-10', 16, 100, 8000),
    },
    {
      assetId: 'b',
      ownerId: 'p1',
      fund: 'Sample Bluechip Fund',
      startedOn: '2021-03-01',
      sipActive: false,
      nav: 90,
      taxClass: 'equity',
      lots: [{ acquiredOn: '2021-03-01', units: 1500, cost: 90_000 }],
    },
    {
      assetId: 'd',
      ownerId: 'p1',
      fund: 'Sample Mid Cap Fund (recent buys)',
      startedOn: '2026-01-10',
      sipActive: true,
      nav: 70,
      taxClass: 'equity',
      lots: sip('2026-01-10', 10, 100, 8500),
    },
    {
      assetId: 'e',
      ownerId: 'p1',
      fund: 'Sample Value Fund',
      startedOn: '2024-01-15',
      sipActive: false,
      nav: 60,
      taxClass: 'equity',
      lots: [
        { acquiredOn: '2024-01-15', units: 600, cost: 48_000 },
        { acquiredOn: '2024-09-15', units: 400, cost: 36_000 },
      ],
    },
    {
      assetId: 'c',
      ownerId: 'p1',
      fund: 'Sample US Index Fund of Funds',
      startedOn: '2022-01-01',
      sipActive: false,
      taxClass: 'other_long',
    },
    {
      assetId: 'f',
      ownerId: 'p2',
      fund: 'Sample Index Fund',
      startedOn: '2022-04-05',
      sipActive: true,
      nav: 250,
      taxClass: 'equity',
      lots: sip('2022-04-05', 40, 20, 3000, true),
    },
    {
      assetId: 'g',
      ownerId: 'p2',
      fund: 'Sample Flexi Cap Fund',
      startedOn: '2023-06-12',
      sipActive: false,
      nav: 55,
      taxClass: 'equity',
      lots: [
        { acquiredOn: '2023-06-12', units: 900, cost: 36_000 },
        { acquiredOn: '2025-12-20', units: 300, cost: 15_000 },
      ],
    },
  ];
  return raw.map((p) => {
    if (!p.lots) return { ...p, value: 150_000, invested: 100_000 };
    const units = p.lots.reduce((a, l) => a + l.units, 0);
    return {
      ...p,
      value: units * (p.nav as number),
      invested: p.lots.reduce((a, l) => a + (l.cost ?? 0), 0),
    };
  });
}

/** Public preview of the tax harvest page with invented funds: no private data is read. */
export default function DemoTaxHarvest() {
  const positions = sample();
  const plan = planHarvest(positions, TODAY, {
    rules: RULES,
    config: DEFAULT_CONFIG.harvest,
    ytdRealised: { p1: 20_000 },
  });
  const losses = planLossHarvest(positions, TODAY, {
    ytd: { p1: { stcg: 12_000, ltcg: 20_000 }, p2: { stcg: 0, ltcg: 0 } },
    plannedGain: Object.fromEntries(plan.plans.map((p) => [p.ownerId, p.totalGain])),
    rules: RULES,
    config: DEFAULT_CONFIG.harvest,
  });
  const names = { p1: 'Person A', p2: 'Person B' };
  const view = harvestView({
    plan,
    losses,
    today: TODAY,
    names,
    rules: RULES,
    config: DEFAULT_CONFIG.harvest,
  });
  const styles = personStyles(Object.entries(names).map(([id, name]) => ({ id, name })));
  const ex = taxExplain({
    view,
    plan,
    today: TODAY,
    refunds: [],
    incomeLimit: DEFAULT_CONFIG.refunds.incomeLimit,
    sample: true,
  });
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
            subtitle="Which funds to sell this year to use each person’s free tax allowance. Worked out from your funds and your old purchases; nothing to type."
            pills={[
              { label: `FY ${plan.fy}`, tone: 'info' },
              { label: `${view.daysLeft} days to ${niceDate(plan.deadline)}`, tone: 'ok' },
            ]}
          />
          <Tabs
            base="/demo/tax-harvest"
            current="harvest"
            tabs={[
              {
                key: 'harvest',
                label: 'What to sell',
                badge: view.people.reduce((a, p) => a + p.sell.length, 0),
              },
              { key: 'refunds', label: 'Refunds' },
              { key: 'more', label: 'How it works' },
            ]}
          />
          {view.people.map((pv) => (
            <PersonHarvest key={pv.ownerId} pv={pv} person={styles[pv.ownerId]} ex={ex} />
          ))}
          <Checklist view={view} />
          <CostsNote view={view} why={ex['tax.costs']} />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
