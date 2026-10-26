import Link from 'next/link';
import { formatInr, personStyles } from '@fwos/core';
import {
  ensureInterestRefundRecords,
  ensureRefundRecords,
  loadHarvestPositions,
  loadSettings,
  planHarvest,
  planInterestRefunds,
} from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PersonBadge } from '@/components/Person';
import { TaxSimulator } from '@/components/TaxSimulator';
import { loadContext } from '@/lib/data';
import { updateRefund } from './actions';

export const dynamic = 'force-dynamic';

const niceDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export default async function TaxPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const { positions, ownerName, today } = await loadHarvestPositions(
    supabase as unknown as SupabaseClient,
  );
  const iso = today.toISOString().slice(0, 10);
  const settings = await loadSettings(supabase as unknown as SupabaseClient);
  const plan = planHarvest(positions, iso, {
    rules: settings.rules,
    config: settings.config.harvest,
  });
  try {
    const db = supabase as unknown as SupabaseClient;
    await ensureRefundRecords(db, householdId, plan);
    await ensureInterestRefundRecords(
      db,
      householdId,
      await planInterestRefunds(db, settings.config, settings.rules, iso),
    );
  } catch {
    /* the tracker below shows what is stored */
  }
  const refunds = (
    await supabase
      .from('tds_refunds')
      .select(
        'id, owner_id, fy, description, expected_gain, expected_tds, expected_refund, actual_gain, actual_tds, refund_received, status, notes',
      )
      .order('fy', { ascending: false })
  ).data as
    | {
        id: string;
        owner_id: string;
        fy: string;
        description: string | null;
        expected_gain: number;
        expected_tds: number;
        expected_refund: number;
        actual_gain: number | null;
        actual_tds: number | null;
        refund_received: number | null;
        status: 'planned' | 'withheld' | 'claimed' | 'received';
        notes: string | null;
      }[]
    | null;
  const styles = personStyles([...ownerName.entries()].map(([id, name]) => ({ id, name })));
  const daysLeft = Math.round(
    (Date.parse(`${plan.deadline}T00:00:00Z`) - today.getTime()) / 86_400_000,
  );

  return (
    <>
      <h1>Tax</h1>
      <p className="muted">
        Worked out for you from your holdings; nothing to type. Each person can realise ₹1,25,000 of
        long-term equity-fund gain a year without tax. Unused allowance is lost on 31 March.
      </p>

      <section className="card hero" aria-label="Harvest deadline">
        <p className="muted small">Financial year {plan.fy}</p>
        <p className="big">{daysLeft} days left</p>
        <p className="small">
          to use this year&apos;s tax-free allowance, by {niceDate(plan.deadline)}.
        </p>
        {plan.rulesCarriedForward && (
          <p className="small muted">
            No tax numbers are entered for {plan.fy} yet, so last year&apos;s are assumed.{' '}
            <Link href="/settings#tax">Check them in Settings</Link>.
          </p>
        )}
        {!plan.rulesVerified && !plan.rulesCarriedForward && (
          <p className="small muted">
            Rates and limits come from secondary sources and are marked unverified until checked on
            the official site.
          </p>
        )}
      </section>

      {plan.plans.length === 0 && <p className="notice warn">No fund holdings found yet.</p>}
      {plan.plans.map((pp) => (
        <section
          className="card bank"
          key={pp.ownerId}
          style={{ ['--person' as string]: styles[pp.ownerId]?.colour }}
        >
          <header className="bankhead personhead">
            <div>
              <h2>
                <PersonBadge p={styles[pp.ownerId]} name size={26} />
              </h2>
              <div className="muted small">
                Tax-free allowance {formatInr(pp.exemption)} · already used{' '}
                {formatInr(pp.alreadyUsed)}
              </div>
            </div>
            <div className="bankright">
              {pp.picks.length > 0 ? (
                <>
                  <div className="bankTotal num">{formatInr(pp.totalGain)}</div>
                  <div className="small muted">tax-free gain to realise</div>
                </>
              ) : (
                <span className="pill">Nothing to do now</span>
              )}
            </div>
          </header>
          {pp.picks.length > 0 ? (
            <>
              <table className="tbl lines responsive">
                <thead>
                  <tr>
                    <th>Do this</th>
                    <th className="num">Sell about</th>
                    <th className="num">Gain realised</th>
                    <th className="num">Then buy back</th>
                  </tr>
                </thead>
                <tbody>
                  {pp.picks.map((x) => (
                    <tr key={x.assetId}>
                      <td data-label="Do this">
                        {x.fullExit ? 'Sell all of' : 'Sell part of'} <strong>{x.fund}</strong>,
                        then buy it back
                      </td>
                      <td className="num" data-label="Sell about">
                        {formatInr(x.sellAmount)}
                      </td>
                      <td className="num gain" data-label="Gain realised">
                        +{formatInr(x.estimatedGain)}
                      </td>
                      <td className="num" data-label="Then buy back">
                        {formatInr(x.buyBackAmount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted" style={{ padding: '4px 18px 14px' }}>
                Tax avoided on these gains later, if you would otherwise have sold them: about{' '}
                {formatInr(pp.futureTaxMayBeAvoided)}. As a non-resident the fund house withholds
                about {formatInr(pp.tdsWithheld)} now. All of it comes back when you file, because
                these gains stay inside the tax-free allowance. Put {formatInr(pp.buyBackTotal)}{' '}
                back into the same funds straight after the sales. A reminder task is created
                automatically.
              </p>
            </>
          ) : (
            <p className="muted small" style={{ padding: '4px 18px 14px' }}>
              {pp.notes[0] ?? 'Nothing qualifies this year.'}
            </p>
          )}
        </section>
      ))}

      <section className="card" id="refunds">
        <h2>Tax refunds to claim</h2>
        <p className="muted small">
          As a non-resident, tax is withheld when funds are sold. Each harvest creates a record here
          by itself. After you sell, enter what was actually withheld (it is on the fund
          house&apos;s contract note); when you file, mark it claimed; when the money arrives, enter
          it. <Link href="/tax/refunds/csv">Download as CSV</Link>
        </p>
        {(refunds ?? []).length === 0 ? (
          <p className="muted small">
            Nothing to claim yet. A record appears when a harvest is planned.
          </p>
        ) : (
          <table className="tbl lines responsive">
            <thead>
              <tr>
                <th>Person · year</th>
                <th className="num">Expected gain</th>
                <th className="num">Expected refund</th>
                <th>Progress</th>
              </tr>
            </thead>
            <tbody>
              {(refunds ?? []).map((r) => (
                <tr key={r.id}>
                  <td data-label="Person · year">
                    <PersonBadge p={styles[r.owner_id]} name size={20} /> · FY {r.fy}
                    <div className="muted small">{r.description}</div>
                  </td>
                  <td className="num" data-label="Expected gain">
                    {formatInr(r.expected_gain)}
                  </td>
                  <td className="num" data-label="Expected refund">
                    {formatInr(r.expected_refund)}
                    {r.refund_received !== null && (
                      <div className="small gain">received {formatInr(r.refund_received)}</div>
                    )}
                  </td>
                  <td data-label="Progress">
                    <form action={updateRefund} className="row small">
                      <input type="hidden" name="id" value={r.id} />
                      <select name="status" defaultValue={r.status} aria-label="Status">
                        <option value="planned">Planned</option>
                        <option value="withheld">Sold, tax withheld</option>
                        <option value="claimed">Claimed in return</option>
                        <option value="received">Refund received</option>
                      </select>
                      <input
                        className="mini"
                        name="actualGain"
                        placeholder="Actual gain"
                        defaultValue={r.actual_gain ?? ''}
                        aria-label="Actual gain"
                      />
                      <input
                        className="mini"
                        name="actualTds"
                        placeholder="Tax withheld"
                        defaultValue={r.actual_tds ?? ''}
                        aria-label="Tax withheld"
                      />
                      <input
                        className="mini"
                        name="refundReceived"
                        placeholder="Refund received"
                        defaultValue={r.refund_received ?? ''}
                        aria-label="Refund received"
                      />
                      <button className="btn compact">Save</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Tax withheld on NRO deposit interest is listed here too. It is refunded in full while each
          person&apos;s total taxable Indian income stays under the limit set in{' '}
          <Link href="/settings#limits">Settings</Link> (
          {formatInr(settings.config.refunds.incomeLimit)}
          {settings.config.refunds.otherIncome > 0
            ? `, with ${formatInr(settings.config.refunds.otherIncome)} of other income counted`
            : ''}
          ). Over the limit the refund depends on the tax actually due, so none is expected until
          you check with an adviser. See the <Link href="/tax/filing">filing papers</Link> for the
          interest itself.
        </p>
      </section>

      <details className="card">
        <summary>How this is worked out, and its limits</summary>
        <ul className="list small">
          {plan.assumptions.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      </details>

      <section className="card">
        <h2>Other tax tools</h2>
        <p className="row">
          <Link className="btn" href="/tax/filing">
            Filing papers (FD interest per person, checklist)
          </Link>
        </p>
      </section>

      <details className="card">
        <summary>Try a specific sale (simulator)</summary>
        <TaxSimulator rules={settings.rules} />
      </details>
    </>
  );
}
