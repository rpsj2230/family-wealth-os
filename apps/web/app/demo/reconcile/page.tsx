import type { Metadata } from 'next';
import Link from 'next/link';
import {
  DEFAULT_CONFIG,
  addDaysIso,
  capitalLedger,
  classifyLines,
  estimatedInterest,
  historyReview,
  interestCheck,
  parseHomeRange,
  reconcileQueue,
  type StmtLine,
} from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { demoModel } from '@/lib/demo-fixture';
import { demoHomeInput } from '@/lib/demo-home';
import { holdingLabels } from '@/lib/holding-label';
import { History } from '@/app/(app)/reconcile/History';
import { Interest } from '@/app/(app)/reconcile/Interest';
import { Statements } from '@/app/(app)/reconcile/Statements';
import { Recent } from '@/app/(app)/reconcile/Recent';
import { sampleFinish } from '../sample-actions';
import '@/app/(app)/reconcile/reconcile.css';

export const metadata: Metadata = {
  title: 'Sample: explain movements',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of Explain movements on the invented sample household: the forms save nothing. */
export default async function DemoReconcile({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab =
    sp.tab === 'history' || sp.tab === 'interest' || sp.tab === 'statements' ? sp.tab : 'recent';
  const input = demoHomeInput(parseHomeRange('1y'));
  const position = input.position!;
  const cfg = DEFAULT_CONFIG;
  const today = position.config.today;
  const recentDays = Math.max(cfg.deposits.hideMaturedAfterDays, 120);
  const q = reconcileQueue({
    position,
    moves: [],
    tolerance: cfg.estimates.unexplainedTolerance,
    sinceDays: recentDays,
    pairDays: cfg.estimates.transferPairDays,
  });
  const ownerName = Object.fromEntries(Object.entries(input.styles).map(([id, s]) => [id, s.name]));
  const rows = position.assets
    .filter((a) => a.status !== 'gifted')
    .map((a) => ({ id: a.assetId, nickname: a.name, owner_id: a.ownerId, type: a.type }));
  const bankNames: Record<string, string> = demoModel().institutionNames;
  const labels = holdingLabels(
    position.assets.map((a) => ({
      id: a.assetId,
      nickname: a.name,
      owner: ownerName[a.ownerId] ?? '',
      bank: a.institutionId ? (bankNames[a.institutionId] ?? null) : null,
      last4: a.last4 ?? null,
      fd: a.fd ? { principal: a.fd.principal, maturityOn: a.fd.maturityOn } : null,
    })),
  );
  const ledger = capitalLedger({ position, moves: [], openingDate: null });
  const review =
    tab === 'history'
      ? historyReview({
          ledger,
          position,
          minimum: cfg.capital.reviewMinimum,
          pairMonths: cfg.capital.reviewPairMonths,
          before: addDaysIso(today, -recentDays),
          limit: 20,
        })
      : null;
  // invented statements for the last finished year: one person's banks paid noticeably more than estimated, the other's matched
  const fyStart = Number(today.slice(0, 4)) - (today.slice(5) >= '04-01' ? 1 : 2);
  const fy = `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`;
  const people = Object.keys(ownerName).slice(0, 2);
  const interest =
    tab === 'interest'
      ? interestCheck({
          position,
          statements: people.map((ownerId, i) => {
            const est = estimatedInterest(position, ownerId, fy, () => true);
            const reported = Math.round(est * (i === 0 ? 1.12 : 1.002));
            return {
              ownerId,
              fy,
              kind: 'ais' as const,
              lines: [
                { source: 'Sample Bank (savings)', amount: Math.round(reported * 0.3) },
                { source: 'Sample Bank (deposits)', amount: reported - Math.round(reported * 0.3) },
              ],
            };
          }),
          taxable: () => true,
          tolerance: {
            rupees: cfg.estimates.unexplainedTolerance,
            share: cfg.estimates.reconcileTolerance,
          },
        })
      : null;
  // invented statement lines on two of the sample's accounts: a remittance, rent, a transfer between them, spending, interest and
  // one large payment the rules cannot place
  const sampleAccounts = rows.filter((r) => r.type === 'bank_account').slice(0, 2);
  const stmt =
    tab === 'statements' && sampleAccounts.length === 2
      ? (() => {
          const [a, b] = sampleAccounts as [(typeof rows)[number], (typeof rows)[number]];
          const y = Number(today.slice(0, 4)) - 1;
          const d = (m: number, day: number) =>
            `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const raw: [string, string, number, string][] = [
            [a.id, d(4, 2), 500_000, 'INWARD REMITTANCE SGD'],
            [a.id, d(4, 5), 30_000, 'NEFT CR-SAMPLE TENANT-RENT'],
            [a.id, d(4, 8), -200_000, 'IMPS TO OWN A/C'],
            [b.id, d(4, 9), 200_000, 'IMPS FROM SAMPLE BANK'],
            [a.id, d(4, 15), -2_400, 'UPI/…4321/GROCER'],
            [a.id, d(4, 20), -85_000, 'NEFT TO SAMPLE BUILDER'],
            [a.id, d(6, 30), 3_900, 'INT.PD:01-04 TO 30-06'],
          ];
          const lines: StmtLine[] = raw.map(([assetId, date, amount, narration], i) => ({
            id: `00000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`,
            assetId,
            ownerId: rows.find((r) => r.id === assetId)!.owner_id,
            date,
            amount,
            narration,
          }));
          const classified = classifyLines(lines, {
            accounts: sampleAccounts.map((r) => ({
              assetId: r.id,
              ownerId: r.owner_id,
              last4: null,
            })),
            deposits: [],
            fundTxns: [],
            rentWords: ['sample tenant'],
            remittanceWords: cfg.statements.remittanceWords,
            reviewAbove: cfg.statements.reviewAbove,
            pairDays: cfg.estimates.transferPairDays,
            fundDays: cfg.statements.fundMatchDays,
          });
          const statements = sampleAccounts.map((r, i) => ({
            id: `00000000-0000-0000-0001-${String(i + 1).padStart(12, '0')}`,
            asset_id: r.id,
            from_on: d(4, 1),
            to_on: d(6, 30),
            opening: null,
            closing: null,
            line_count: lines.filter((l) => l.assetId === r.id).length,
            breaks: 0,
            layout: 'debit-credit',
            file_label: null,
            uploaded_at: today,
          }));
          return { lines, classified, statements };
        })()
      : null;
  const accountsOf: Record<string, { id: string; label: string }[]> = {};
  for (const r of rows.filter((x) => x.type === 'bank_account'))
    (accountsOf[r.owner_id] ??= []).push({ id: r.id, label: labels[r.id]! });
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
            Sample with invented figures: nothing you save here is kept.{' '}
            <Link href="/login">Sign in</Link>
          </p>
          <PageHead
            title="Explain movements"
            subtitle="Where matured money went, what a balance change was, and where a new deposit's money came from. Your answers make own money and profit exact; until then the amounts are kept apart and never counted as profit."
            pills={[
              q.count === 0
                ? { label: 'Nothing to explain', tone: 'ok' }
                : { label: `${q.count} to explain`, tone: 'warn' },
            ]}
          />
          <Tabs
            base="/demo/reconcile"
            current={tab}
            tabs={[
              { key: 'recent', label: 'Recent', badge: q.count || null },
              { key: 'history', label: 'Earlier months' },
              { key: 'interest', label: 'Interest (AIS)' },
              { key: 'statements', label: 'Bank statements' },
            ]}
          />
          {stmt ? (
            <Statements
              statements={stmt.statements}
              lines={stmt.lines}
              classified={stmt.classified}
              interest={[]}
              labels={labels}
              covered={[]}
              act={{
                answer: sampleFinish,
                remove: sampleFinish,
                rebuild: sampleFinish,
                covered: sampleFinish,
              }}
              sample
            />
          ) : interest ? (
            <Interest
              rows={interest}
              answers={[]}
              ownerName={ownerName}
              accountsOf={accountsOf}
              act={{ record: sampleFinish, undo: sampleFinish }}
              sample
            />
          ) : review ? (
            <History
              review={review}
              answers={[]}
              holdings={rows
                .map((r) => ({ id: r.id, label: labels[r.id]! }))
                .sort((x, y) => x.label.localeCompare(y.label))}
              opening={ledger.opening?.date ?? null}
              minimum={cfg.capital.reviewMinimum}
              act={{ record: sampleFinish, undo: sampleFinish }}
              sample
            />
          ) : (
            <Recent
              q={q}
              accounts={rows.filter((r) => r.type === 'bank_account')}
              deposits={rows.filter((r) => r.type === 'fixed_deposit')}
              ownerName={ownerName}
              labels={labels}
              today={today}
              tolerance={cfg.estimates.unexplainedTolerance}
              act={{
                confirmProceeds: sampleFinish,
                explainBalance: sampleFinish,
                recordFunding: sampleFinish,
              }}
              sample
            />
          )}
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
