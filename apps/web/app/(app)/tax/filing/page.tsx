import { ListingTools } from '@/components/ListingTools';
import Link from 'next/link';
import {
  classifyGains,
  currentFy,
  effectiveRules,
  formatInr,
  fyBounds,
  interestSchedule,
  summariseGains,
} from '@fwos/core';
import { loadRealisedGains, loadSettings, loadTaxStatements } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadFdsForFiling, parseRate } from '@/lib/filing';
import { TaxFiles } from './TaxFiles';

export const dynamic = 'force-dynamic';

export default async function FilingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const today = new Date().toISOString().slice(0, 10);
  const cur = currentFy(today);
  const prevYear = String(Number(cur.slice(0, 4)) - 1);
  const prev = `${prevYear}-${String(Number(prevYear) + 1).slice(2)}`;
  let fy = sp.fy && /^\d{4}-\d{2}$/.test(sp.fy) ? sp.fy : prev;
  try {
    fyBounds(fy);
  } catch {
    fy = prev;
  }
  const tds = parseRate(sp.tds);
  const { fds, ownerNames } = await loadFdsForFiling(supabase);
  const s = interestSchedule(fds, fy, today, tds);
  const owners = Object.entries(s.byOwner);
  const db = supabase as unknown as SupabaseClient;
  const [gainsData, settings, statements, refundRows] = await Promise.all([
    loadRealisedGains(db, fy),
    loadSettings(db),
    loadTaxStatements(db, fy),
    supabase
      .from('tds_refunds')
      .select('owner_id, kind, expected_tds, actual_tds')
      .eq('fy', fy)
      .eq('kind', 'harvest'),
  ]);
  const rule = effectiveRules(fyBounds(fy).end, settings.rules)?.rules ?? null;
  const gains = summariseGains(
    classifyGains(gainsData.rows, rule?.equity.holdingMonthsLong ?? 12),
    rule,
  );

  return (
    <>
      <h1>Tax filing papers</h1>
      <ListingTools name="tax-filing">
        <p className="muted">
          Working papers for your own return, one taxpayer at a time. Each person&apos;s income,
          exemptions and tax stay separate. These are estimates to check against your bank
          certificates, Form 26AS and the Annual Information Statement.
        </p>
        <div className="row" role="group" aria-label="Financial year">
          {[prev, cur].map((y) => (
            <Link
              key={y}
              className={`btn compact ${y === fy ? 'primary' : ''}`}
              href={`/tax/filing?fy=${y}${tds ? `&tds=${tds}` : ''}`}
            >
              FY {y}
            </Link>
          ))}
          <Link className="btn compact" href="/tax">
            Redemption simulator
          </Link>
        </div>
        {s.partialYear && (
          <p className="notice warn">This financial year is not over. Figures run up to today.</p>
        )}

        <section className="card">
          <h2>Interest on fixed deposits, FY {fy}</h2>
          {owners.length === 0 ? (
            <p className="muted">No deposits earned interest in this year.</p>
          ) : (
            owners.map(([id, o]) => (
              <div key={id}>
                <h3>{ownerNames[id] ?? 'Unknown'}</h3>
                <table className="tbl">
                  <tbody>
                    <tr>
                      <th scope="row">Taxable in India (NRO deposits)</th>
                      <td className="num">{formatInr(Math.round(o.taxableInterest))}</td>
                    </tr>
                    <tr>
                      <th scope="row">Exempt in India (NRE deposits)</th>
                      <td className="num">{formatInr(Math.round(o.exemptNreInterest))}</td>
                    </tr>
                    {o.unclassifiedInterest > 0 && (
                      <tr>
                        <th scope="row" className="fail">
                          Account type to check (joint or not stated)
                        </th>
                        <td className="num">{formatInr(Math.round(o.unclassifiedInterest))}</td>
                      </tr>
                    )}
                    {tds !== null && (
                      <tr className="sum">
                        <th scope="row">
                          Tax at source estimated at {(tds * 100).toFixed(1)}% of taxable interest
                        </th>
                        <td className="num">{formatInr(Math.round(o.tdsEstimate))}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <form method="get" className="form row small">
                  <input type="hidden" name="fy" value={fy} />
                  {tds ? <input type="hidden" name="tds" value={tds} /> : null}
                  <label>
                    Tax deducted as shown in Form 26AS (₹), to compare
                    <input
                      name={`a_${id}`}
                      inputMode="numeric"
                      defaultValue={sp[`a_${id}`] ?? ''}
                    />
                  </label>
                  <button className="btn compact">Compare</button>
                  {(() => {
                    const raw = Number(String(sp[`a_${id}`] ?? '').replace(/[₹,\s]/g, ''));
                    if (!sp[`a_${id}`] || !Number.isFinite(raw)) return null;
                    if (tds === null)
                      return (
                        <span className="muted">Set the tax-at-source rate below to compare.</span>
                      );
                    const diff = raw - Math.round(o.tdsEstimate);
                    return (
                      <span className={Math.abs(diff) <= 1000 ? 'ok' : 'fail'}>
                        {Math.abs(diff) <= 1000
                          ? 'Matches the estimate.'
                          : `${formatInr(Math.abs(diff))} ${diff > 0 ? 'more' : 'less'} than estimated: check with the bank's Form 16A.`}
                      </span>
                    );
                  })()}
                </form>
                <details>
                  <summary>Deposit-by-deposit ({o.lines.length})</summary>
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Deposit</th>
                        <th>Type</th>
                        <th>Period</th>
                        <th className="num">Interest</th>
                      </tr>
                    </thead>
                    <tbody>
                      {o.lines.map((l) => (
                        <tr key={l.fdId}>
                          <td data-label="Deposit">
                            {l.bank} · {l.nickname}
                          </td>
                          <td data-label="Type">{l.kind}</td>
                          <td data-label="Period">
                            {l.from} to {l.to}
                          </td>
                          <td className="num" data-label="Interest">
                            {formatInr(Math.round(l.interest))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            ))
          )}
          <p>
            <a className="btn" href={`/tax/filing/csv?fy=${fy}${tds ? `&tds=${tds}` : ''}`}>
              Download as a spreadsheet (CSV)
            </a>
          </p>
          <form method="get" className="form row">
            <input type="hidden" name="fy" value={fy} />
            <label className="check">
              Estimate tax at source at (e.g. 0.30 for 30%)
              <input
                name="tds"
                inputMode="decimal"
                defaultValue={tds ?? ''}
                placeholder="leave empty for none"
              />
            </label>
            <button className="btn compact">Update</button>
          </form>
          <ul className="list small muted">
            {s.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>

        <section className="card" id="taxfiles">
          <h2>What the tax department holds (Form 26AS and AIS), FY {fy}</h2>
          <p className="muted small">
            Upload them and they are compared with your own records: tax already credited, interest
            and fund sales reported by banks and fund houses. You can also e-mail the files to your
            inbox label and they are read by themselves.
          </p>
          <p className="small">
            <Link className="btn compact" href="/import?tab=tax">
              Upload a tax statement
            </Link>{' '}
            <span className="muted">
              Uploads now live on the Import page, with the password rules.
            </span>
          </p>
          {[...new Set(statements.map((x) => x.ownerId))].map((ownerId) => {
            const mine = s.byOwner[ownerId];
            const cess = rule?.cess ?? 0.04;
            const harvest = (refundRows.data ?? []).find((r) => r.owner_id === ownerId);
            return (
              <TaxFiles
                key={ownerId}
                name={ownerNames[ownerId] ?? 'Unknown'}
                statements={statements.filter((x) => x.ownerId === ownerId)}
                computed={{
                  fdInterestTaxable: mine?.taxableInterest ?? 0,
                  fdInterestNre: mine?.exemptNreInterest ?? 0,
                  interestTdsExpected:
                    (mine?.taxableInterest ?? 0) * settings.config.rates.nroTaxRate * (1 + cess),
                  harvestTds: Number(harvest?.actual_tds ?? harvest?.expected_tds ?? 0),
                  fundSaleProceeds: gainsData.rows
                    .filter((r) => r.ownerId === ownerId)
                    .reduce((a, r) => a + r.proceeds, 0),
                }}
              />
            );
          })}
        </section>

        <section className="card" id="gains">
          <h2>Capital gains on mutual funds, FY {fy}</h2>
          {gains.length === 0 ? (
            <p className="muted">
              No sales found for this year on the imported fund statements
              {gainsData.funds === 0
                ? '. Import a detailed fund statement (Import page) and this page lists every sale, short and long term, with the schedule for the return.'
                : '.'}
            </p>
          ) : (
            gains.map((g) => (
              <div key={g.ownerId}>
                <h3>{gainsData.ownerNames[g.ownerId] ?? 'Unknown'}</h3>
                <table className="tbl">
                  <tbody>
                    <tr>
                      <th scope="row">Short-term gain (equity funds)</th>
                      <td className="num">{formatInr(g.stcg)}</td>
                    </tr>
                    <tr>
                      <th scope="row">Long-term gain (equity funds)</th>
                      <td className="num">{formatInr(g.ltcg)}</td>
                    </tr>
                    {g.position && (
                      <>
                        <tr>
                          <th scope="row">Tax-free allowance used</th>
                          <td className="num">{formatInr(Math.round(g.position.exemptionUsed))}</td>
                        </tr>
                        <tr className="sum">
                          <th scope="row">Estimated tax on these gains</th>
                          <td className="num">{formatInr(Math.round(g.position.tax))}</td>
                        </tr>
                      </>
                    )}
                    {g.debtGains !== 0 && (
                      <tr>
                        <th scope="row">
                          Gain on funds that look like debt funds (taxed at your slab, not computed
                          here)
                        </th>
                        <td className="num">{formatInr(g.debtGains)}</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {g.unknownCost > 0 && (
                  <p className="notice warn small">
                    {g.unknownCost} sale{g.unknownCost === 1 ? '' : 's'} used units bought before
                    the statement began, so the cost is unknown and they are left out. Import a
                    statement from the first investment.
                  </p>
                )}
                {g.needsFmv > 0 && (
                  <p className="notice warn small">
                    {g.needsFmv} long-term sale{g.needsFmv === 1 ? '' : 's'} used units bought
                    before 1 February 2018. The portal also needs each fund&apos;s value per unit on
                    31 January 2018 for those rows; the file leaves it blank.
                  </p>
                )}
                <details>
                  <summary>Every sale ({g.lines.length})</summary>
                  <table className="tbl responsive">
                    <thead>
                      <tr>
                        <th>Fund</th>
                        <th>Bought</th>
                        <th>Sold</th>
                        <th className="num">Units</th>
                        <th className="num">Sale value</th>
                        <th className="num">Cost</th>
                        <th className="num">Gain</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.lines.map((l, i) => (
                        <tr key={`${l.fund}${l.soldOn}${i}`}>
                          <td data-label="Fund">
                            {l.fund}{' '}
                            <span className="muted small">
                              ({l.term}-term{l.equity ? '' : ', debt?'})
                            </span>
                          </td>
                          <td data-label="Bought">
                            {l.acquiredOn === '1900-01-01' ? 'before statement' : l.acquiredOn}
                          </td>
                          <td data-label="Sold">{l.soldOn}</td>
                          <td className="num" data-label="Units">
                            {l.units.toFixed(3)}
                          </td>
                          <td className="num" data-label="Sale value">
                            {formatInr(Math.round(l.proceeds))}
                          </td>
                          <td className="num" data-label="Cost">
                            {l.cost === null ? '–' : formatInr(Math.round(l.cost))}
                          </td>
                          <td className="num" data-label="Gain">
                            {l.gain === null ? '–' : formatInr(Math.round(l.gain))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
                <p>
                  <a className="btn" href={`/tax/filing/gains?fy=${fy}&owner=${g.ownerId}`}>
                    Schedule 112A rows for {gainsData.ownerNames[g.ownerId] ?? 'this person'} (CSV)
                  </a>
                </p>
              </div>
            ))
          )}
          <ul className="list small muted">
            <li>
              Built from the sales on your fund statements, oldest units first. Check the figures
              against the fund houses&apos; capital-gains statements before you file.
            </li>
            <li>
              The column order of the schedule 112A file follows the portal&apos;s template as known
              to this app; compare it with the current template on the portal before uploading.
            </li>
            {fy === '2024-25' && (
              <li>
                This year the long-term rate changed on 23 July 2024: gains from before that date
                are taxed at the older rate, which the estimate above does not separate.
              </li>
            )}
          </ul>
        </section>

        <section className="card">
          <h2>Checklist for filing</h2>
          <ul className="list">
            <li>
              Download Form 26AS and the Annual Information Statement for each taxpayer and compare
              the tax deducted with the figures above.
            </li>
            <li>Collect interest certificates (Form 16A) from each bank for NRO deposits.</li>
            <li>
              Keep a valid tax residency certificate and Form 10F if you plan to claim treaty
              benefits; note their expiry dates.
            </li>
            <li>Redemption statements for every mutual-fund sale this year, for each taxpayer.</li>
            <li>
              Check the due date for your category on the Income Tax Department website; do not rely
              on this page for deadlines.
            </li>
          </ul>
          <p className="muted small">
            Decision support only; not tax advice. Rules change every year.
          </p>
        </section>
      </ListingTools>
    </>
  );
}
