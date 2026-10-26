import Link from 'next/link';
import {
  afterTaxRate,
  compareHoldings,
  formatInr,
  offerAge,
  personStyles,
  placeNewMoney,
  rankOffers,
  type RateKind,
} from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PersonBadge } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { AddOffer } from './AddOffer';
import { deleteRateOffer } from './actions';

export const dynamic = 'force-dynamic';

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const tenure = (o: { tenureFrom: number; tenureTo: number }) =>
  o.tenureFrom === 0 && o.tenureTo === 0
    ? '–'
    : o.tenureTo && o.tenureTo !== o.tenureFrom
      ? `${o.tenureFrom}–${o.tenureTo} mo`
      : `${o.tenureFrom} mo`;

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [rc, owners] = await Promise.all([
    loadRatesContext(supabase as unknown as SupabaseClient),
    supabase.from('owners').select('id, display_name').order('created_at'),
  ]);
  const todayIso = rc.today.toISOString().slice(0, 10);
  const prefs = rc.config.rates;
  const limit = rc.config.deposits.insuranceLimit;
  const styles = personStyles(
    (owners.data ?? []).map((o) => ({ id: o.id as string, name: o.display_name as string })),
  );
  const stale = rc.offers.filter((o) => offerAge(o, todayIso) > prefs.staleDays).length;
  const newest = rc.offers.reduce<string | null>(
    (m, o) => (!m || o.checkedOn > m ? o.checkedOn : m),
    null,
  );

  const suggestions = compareHoldings(rc.holdings, rc.offers, prefs, todayIso, limit);
  const totalGain = suggestions.reduce((s, x) => s + x.annualGain, 0);

  // new money
  const amount = Number(String(sp.amount ?? '').replace(/[₹,\s]/g, '')) || 0;
  const kind = sp.kind === 'NRO' ? 'NRO' : 'NRE';
  const who = sp.who && styles[sp.who] ? sp.who : (owners.data?.[0]?.id as string | undefined);
  const plan =
    amount > 0 && who
      ? placeNewMoney({
          amount,
          kind,
          ownerId: who,
          joint: sp.joint === 'on',
          tenureMonths: Number(sp.tenure) > 0 ? Number(sp.tenure) : prefs.defaultTenureMonths,
          keepLiquid: Number(String(sp.liquid ?? '').replace(/[₹,\s]/g, '')) || 0,
          holdings: rc.holdings,
          offers: rc.offers,
          prefs,
          limit,
          today: todayIso,
          baselineRate: rc.baselineRate,
        })
      : null;

  // table filters
  const fProduct = sp.product === 'savings' ? 'savings' : 'fd';
  const fKind = (['NRE', 'NRO', 'resident'].includes(sp.fk ?? '') ? sp.fk : 'NRE') as RateKind;
  const fTenure = Number(sp.ft) > 0 ? Number(sp.ft) : prefs.defaultTenureMonths;
  const ranked = rankOffers(
    rc.offers,
    fProduct === 'fd'
      ? { product: 'fd', kind: fKind, tenureMonths: fTenure }
      : { product: 'savings', kind: fKind },
    prefs,
  );
  const banks = [...new Set(rc.holdings.map((h) => h.bank))];

  return (
    <>
      <h1>Rates and where to put money</h1>
      <p className="muted small">
        Compared after tax (NRE interest is not taxed in India; NRO interest is, at the rate in
        Settings). Never more than the insurance limit of ₹{limit.toLocaleString('en-IN')} per
        person per bank. A running deposit is never suggested to be broken early; moves are for
        maturity.
      </p>
      <div className="card summary">
        <span>
          Rates on file <b className="num">{rc.offers.length}</b>
        </span>
        <span>
          Newest check <b>{newest ?? 'none yet'}</b>
        </span>
        {stale > 0 && (
          <span className="warnText">
            {stale} older than {prefs.staleDays} days
          </span>
        )}
        <Link href="/settings#rates">Bank rate pages and limits</Link>
      </div>
      {rc.offers.length === 0 && (
        <p className="notice warn">
          No rates yet. Add a few below, or list your banks&apos; rate pages in{' '}
          <Link href="/settings#rates">Settings</Link> and the weekly refresh reads them for you
          (needs your AI key).
        </p>
      )}

      <section className="card" aria-labelledby="sug">
        <h2 id="sug">Your money against the market</h2>
        {suggestions.length === 0 ? (
          <p className="muted">
            {rc.offers.length === 0
              ? 'Add rates to compare.'
              : 'Nothing worth moving right now: no account is earning clearly less than a better offer with insurance room.'}
          </p>
        ) : (
          <>
            <p>
              If you act on all of these: about <strong>{formatInr(Math.round(totalGain))}</strong>{' '}
              more interest a year.
            </p>
            <ul className="list nobullet actions">
              {suggestions.map((x) => (
                <li key={x.assetId} className="action info">
                  <div
                    style={{ padding: '10px 12px', background: 'var(--soft)', borderRadius: 10 }}
                  >
                    <div className="row" style={{ justifyContent: 'space-between' }}>
                      <strong>
                        {x.from} → {x.to}
                      </strong>
                      <span className="gain num">
                        +{formatInr(Math.round(x.annualGain))} a year
                      </span>
                    </div>
                    <div className="small">{x.text}</div>
                    {x.offerAgeDays > prefs.staleDays && (
                      <div className="small warnText">
                        This rate was checked {x.offerAgeDays} days ago; confirm it first.
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card" aria-labelledby="nm">
        <h2 id="nm">I have new money: where should it go?</h2>
        <form method="get" className="form" action="/rates">
          <div className="formgrid g4">
            <label>
              Amount (₹)
              <input
                name="amount"
                inputMode="numeric"
                defaultValue={sp.amount ?? ''}
                placeholder="e.g. 2500000"
              />
            </label>
            <label>
              Account type
              <select name="kind" defaultValue={kind}>
                <option value="NRE">NRE</option>
                <option value="NRO">NRO</option>
              </select>
            </label>
            <label>
              Whose money
              <select name="who" defaultValue={who}>
                {(owners.data ?? []).map((o) => (
                  <option key={o.id as string} value={o.id as string}>
                    {o.display_name as string}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Tenure (months)
              <input
                name="tenure"
                inputMode="numeric"
                defaultValue={sp.tenure ?? prefs.defaultTenureMonths}
              />
            </label>
            <label>
              Keep liquid in savings (₹)
              <input
                name="liquid"
                inputMode="numeric"
                defaultValue={sp.liquid ?? ''}
                placeholder="0"
              />
            </label>
            <label className="check">
              <input type="checkbox" name="joint" defaultChecked={sp.joint === 'on'} /> In a joint
              account (its own insurance allowance)
            </label>
          </div>
          <div>
            <button className="btn primary">Suggest</button>
          </div>
        </form>
        {plan && (
          <>
            {plan.placements.length > 0 && (
              <div className="xlwrap">
                <table className="xl">
                  <thead>
                    <tr>
                      <th>Bank</th>
                      <th>Where</th>
                      <th className="num">Rate</th>
                      <th className="num">After tax</th>
                      <th className="num">Put</th>
                      <th className="num">Interest a year</th>
                      <th>Room left at that bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {plan.placements.map((p, i) => (
                      <tr key={i} className="xlrow">
                        <td>
                          <strong>{p.bank}</strong>
                          {p.conditions && <div className="small muted">{p.conditions}</div>}
                        </td>
                        <td>
                          {p.kind} {p.product === 'fd' ? 'fixed deposit' : 'savings'} ·{' '}
                          {p.tenureNote}
                          {p.offerAgeDays > prefs.staleDays && (
                            <div className="small warnText">
                              rate checked {p.offerAgeDays} days ago
                            </div>
                          )}
                        </td>
                        <td className="num">{pct(p.rate)}</td>
                        <td className="num">{pct(p.net)}</td>
                        <td className="num cur">{formatInr(Math.round(p.amount))}</td>
                        <td className="num">{formatInr(Math.round(p.annualInterest))}</td>
                        <td className="muted">{formatInr(Math.round(p.headroomLeft))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="small">
              Together about <strong>{formatInr(Math.round(plan.totalAnnual))}</strong> a year after
              tax, against {formatInr(Math.round(plan.baselineAnnual))} if the same money sat in
              savings at the usual rate:{' '}
              <strong className="gain">{formatInr(Math.round(plan.uplift))} more</strong>.
            </p>
            {plan.notes.map((n) => (
              <p key={n} className="notice warn small">
                {n}
              </p>
            ))}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="best">
        <h2 id="best">Best rates on file</h2>
        <nav className="chipbar small" aria-label="Filter rates">
          {(['fd', 'savings'] as const).map((p) => (
            <Link
              key={p}
              className={`fchip ${fProduct === p ? 'on' : ''}`}
              href={`/rates?product=${p}&fk=${fKind}&ft=${fTenure}`}
            >
              {p === 'fd' ? 'Fixed deposits' : 'Savings'}
            </Link>
          ))}
          {(['NRE', 'NRO', 'resident'] as const).map((k) => (
            <Link
              key={k}
              className={`fchip ${fKind === k ? 'on' : ''}`}
              href={`/rates?product=${fProduct}&fk=${k}&ft=${fTenure}`}
            >
              {k === 'resident' ? 'Resident' : k}
            </Link>
          ))}
        </nav>
        {ranked.length === 0 ? (
          <p className="muted">No matching rates on file.</p>
        ) : (
          <div className="xlwrap">
            <table className="xl">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th>Term</th>
                  <th className="num">Rate</th>
                  <th className="num">After tax</th>
                  <th>Conditions</th>
                  <th>Checked</th>
                  <th>Source</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((o) => {
                  const age = offerAge(o, todayIso);
                  return (
                    <tr key={o.id} className="xlrow">
                      <td>
                        <strong>{o.bank}</strong>
                        {rc.holdings.some((h) =>
                          h.bank.toLowerCase().includes(o.bank.toLowerCase().split(' ')[0]!),
                        ) && <span className="chip tiny"> you bank here</span>}
                      </td>
                      <td>{tenure(o)}</td>
                      <td className="num">{pct(o.rate)}</td>
                      <td className="num cur">
                        {pct(
                          afterTaxRate(
                            o.rate,
                            fKind === 'resident' ? null : fKind,
                            prefs.nroTaxRate,
                          ),
                        )}
                      </td>
                      <td className="notes">{o.conditions ?? ''}</td>
                      <td className={age > prefs.staleDays ? 'warnText' : ''}>
                        {age === 0 ? 'today' : `${age} days ago`}
                      </td>
                      <td className="muted">
                        {o.sourceKind === 'ai' ? 'read from the bank page' : 'typed by you'}
                      </td>
                      <td>
                        <form action={deleteRateOffer}>
                          <input type="hidden" name="id" value={o.id} />
                          <button className="linkbtn" aria-label={`Remove the ${o.bank} rate`}>
                            Remove
                          </button>
                        </form>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="add">
        <h2 id="add">Add or correct a rate</h2>
        <p className="muted small">
          A rate you type is never overwritten by the automatic refresh. Savings rates need no
          tenure.
        </p>
        <AddOffer banks={banks} />
      </section>

      <section className="card">
        <h2>Who holds what today</h2>
        <p className="muted small">
          Used for the insurance limit: each person&apos;s balance and deposits at each bank,
          including interest.
        </p>
        <table className="tbl lines">
          <tbody>
            {Object.entries(
              rc.holdings.reduce<Record<string, number>>((m, h) => {
                if (!h.needsConfirmation)
                  m[`${h.ownerId}|${h.bank}`] = (m[`${h.ownerId}|${h.bank}`] ?? 0) + h.current;
                return m;
              }, {}),
            )
              .sort((a, b) => b[1] - a[1])
              .slice(0, 40)
              .map(([k, v]) => {
                const [oid, bank] = k.split('|');
                return (
                  <tr key={k}>
                    <td>
                      <PersonBadge p={styles[oid!]} name />
                    </td>
                    <td>{bank}</td>
                    <td className="num">{formatInr(Math.round(v))}</td>
                    <td className={`num ${v > limit ? 'fail' : 'muted'}`}>
                      {v > limit
                        ? `${formatInr(Math.round(v - limit))} above the limit`
                        : `${formatInr(Math.round(limit - v))} room`}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>
    </>
  );
}
