import type { Metadata } from 'next';
import { DEFAULT_CONFIG, parsePrices, summariseUsage, type AiUsageRow } from '@fwos/core';
import { CostView } from '@/app/(app)/ai-cost/CostView';
import { DemoShell } from '@/components/DemoShell';
import { DEMO_TODAY } from '@/lib/demo-fixture';

export const metadata: Metadata = {
  title: 'Sample AI cost',
  robots: { index: false, follow: false },
};

const TODAY = DEMO_TODAY.toISOString().slice(0, 10);
const day = (n: number) => {
  const d = new Date(`${TODAY}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};
let seq = 0;
const call = (
  n: number,
  hh: string,
  o: Partial<AiUsageRow> & Pick<AiUsageRow, 'purpose' | 'input' | 'output'>,
): AiUsageRow => ({
  id: `d${seq++}`,
  at: `${day(n)}T${hh}:00Z`,
  provider: 'anthropic',
  model: 'claude-haiku-5-5',
  ok: true,
  status: 200,
  cacheRead: 0,
  cacheWrite: 0,
  known: true,
  ms: 1800,
  note: null,
  ...o,
});

/** Invented calls: a weekly rates run (first call writes the cache, the rest read it), a few e-mails, a test and a failed call. */
const ROWS: AiUsageRow[] = [
  ...[0, 7, 14, 21].flatMap((n) =>
    ['HDFC', 'IDFC', 'AU', 'ESAF', 'RBL'].map((_, i) =>
      call(n, `0${3 + Math.floor(i / 3)}:${10 + i}`, {
        purpose: 'rates_refresh',
        input: 700 + i * 90,
        output: 380 + i * 25,
        cacheRead: i === 0 ? 0 : 900,
        cacheWrite: i === 0 ? 900 : 0,
      }),
    ),
  ),
  call(1, '08:30', { purpose: 'inbox_email', input: 640, output: 90 }),
  call(2, '12:30', { purpose: 'inbox_email', input: 810, output: 110, cacheRead: 700 }),
  call(4, '09:05', { purpose: 'inbox_statement', input: 9200, output: 520 }),
  call(3, '10:00', { purpose: 'ai_test', input: 260, output: 70 }),
  call(1, '14:20', {
    purpose: 'rates_check',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    input: 5200,
    output: 300,
  }),
  call(0, '02:11', {
    purpose: 'inbox_email',
    ok: false,
    status: 429,
    known: false,
    input: 0,
    output: 0,
    note: 'Anthropic answered 429 (busy, or its limit is used up for now)',
  }),
];

/** Public preview of the AI cost page with invented calls: nothing private is read. */
export default function DemoAiCost() {
  const prices = parsePrices(DEFAULT_CONFIG.ai.prices);
  return (
    <DemoShell>
      <CostView
        summary={summariseUsage(ROWS, prices, TODAY)}
        usdInr={DEFAULT_CONFIG.ai.usdInr}
        prices={prices}
        demo
      />
    </DemoShell>
  );
}
