import Link from 'next/link';
import { formatInr, harvestDueOn, harvestView, personStyles, planLossHarvest } from '@fwos/core';
import {
  ensureInterestRefundRecords,
  ensureRefundRecords,
  loadHarvestPositions,
  loadSettings,
  planHarvest,
  planInterestRefunds,
} from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { PersonBadge } from '@/components/Person';
import { Tabs } from '@/components/Tabs';
import { TaxSimulator } from '@/components/TaxSimulator';
import { loadContext } from '@/lib/data';
import { updateRefund } from './actions';
import { Checklist, CostsNote, niceDate, PersonHarvest } from './Parts';

export const dynamic = 'force-dynamic';

const TABS = ['harvest', 'refunds', 'more'] as const;

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  // the loss section now sits on the harvest tab; old links to ?tab=losses land there
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'harvest';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const db = supabase as unknown as SupabaseClient;
  const { positions, ownerName, today, ytdRealised, ytd } = await loadHarvestPositions(db);
  const iso = today.toISOString().slice(0, 10);
  const settings = await loadSettings(db);
  const plan = planHarvest(positions, iso, {
    ytdRealised,
    rules: settings.rules,
    config: settings.config.harvest,
  });
  const losses = planLossHarvest(positions, iso, {
    ytd,
    plannedGain: Object.fromEntries(plan.plans.map((p) => [p.ownerId, p.totalGain])),
    rules: settings.rules,
    config: settings.config.harvest,
  });
  try {
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
  const view = harvestView({
    plan,
    losses,
    today: iso,
    names: Object.fromEntries(ownerName),
    rules: settings.rules,
    config: settings.config.harvest,
  });
  const reminderDue =
    harvestDueOn(plan, iso, {
      month: settings.config.reminders.harvestMonth,
      day: settings.config.reminders.harvestDay,
    }) === iso;
  const refundsOpen = (refunds ?? []).filter((r) => r.status !== 'received').length;

  return (
    <>
      <PageHead
        title="Tax"
        subtitle="Which funds to sell this year to use each person’s free tax allowance. Worked out from your funds and your old purchases; nothing to type."
        pills={[
          { label: `FY ${plan.fy}`, tone: 'info' },
          {
            label: `${view.daysLeft} days to ${niceDate(plan.deadline)}`,
            // amber once the harvest reminder date chosen in Settings has come
            tone: reminderDue ? 'warn' : 'ok',
          },
          ...(plan.rulesCarriedForward
            ? [{ label: 'last year’s rules assumed', tone: 'warn' as const }]
            : !plan.rulesVerified
              ? [{ label: 'rates not yet verified', tone: 'warn' as const }]
              : []),
        ]}
        actions={
          <>
            <Link className="btn" href="/tax/filing">
              Filing papers
            </Link>
            <Link className="btn ghost" href="/settings#tax">
              Tax rules
            </Link>
          </>
        }
      />

      <Tabs
        base="/tax"
        current={tab}
        tabs={[
          {
            key: 'harvest',
            label: 'What to sell',
            badge: view.people.reduce((a, p) => a + p.sell.length, 0),
          },
          { key: 'refunds', label: 'Refunds', badge: refundsOpen },
          { key: 'more', label: 'How it works' },
        ]}
      />

      {tab === 'harvest' && (
        <>
          {plan.status === 'rules_missing' && (
            <p className="notice warn">
              The tax rules for this year are not entered yet. Add them in{' '}
              <Link href="/settings#tax">Settings</Link>.
            </p>
          )}
          {plan.status === 'ok' && plan.plans.length === 0 && (
            <p className="notice warn">No fund holdings found yet.</p>
          )}
          {view.people.map((pv) => (
            <PersonHarvest key={pv.ownerId} pv={pv} person={styles[pv.ownerId]} />
          ))}
          {view.people.length > 0 && (
            <>
              <Checklist view={view} />
              <CostsNote view={view} />
            </>
          )}
        </>
      )}

      {tab === 'refunds' && (
        <section className="card" id="refunds">
          <h2>Tax refunds to claim</h2>
          <p className="muted small">
            As a non-resident, tax is withheld when funds are sold. Each harvest creates a record
            here by itself. After you sell, enter what was actually withheld (it is on the contract
            note); when you file, mark it claimed; when the money arrives, enter it.{' '}
            <Link href="/tax/refunds/csv">Download as CSV</Link>
          </p>
          {(refunds ?? []).length === 0 ? (
            <p className="empty">
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
            Tax withheld on NRO deposit interest is listed here too. It is refunded in full while
            each person&apos;s total taxable Indian income stays under the limit set in{' '}
            <Link href="/settings#limits">Settings</Link> (
            {formatInr(settings.config.refunds.incomeLimit)}
            {settings.config.refunds.otherIncome > 0
              ? `, with ${formatInr(settings.config.refunds.otherIncome)} of other income counted`
              : ''}
            ). Over the limit the refund depends on the tax actually due, so none is expected until
            you check with an adviser.
          </p>
        </section>
      )}

      {tab === 'more' && (
        <>
          <section className="card">
            <h2>How this is worked out, and its limits</h2>
            <ul className="list small">
              {plan.assumptions.map((a) => (
                <li key={a}>{a}</li>
              ))}
              <li>
                Units bought on a monthly SIP are separate lots, each with its own one-year clock,
                exit-load window and (for ELSS) lock-in. With a fund statement the lots are exact;
                without one they are estimated from the SIP start date and marked so.
              </li>
              <li>
                Units bought before 1 February 2018 use the higher of what was paid and the lower of
                the 31 January 2018 price and the sale price, when that price is available.
              </li>
              <li>
                Only equity-oriented funds are harvested. International, gold and debt funds, and
                hybrids whose equity share is unclear, are left out and named.
              </li>
            </ul>
          </section>
          <details className="card">
            <summary>Try a specific sale (simulator)</summary>
            <TaxSimulator rules={settings.rules} />
          </details>
        </>
      )}
    </>
  );
}
