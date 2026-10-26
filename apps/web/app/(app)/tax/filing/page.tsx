import Link from 'next/link';
import { currentFy, formatInr, fyBounds, interestSchedule } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { loadFdsForFiling, parseRate } from '@/lib/filing';

export const dynamic = 'force-dynamic';

export default async function FilingPage({
  searchParams,
}: {
  searchParams: Promise<{ fy?: string; tds?: string }>;
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

  return (
    <>
      <h1>Tax filing papers</h1>
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

      <section className="card">
        <h2>Capital gains on mutual funds</h2>
        <p className="muted">
          Not available yet: it needs your fund transaction history (the consolidated statement from
          CAMS/KFintech or an export from Kuvera). Once that is imported this page will list each
          redemption, split short and long term, and prepare the schedule you upload when filing,
          per taxpayer.
        </p>
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
    </>
  );
}
