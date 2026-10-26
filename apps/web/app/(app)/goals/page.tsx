import { formatInr, formatInrCompact, projectGoal } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { createGoal, removeAllocation, setAllocation, updateGoal } from './actions';

export const dynamic = 'force-dynamic';

const DEFAULT_INFLATION: Record<string, number> = {
  education: 0.09,
  marriage: 0.07,
  retirement: 0.055,
  property: 0.06,
  emergency: 0.055,
  other: 0.055,
};

/** A cautious, horizon-based return assumption for money earmarked for a goal. It is an assumption, not a promise. */
const returnFor = (years: number) => (years >= 8 ? 0.1 : years >= 4 ? 0.08 : 0.065);

export default async function GoalsPage({
  searchParams,
}: {
  searchParams: Promise<{ e?: string }>;
}) {
  const { e } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, portfolio, assetRows }, goals, allocs, sips] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('goals')
      .select('id, name, kind, target_amount, target_date, inflation_rate')
      .order('name'),
    supabase.from('goal_allocations').select('goal_id, asset_id, method, value'),
    supabase.from('mf_positions').select('asset_id, sip_monthly, sip_stopped'),
  ]);
  const value = new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? 0]));
  const nick = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const sip = new Map(
    (sips.data ?? []).map((s) => [
      s.asset_id as string,
      s.sip_stopped ? 0 : Number(s.sip_monthly ?? 0),
    ]),
  );
  const todayIso = today.toISOString().slice(0, 10);

  const rows = (goals.data ?? []).map((g) => {
    const mine = (allocs.data ?? []).filter((a) => a.goal_id === g.id);
    let allocated = 0;
    let monthly = 0;
    const lines = mine.map((a) => {
      const v = value.get(a.asset_id as string) ?? 0;
      const share =
        a.method === 'percent' ? (v * Number(a.value)) / 100 : Math.min(v, Number(a.value));
      allocated += share;
      if (a.method === 'percent')
        monthly += ((sip.get(a.asset_id as string) ?? 0) * Number(a.value)) / 100;
      return {
        asset: a.asset_id as string,
        pct: a.method === 'percent' ? Number(a.value) : null,
        share,
      };
    });
    const target = g.target_amount ? Number(g.target_amount) : null;
    const years = g.target_date
      ? (Date.parse(g.target_date as string) - Date.parse(todayIso)) / (365.25 * 86_400_000)
      : 0;
    const infl =
      g.inflation_rate !== null && g.inflation_rate !== undefined
        ? Number(g.inflation_rate)
        : (DEFAULT_INFLATION[g.kind as string] ?? 0.055);
    const proj = projectGoal({
      targetToday: target,
      targetDate: (g.target_date as string | null) ?? null,
      inflation: infl,
      allocatedNow: allocated,
      monthlyContribution: monthly,
      annualReturn: returnFor(years),
      today: todayIso,
    });
    return { g, lines, allocated, monthly, infl, years, proj };
  });
  const usedBy = new Map<string, number>();
  for (const a of allocs.data ?? [])
    if (a.method === 'percent')
      usedBy.set(a.asset_id as string, (usedBy.get(a.asset_id as string) ?? 0) + Number(a.value));
  const choices = assetRows
    .filter(
      (a) =>
        ['mutual_fund', 'fixed_deposit', 'bank_account', 'stock'].includes(a.type) &&
        ['active', 'stopped'].includes(a.status),
    )
    .sort((a, b) => a.nickname.localeCompare(b.nickname));
  const totalAllocated = rows.reduce((s, r) => s + r.allocated, 0);
  const unallocated = [...value.entries()]
    .filter(([id]) => choices.some((c) => c.id === id))
    .reduce((s, [id, v]) => s + v * (1 - Math.min(100, usedBy.get(id) ?? 0) / 100), 0);

  return (
    <>
      <h1>Goals</h1>
      <p className="muted">
        A holding can fund several goals, but its value is counted once: allocations are shares of
        the same money, never extra money. Projections are estimates under the stated assumptions.
      </p>
      {e && (
        <p className="notice warn" role="alert">
          {e === 'over'
            ? 'That would allocate more than 100% of this holding across goals.'
            : 'Enter a percentage between 1 and 100.'}
        </p>
      )}
      <section className="card">
        <p>
          Earmarked for goals: <strong>{formatInr(totalAllocated)}</strong> · Not earmarked:{' '}
          <strong>{formatInr(unallocated)}</strong>
        </p>
      </section>

      {rows.map(({ g, lines, allocated, monthly, infl, years, proj }) => (
        <section className="card" key={g.id as string} aria-labelledby={`g-${g.id as string}`}>
          <h2 id={`g-${g.id as string}`}>{g.name as string}</h2>
          <p className={proj.status === 'shortfall' ? 'fail' : ''}>
            <strong>{proj.message}</strong>
          </p>
          {proj.futureCost !== null && (
            <table className="tbl">
              <tbody>
                <tr>
                  <th scope="row">Cost then (target grown at {(infl * 100).toFixed(1)}% a year)</th>
                  <td className="num">{formatInrCompact(proj.futureCost)}</td>
                </tr>
                <tr>
                  <th scope="row">
                    Projected funding (at {(returnFor(years) * 100).toFixed(1)}% a year, assumed)
                  </th>
                  <td className="num">{formatInrCompact(proj.projectedValue!)}</td>
                </tr>
                <tr className="sum">
                  <th scope="row">{proj.gap! > 0 ? 'Shortfall' : 'Surplus'} (in today&apos;s ₹)</th>
                  <td className="num">{formatInrCompact(Math.abs(proj.gapToday!))}</td>
                </tr>
                {proj.gap! > 0 && (
                  <tr>
                    <th scope="row">Extra needed each month to close it</th>
                    <td className="num">{formatInr(Math.round(proj.requiredMonthlyExtra!))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
          <p className="muted small">
            Earmarked now {formatInr(allocated)} · SIP share {formatInr(monthly)}/month
          </p>

          <details>
            <summary>Target and assumptions</summary>
            <form action={updateGoal} className="form">
              <input type="hidden" name="id" value={g.id as string} />
              <div className="formgrid">
                <label>
                  Target in today&apos;s ₹
                  <input
                    name="target"
                    inputMode="decimal"
                    defaultValue={g.target_amount ? String(g.target_amount) : ''}
                  />
                </label>
                <label>
                  Needed by
                  <input
                    name="date"
                    type="date"
                    defaultValue={(g.target_date as string | null) ?? ''}
                  />
                </label>
                <label>
                  Cost inflation % a year
                  <input
                    name="inflation"
                    inputMode="decimal"
                    defaultValue={
                      g.inflation_rate !== null && g.inflation_rate !== undefined
                        ? String(Number(g.inflation_rate) * 100)
                        : ''
                    }
                    placeholder={`${((DEFAULT_INFLATION[g.kind as string] ?? 0.055) * 100).toFixed(1)} (default)`}
                  />
                </label>
              </div>
              <button className="btn">Save target</button>
            </form>
          </details>

          <details open={lines.length > 0}>
            <summary>Money earmarked for this goal ({lines.length})</summary>
            <table className="tbl responsive">
              <tbody>
                {lines.map((l) => (
                  <tr key={l.asset}>
                    <td data-label="Holding">{nick.get(l.asset) ?? '—'}</td>
                    <td className="num" data-label="Share">
                      {l.pct !== null ? `${l.pct}%` : 'fixed amount'}
                    </td>
                    <td className="num" data-label="Value">
                      {formatInr(l.share)}
                    </td>
                    <td>
                      <form action={removeAllocation}>
                        <input type="hidden" name="goal" value={g.id as string} />
                        <input type="hidden" name="asset" value={l.asset} />
                        <button className="btn compact ghost">Remove</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={setAllocation} className="form row">
              <input type="hidden" name="goal" value={g.id as string} />
              <select name="asset" aria-label="Holding" required defaultValue="">
                <option value="" disabled>
                  Choose a holding
                </option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nickname} ({Math.max(0, 100 - (usedBy.get(c.id) ?? 0))}% free)
                  </option>
                ))}
              </select>
              <input
                name="percent"
                inputMode="decimal"
                placeholder="% of it"
                aria-label="Percent"
                required
              />
              <button className="btn">Earmark</button>
            </form>
          </details>
        </section>
      ))}

      <section className="card">
        <h2>Add a goal</h2>
        <form action={createGoal} className="form row">
          <input
            name="name"
            placeholder="For example: Advika overseas education"
            required
            aria-label="Goal name"
          />
          <select name="kind" aria-label="Kind" defaultValue="education">
            <option value="education">Education</option>
            <option value="marriage">Marriage</option>
            <option value="retirement">Retirement</option>
            <option value="property">Property</option>
            <option value="emergency">Emergency reserve</option>
            <option value="other">Other</option>
          </select>
          <button className="btn primary">Add</button>
        </form>
      </section>
    </>
  );
}
