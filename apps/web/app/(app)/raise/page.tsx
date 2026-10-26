import Link from 'next/link';
import { personStyles, type LiquidityKind } from '@fwos/core';
import { hardAnswer, loadRaiseContext, raiseAnswer } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadContext } from '@/lib/data';
import { readAmount } from '@/lib/read-amount';
import { RaiseForm } from './RaiseForm';
import { HardResult, RaiseResult } from '@/components/RaiseResult';
import { savePlanAsTasks } from './actions';

export const dynamic = 'force-dynamic';

export default async function RaisePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined));
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [ctx, owners] = await Promise.all([
    loadRaiseContext(supabase as unknown as SupabaseClient),
    supabase.from('owners').select('id, display_name').order('created_at'),
  ]);
  const people = (owners.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
  }));
  const styles = personStyles(people);
  const cfg = ctx.config.liquidity;

  const rawAmount = String(one('amount') ?? '').trim();
  const need = readAmount(rawAmount);
  const asked = Number.isFinite(need) && need > 0;
  const whose = one('who') && people.some((p) => p.id === one('who')) ? one('who')! : '';
  const picked = Array.isArray(sp.k) ? sp.k : sp.k ? [sp.k] : null;
  const order: LiquidityKind[] = picked ? cfg.order.filter((k) => picked.includes(k)) : cfg.order;
  const mode =
    (['cheapest', 'fastest', 'order'] as const).find((m) => m === one('mode')) ?? cfg.mode;
  const hard = one('urgency') === 'hard';
  const byRaw = one('by') ?? '';
  const byDays = /^\d{4}-\d{2}-\d{2}$/.test(byRaw)
    ? Math.max(0, Math.round((Date.parse(byRaw) - Date.parse(ctx.today)) / 86_400_000))
    : null;
  const ans =
    asked && !hard ? raiseAnswer(ctx, need, { ownerId: whose || null, order, mode }) : null;
  const hardAns = asked && hard ? hardAnswer(ctx, need, { ownerId: whose || null, byDays }) : null;

  return (
    <>
      <PageHead
        title="I need money"
        subtitle="Type an amount. The page shows which accounts it can come from, by when, and what each way costs. Nothing is moved for you."
        pills={[
          { label: hard ? 'hard need: any cost' : 'soft need: lowest cost', tone: 'info' },
          ...(whose
            ? [{ label: `only ${people.find((p) => p.id === whose)?.name ?? ''}'s money` }]
            : []),
        ]}
        actions={
          <Link className="btn ghost" href="/settings#liquidity">
            Preferences
          </Link>
        }
      />
      <RaiseForm
        action="/raise"
        people={people}
        cfg={cfg}
        values={{
          amount: asked ? String(need) : '',
          who: whose,
          hard,
          by: byRaw,
          mode,
          order,
        }}
      />

      {hardAns && (
        <HardResult ans={hardAns} today={ctx.today} styles={styles} saveSteps={savePlanAsTasks} />
      )}
      {ans && (
        <RaiseResult
          ans={ans}
          need={need}
          today={ctx.today}
          styles={styles}
          cfg={cfg}
          saveSteps={savePlanAsTasks}
        />
      )}
    </>
  );
}
