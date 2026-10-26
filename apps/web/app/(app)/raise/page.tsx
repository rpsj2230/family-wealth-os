import { KIND_LABEL, LIQUIDITY_KINDS, personStyles, type LiquidityKind } from '@fwos/core';
import { hardAnswer, loadRaiseContext, raiseAnswer } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
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

  const need = Math.round(Number(String(one('amount') ?? '').replace(/[₹,\s]/g, '')));
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
      <h1>I need money</h1>
      <p className="muted">
        Type an amount. The page shows which accounts it can come from, by when, and what each way
        costs, from your own balances, deposits, funds, shares and property. Nothing is moved for
        you.
      </p>

      <form className="card form" method="get" action="/raise">
        <fieldset className="urgency">
          <legend>How badly do you need it?</legend>
          <label className="check">
            <input type="radio" name="urgency" value="soft" defaultChecked={!hard} />{' '}
            <strong>Soft need</strong> — lowest cost, shown for several deadlines, using your
            preferences
          </label>
          <label className="check">
            <input type="radio" name="urgency" value="hard" defaultChecked={hard} />{' '}
            <strong>Hard need</strong> — I must have it, at any cost: every source is used, as soon
            as possible
          </label>
        </fieldset>
        <div className="formgrid g3">
          <label>
            Amount needed (₹)
            <input
              name="amount"
              inputMode="numeric"
              defaultValue={asked ? need : ''}
              placeholder="e.g. 500000"
              required
            />
          </label>
          <label>
            Whose money
            <select name="who" defaultValue={whose}>
              <option value="">Everyone (joint accounts included)</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Needed by (optional, for a hard need)
            <input type="date" name="by" defaultValue={byRaw} />
          </label>
          <label>
            Choose between sources by (soft need)
            <select name="mode" defaultValue={mode}>
              <option value="cheapest">Lowest cost</option>
              <option value="fastest">Fastest</option>
              <option value="order">My priority order</option>
            </select>
          </label>
        </div>
        <details>
          <summary>Advanced: choose where to look (soft need)</summary>
          <div className="row" style={{ padding: '8px 0' }}>
            {LIQUIDITY_KINDS.map((k) => (
              <label className="check" key={k}>
                <input
                  type="checkbox"
                  name="k"
                  value={k}
                  defaultChecked={order.includes(k)}
                  disabled={!cfg.order.includes(k)}
                />{' '}
                {KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <p className="muted small">
            Sources turned off in Settings (When I need money) cannot be switched on here. Costs,
            delays and the usual order are set there too.
          </p>
        </details>
        <div>
          <button className="btn primary">Show me where from</button>
        </div>
      </form>

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
