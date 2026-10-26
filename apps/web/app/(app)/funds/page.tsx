import { ListingTools } from '@/components/ListingTools';
import { coreTokens, matchFund, type AmfiScheme } from '@fwos/ingest';
import { formatInr } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { clearMatch, confirmMatch, setExitLoad } from './actions';

export const dynamic = 'force-dynamic';

export default async function FundsPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [pos, assets, owners, obs, schemes] = await Promise.all([
    supabase
      .from('mf_positions')
      .select(
        'asset_id, fund_name, plan_type, invested, sip_monthly, sip_stopped, nav_hint, amfi_code, started_on, exit_load_pct, exit_load_days',
      ),
    supabase.from('assets').select('id, owner_id, status'),
    supabase.from('owners').select('id, display_name'),
    supabase
      .from('observations')
      .select('asset_id, amount, as_of')
      .order('as_of', { ascending: false }),
    supabase.from('amfi_schemes').select('code', { count: 'exact', head: true }),
  ]);
  const ownerOf = new Map((assets.data ?? []).map((a) => [a.id as string, a.owner_id as string]));
  const ownerName = new Map(
    (owners.data ?? []).map((o) => [o.id as string, o.display_name as string]),
  );
  const lastValue = new Map<string, { amount: number; as_of: string }>();
  for (const o of obs.data ?? [])
    if (!lastValue.has(o.asset_id as string))
      lastValue.set(o.asset_id as string, { amount: Number(o.amount), as_of: o.as_of as string });
  const haveList = (schemes.count ?? 0) > 0;
  const funds = (pos.data ?? []).sort(
    (a, b) =>
      Number(!!a.sip_stopped) - Number(!!b.sip_stopped) ||
      String(a.fund_name).localeCompare(String(b.fund_name)),
  );

  // Candidate search in the AMFI list (public data stored by the daily job)
  const suggestions = new Map<string, Awaited<ReturnType<typeof matchFund>>>();
  if (haveList) {
    await Promise.all(
      funds
        .filter((f) => !f.amfi_code)
        .map(async (f) => {
          const toks = coreTokens(String(f.fund_name)).slice(0, 2);
          let q = supabase
            .from('amfi_schemes')
            .select('code, name, plan, option, amc, category, isin_growth, isin_reinvest')
            .eq('option', 'Growth');
          for (const t of toks) q = q.ilike('name', `%${t.replace(/(cap)$/, '%$1')}%`);
          const r = await q.limit(400);
          const list: AmfiScheme[] = (r.data ?? []).map((s) => ({
            code: s.code as string,
            isinGrowth: (s.isin_growth as string | null) ?? null,
            isinReinvest: (s.isin_reinvest as string | null) ?? null,
            name: s.name as string,
            plan: (s.plan as 'Direct' | 'Regular' | 'Other') ?? 'Other',
            option: 'Growth',
            nav: null,
            navDate: null,
            amc: (s.amc as string) ?? '',
            category: (s.category as string) ?? '',
          }));
          const hint = f.nav_hint && Number(f.nav_hint) > 0 ? Number(f.nav_hint) : null;
          suggestions.set(f.asset_id as string, matchFund(String(f.fund_name), list, hint));
        }),
    );
  }

  return (
    <>
      <h1>Match your funds</h1>
      <ListingTools name="funds">
        <p className="muted">
          To move each fund with the market, I need to know which official scheme it is. Check each
          suggestion (scheme name, Direct or Regular) and confirm. Once confirmed, today&apos;s
          value is estimated from the change in the fund&apos;s NAV since you last recorded its
          value. Estimates are labelled as such until a fund statement gives exact units.
        </p>
        {!haveList && (
          <p className="notice warn">
            The official scheme list has not been loaded yet. It is fetched by the daily market-data
            job (GitHub → Actions → &ldquo;Refresh market data&rdquo;); this page fills in after its
            first run.
          </p>
        )}
        <section className="card">
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Your fund</th>
                <th className="num">Last value</th>
                <th>Matched scheme</th>
                <th>Exit load</th>
              </tr>
            </thead>
            <tbody>
              {funds.map((f) => {
                const id = f.asset_id as string;
                const v = lastValue.get(id);
                const sug = suggestions.get(id);
                return (
                  <tr key={id} className={f.sip_stopped ? 'dim' : ''}>
                    <td data-label="Your fund">
                      <strong>{f.fund_name as string}</strong>
                      <br />
                      <span className="muted small">
                        {ownerName.get(ownerOf.get(id) ?? '') ?? ''} ·{' '}
                        {f.sip_stopped
                          ? 'SIP stopped'
                          : f.sip_monthly
                            ? `SIP ${formatInr(Number(f.sip_monthly))}/month`
                            : 'no SIP'}
                        {f.nav_hint ? ` · sheet note NAV ${f.nav_hint as string}` : ''}
                      </span>
                    </td>
                    <td className="num" data-label="Last value">
                      {v ? formatInr(v.amount) : '—'}
                      <br />
                      <span className="muted small">{v?.as_of ?? ''}</span>
                    </td>
                    <td data-label="Matched scheme">
                      {f.amfi_code ? (
                        <form action={clearMatch} className="taskrow">
                          <input type="hidden" name="asset" value={id} />
                          <span>Confirmed: scheme {f.amfi_code as string}</span>
                          <button className="btn compact ghost">Change</button>
                        </form>
                      ) : sug && sug.candidates.length > 0 ? (
                        <ul className="list nobullet">
                          {sug.candidates.slice(0, 3).map((c) => (
                            <li key={c.scheme.code}>
                              <form action={confirmMatch} className="taskrow">
                                <input type="hidden" name="asset" value={id} />
                                <input type="hidden" name="code" value={c.scheme.code} />
                                <span>
                                  {c.scheme.name}{' '}
                                  <span className="muted small">
                                    ({c.scheme.plan}, {c.scheme.amc})
                                  </span>
                                  {c.navGap !== null ? (
                                    <span className="muted small">
                                      {' '}
                                      · NAV differs {(c.navGap * 100).toFixed(0)}% from your note
                                    </span>
                                  ) : null}
                                </span>
                                <button className="btn compact">
                                  {sug.confidence === 'confident' && c === sug.candidates[0]
                                    ? 'Confirm'
                                    : 'Use this'}
                                </button>
                              </form>
                            </li>
                          ))}
                        </ul>
                      ) : haveList ? (
                        <span className="muted">
                          No automatic match. This fund&apos;s name may not match the official list;
                          leave it as is for now.
                        </span>
                      ) : (
                        <span className="muted">Waiting for the scheme list</span>
                      )}
                    </td>
                    <td data-label="Exit load">
                      <form action={setExitLoad} className="row small">
                        <input type="hidden" name="asset" value={id} />
                        <input
                          className="mini"
                          name="pct"
                          inputMode="decimal"
                          placeholder="default"
                          defaultValue={
                            f.exit_load_pct === null ? '' : String(Number(f.exit_load_pct) * 100)
                          }
                          aria-label={`Exit load percent for ${String(f.fund_name)}`}
                        />
                        <span className="muted">% for</span>
                        <input
                          className="mini"
                          name="days"
                          inputMode="numeric"
                          placeholder="days"
                          defaultValue={f.exit_load_days === null ? '' : String(f.exit_load_days)}
                          aria-label={`Exit load days for ${String(f.fund_name)}`}
                        />
                        <button className="btn compact ghost">Save</button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </ListingTools>
    </>
  );
}
