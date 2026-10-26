import type { Metadata } from 'next';
import Link from 'next/link';
import { DEFAULT_CONFIG, answerHard, answerRaise, buildSources } from '@fwos/core';
import { HardResult, RaiseResult } from '@/components/RaiseResult';
import { PageHead } from '@/components/PageHead';
import { RaiseForm } from '@/app/(app)/raise/RaiseForm';
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
      <PageHead
        title="I need money (sample)"
        subtitle="Type an amount to see which accounts it can come from, by when, and what each way costs."
        pills={[{ label: hard ? 'hard need: any cost' : 'soft need: lowest cost', tone: 'info' }]}
      />
      <p className="notice warn" role="note">
        Invented household. Try another amount:{' '}
        {[200_000, 15_000_000, 30_000_000].map((a) => (
          <Link
            key={a}
            href={`/demo/raise?amount=${a}${hard ? '&urgency=hard' : ''}`}
            style={{ marginRight: 10 }}
          >
            ₹{a.toLocaleString('en-IN')}
          </Link>
        ))}
      </p>
      <RaiseForm
        action="/demo/raise"
        people={d.people}
        cfg={cfg}
        settingsHref="/login"
        values={{ amount: String(need), who: '', hard, by: '', mode: cfg.mode, order: cfg.order }}
      />
      {hardAns ? (
        <HardResult ans={hardAns} today={d.today} styles={d.styles} />
      ) : (
        <RaiseResult ans={ans} need={need} today={d.today} styles={d.styles} cfg={cfg} />
      )}
    </main>
  );
}
