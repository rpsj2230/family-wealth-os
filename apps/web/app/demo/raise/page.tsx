import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CONFIG, answerHard, answerRaise, buildSources } from '@fwos/core';
import { HardResult, RaiseResult } from '@/components/RaiseResult';
import { demoRaiseSources } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample: I need money',
  robots: { index: false, follow: false },
};

export default async function DemoRaise({
  searchParams,
}: {
  searchParams: Promise<{ amount?: string; urgency?: string }>;
}) {
  const { amount, urgency } = await searchParams;
  const need = Math.round(Number(amount ?? '15000000')) || 15_000_000;
  const d = demoRaiseSources();
  const cfg = DEFAULT_CONFIG.liquidity;
  const sources = buildSources({
    valued: d.valued,
    assetRows: d.assetRows,
    fds: d.fds,
    funds: d.funds,
    today: d.today,
    config: cfg,
    institutionNames: d.institutionNames,
  });
  const hard = urgency === 'hard';
  const hardAns = hard
    ? answerHard(need, sources, { today: d.today, preferenceOrder: cfg.order }, null)
    : null;
  const ans = answerRaise(need, sources, {
    today: d.today,
    order: cfg.order,
    mode: cfg.mode,
    scenarioDays: cfg.scenarioDays,
  });
  return (
    <main className="content">
      <p>
        <Link href="/login">← Sign in</Link>
      </p>
      <h1>I need money (sample)</h1>
      <p className="notice warn" role="note">
        Invented household. Try another amount:{' '}
        {[200_000, 15_000_000, 30_000_000].map((a) => (
          <Link key={a} href={`/demo/raise?amount=${a}`} style={{ marginRight: 10 }}>
            ₹{a.toLocaleString('en-IN')}
          </Link>
        ))}
      </p>
      <p className="small">
        <Link href={`/demo/raise?amount=${need}`}>Soft need (lowest cost)</Link> ·{' '}
        <Link href={`/demo/raise?amount=${need}&urgency=hard`}>Hard need (any cost)</Link>
      </p>
      {hardAns ? (
        <HardResult ans={hardAns} today={d.today} styles={d.styles} />
      ) : (
        <RaiseResult ans={ans} need={need} today={d.today} styles={d.styles} cfg={cfg} />
      )}
    </main>
  );
}
