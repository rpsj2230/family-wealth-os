import type { Metadata } from 'next';
import Link from 'next/link';
import { moneyTrail, parseHomeRange, type TrailLine } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { demoModel } from '@/lib/demo-fixture';
import { demoHomeInput } from '@/lib/demo-home';
import { holdingLabels } from '@/lib/holding-label';
import { TrailView } from '@/app/(app)/trail/TrailView';

export const metadata: Metadata = {
  title: 'Sample: money trail',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of the money trail on the invented sample household. */
export default async function DemoTrail({
  searchParams,
}: {
  searchParams: Promise<{ h?: string }>;
}) {
  const { h } = await searchParams;
  const input = demoHomeInput(parseHomeRange('1y'));
  const position = input.position!;
  const today = position.config.today;
  const names = Object.fromEntries(Object.entries(input.styles).map(([id, s]) => [id, s.name]));
  const people = Object.keys(names);
  const accounts = position.assets.filter((a) => a.type === 'bank_account' && a.currency === 'INR');
  // two accounts of different people and a deposit of the second, with invented lines through them
  const a = accounts.find((x) => x.ownerId === people[0]) ?? accounts[0]!;
  const b = accounts.find((x) => x.ownerId !== a.ownerId) ?? accounts[1] ?? a;
  const dep =
    position.assets.find((x) => x.type === 'fixed_deposit' && x.ownerId === b.ownerId) ??
    position.assets.find((x) => x.type === 'fixed_deposit')!;
  const y = Number(today.slice(0, 4)) - 1;
  const d = (m: number, day: number) =>
    `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  let n = 0;
  const ln = (
    assetId: string,
    date: string,
    amount: number,
    cls: TrailLine['cls'],
    counterpart: string | null,
    narration: string,
  ): TrailLine => ({ id: `s${++n}`, assetId, date, amount, cls, counterpart, narration });
  const lines: TrailLine[] = [
    ln(
      a.assetId,
      d(4, 2),
      1_000_000,
      'own_transfer',
      'singapore',
      'Transfer from Singapore (Wise)',
    ),
    ln(a.assetId, d(4, 5), -600_000, 'own_transfer', b.assetId, 'Transfer to the second account'),
    ln(b.assetId, d(4, 5), 600_000, 'own_transfer', a.assetId, 'Transfer from the first account'),
    ln(b.assetId, d(4, 8), -500_000, 'fd_funding', dep.assetId, 'Deposit booked'),
    ln(a.assetId, d(6, 30), 4_000, 'interest', null, 'Interest'),
  ];
  const trails = moneyTrail({
    lines,
    assets: [
      { id: a.assetId, ownerId: a.ownerId, kind: 'account' },
      { id: b.assetId, ownerId: b.ownerId, kind: 'account' },
      { id: dep.assetId, ownerId: dep.ownerId, kind: 'deposit' },
    ],
    openings: new Map([[b.assetId, 50_000]]),
  });
  const bankNames: Record<string, string> = demoModel().institutionNames;
  const labels = holdingLabels(
    position.assets.map((x) => ({
      id: x.assetId,
      nickname: x.name,
      owner: names[x.ownerId] ?? '',
      bank: x.institutionId ? (bankNames[x.institutionId] ?? null) : null,
      last4: x.last4 ?? null,
      fd: x.fd ? { principal: x.fd.principal, maturityOn: x.fd.maturityOn } : null,
    })),
  );
  const data = {
    trails,
    holdings: [
      { id: a.assetId, ownerId: a.ownerId, kind: 'account' as const, statements: true },
      { id: b.assetId, ownerId: b.ownerId, kind: 'account' as const, statements: true },
      { id: dep.assetId, ownerId: dep.ownerId, kind: 'deposit' as const, statements: false },
    ],
    remittances: { count: 1, amount: 1_000_000, proven: 1, placed: 1 },
    ownershipFrom: d(4, 1),
  };
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            Sample with invented figures. <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Money trail"
            subtitle="Where the money in each account and deposit came from, back to Singapore, and whose money it was."
          />
          <TrailView
            data={data}
            selected={h && trails.has(h) ? h : dep.assetId}
            labels={labels}
            names={names}
            base="/demo/trail"
            sample
          />
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
