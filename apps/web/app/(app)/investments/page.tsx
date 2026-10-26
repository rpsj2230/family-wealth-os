import { formatInr, formatInrCompact, personStyles } from '@fwos/core';
import { PersonBadge, PersonFilter } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';

export const dynamic = 'force-dynamic';

interface Pos {
  asset_id: string;
  fund_name: string;
  invested: number | null;
  started_on: string | null;
  sip_monthly: number | null;
  sip_stopped: boolean;
}

const pct = (n: number) => `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;

export default async function InvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p } = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ assetRows, ownerName, portfolio }, pos] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('mf_positions')
      .select('asset_id, fund_name, invested, started_on, sip_monthly, sip_stopped'),
  ]);
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const who = p && styles[p] ? p : null;
  const owner = new Map(assetRows.map((a) => [a.id, a.owner_id]));
  const value = new Map(
    portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null]),
  );
  const line = portfolio.lines;

  const byOwner = new Map<string, (Pos & { value: number | null; ownerId: string })[]>();
  for (const x of (pos.data ?? []) as unknown as Pos[]) {
    const o = owner.get(x.asset_id);
    if (!o || (who && o !== who)) continue;
    const row = {
      ...x,
      invested: x.invested === null ? null : Number(x.invested),
      value: value.get(x.asset_id) ?? null,
      ownerId: o,
    };
    byOwner.set(o, [...(byOwner.get(o) ?? []), row]);
  }
  const sections = [...byOwner.entries()].sort((a, b) =>
    (styles[a[0]]?.name ?? '').localeCompare(styles[b[0]]?.name ?? ''),
  );
  const grand = sections.reduce((s, [, r]) => s + r.reduce((x, y) => x + (y.value ?? 0), 0), 0);
  const totals = Object.fromEntries(
    [...byOwner.entries()].map(([id, r]) => [
      id,
      formatInrCompact(r.reduce((x, y) => x + (y.value ?? 0), 0)),
    ]),
  );

  return (
    <>
      <h1>Investments</h1>
      <p className="muted">
        Mutual funds by person. Values move with the daily fund price; instalments from active SIPs
        are added automatically. Total {formatInr(grand)}.
      </p>
      <PersonFilter
        people={Object.values(styles)}
        basePath="/investments"
        current={who}
        totals={totals}
      />

      {sections.map(([ownerId, rows]) => {
        const val = rows.reduce((s, r) => s + (r.value ?? 0), 0);
        const inv = rows.reduce((s, r) => s + (r.invested ?? 0), 0);
        const sip = rows
          .filter((r) => !r.sip_stopped)
          .reduce((s, r) => s + Number(r.sip_monthly ?? 0), 0);
        const gain = val - inv;
        return (
          <section
            className="card bank"
            key={ownerId}
            style={{ ['--person' as string]: styles[ownerId]?.colour }}
          >
            <header className="bankhead personhead">
              <div>
                <h2>
                  <PersonBadge p={styles[ownerId]} name size={26} />
                </h2>
                <div className="muted small">
                  {rows.length} fund{rows.length === 1 ? '' : 's'} · invested {formatInr(inv)}
                  {sip > 0 ? ` · SIP ${formatInr(sip)} a month` : ''}
                </div>
              </div>
              <div className="bankright">
                <div className="bankTotal num">{formatInr(val)}</div>
                <div className={`small ${gain >= 0 ? 'gain' : 'fail'}`}>
                  {gain >= 0 ? '+' : '−'}
                  {formatInr(Math.abs(gain))} {inv > 0 ? `(${pct((gain / inv) * 100)})` : ''}
                </div>
              </div>
            </header>
            <table className="tbl lines responsive funds">
              <thead>
                <tr>
                  <th>Fund</th>
                  <th className="num">Invested</th>
                  <th className="num">Value today</th>
                  <th className="num">Gain</th>
                  <th className="num">SIP</th>
                </tr>
              </thead>
              <tbody>
                {rows
                  .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
                  .map((r) => {
                    const g = r.value !== null && r.invested ? r.value - r.invested : null;
                    return (
                      <tr key={r.asset_id}>
                        <td data-label="Fund">
                          <div>{r.fund_name}</div>
                          <div className="small muted">
                            {r.started_on ? `since ${r.started_on.slice(0, 7)}` : ''}
                            {line[r.asset_id]?.marketDate
                              ? ` · price of ${line[r.asset_id]!.marketDate}`
                              : ' · no live price yet'}
                          </div>
                        </td>
                        <td className="num" data-label="Invested">
                          {r.invested ? formatInr(r.invested) : '–'}
                        </td>
                        <td className="num amount" data-label="Value today">
                          {r.value === null ? '–' : formatInr(r.value)}
                        </td>
                        <td
                          className={`num ${g === null ? '' : g >= 0 ? 'gain' : 'fail'}`}
                          data-label="Gain"
                        >
                          {g === null ? '–' : `${g >= 0 ? '+' : '−'}${formatInr(Math.abs(g))}`}
                          {g !== null && r.invested ? (
                            <div className="small">{pct((g / r.invested) * 100)}</div>
                          ) : null}
                        </td>
                        <td className="num" data-label="SIP">
                          {r.sip_monthly ? (
                            r.sip_stopped ? (
                              <span className="muted">stopped</span>
                            ) : (
                              formatInr(Number(r.sip_monthly))
                            )
                          ) : (
                            '–'
                          )}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
        );
      })}
    </>
  );
}
