import { ListingTools } from '@/components/ListingTools';
import Link from 'next/link';
import {
  afterTaxRate,
  compareHoldings,
  formatInr,
  offerAge,
  personStyles,
  placeNewMoney,
  rankOffers,
  sameBank,
  slabText,
  tenureText,
  type RateKind,
  type RateOffer,
} from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PersonBadge } from '@/components/Person';
import { loadContext } from '@/lib/data';
import { AddOffer } from './AddOffer';
import { ImportNotes } from './ImportNotes';
import { deleteRateOffer } from './actions';

export const dynamic = 'force-dynamic';

const pct = (r: number) => `${(r * 100).toFixed(2)}%`;
const tenure = tenureText;
const fmtShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** The notes the family keeps today; offered as the starting text of the paste box so one click loads them. */
const NOTES_EXAMPLE = `JanaBank - Saving [2.5%-1Lk, 3.50% - 1Lk to 5Lk, 4.50% - 5Lk to 10 lk, 6.75% - 10lk to 50 lk, 7% - above 50 lk], NRE FD[8% -2 Yr]
Equitas - Saving [2.5%-3Lk, 5% > 3Lk to 5Lk, 6.00% 5-10lk, 6.50% -above 10lk], NRE FD[8.0% -3 Yrs]
ESAF - Saving [2.5%-1Lk, 3.00% - 1Lk to 2Lk, 5% - 2Lk to 5lk], NRE FD[8% -800 days (2.2 Yrs)]
AU Bank - Saving [2.5%-3Lk, 2.75% - 3Lk to 5Lk, 3.50% - 5Lk to 10 lk], NRE FD[7.40% -2.5 yrs]
YesBank - Saving [2.5%-1Lk, 2.5% > 1 lk to 25Lk], NRE FD[7.25% -1.5Yrs]
RBL - Saving [3.00%-5Lk, 5% - 5lk to 10lk, 6% - above 10lk], NRE FD[7.20% -1.5 yrs]
IDFC - Saving [2.5%-3Lk, 7% > 3Lk to 25 Lk, 6.25% >25lk], NRE FD[7.10% - 500 days (1.5 Yrs)]
IndusInd - Saving [2.5%-1Lk, 3% > 25Lk], NRE FD[7.00% -2Yr]
HDFC - Saving [3%-50Lk], NRE FD[6.5% - 3Yrs]`;

export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [rc, owners, sources] = await Promise.all([
    loadRatesContext(supabase as unknown as SupabaseClient),
    supabase.from('owners').select('id, display_name').order('created_at'),
    supabase.from('rate_sources').select('bank, url, enabled, last_run_on, last_result'),
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
          jointHolderId:
            sp.joint === 'on' && sp.with && styles[sp.with] && sp.with !== who ? sp.with : null,
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

  // ---- the rate board: one row per bank, with its savings slabs and its best NRE deposit
  const view = sp.view === 'all' ? 'all' : 'held';
  const sortBy = ['saving', 'fd', 'name', 'old'].includes(sp.sort ?? '')
    ? (sp.sort as string)
    : 'fd';
  const boardBanks: string[] = [...banks];
  for (const o of rc.offers)
    if (!boardBanks.some((b) => sameBank(b, o.bank))) boardBanks.push(o.bank);
  const heldAt = (b: string) =>
    rc.holdings
      .filter((h) => !h.needsConfirmation && sameBank(h.bank, b))
      .reduce((t, h) => t + h.current, 0);
  const board = boardBanks
    .map((bank) => {
      const mine = rc.offers.filter((o) => sameBank(o.bank, bank));
      const sav = mine
        .filter((o) => o.product === 'savings')
        .sort((a, b) => (a.balanceFrom ?? 0) - (b.balanceFrom ?? 0));
      const fds = mine.filter(
        (o) => o.product === 'fd' && o.accountKind !== 'NRO' && o.accountKind !== 'resident',
      );
      const bestFd = fds.reduce<RateOffer | null>((m, o) => (!m || o.rate > m.rate ? o : m), null);
      const bestSav = sav.reduce<RateOffer | null>((m, o) => (!m || o.rate > m.rate ? o : m), null);
      const newest = mine.reduce<string | null>(
        (m, o) => (!m || o.checkedOn > m ? o.checkedOn : m),
        null,
      );
      const src = (sources.data ?? []).find((x) => sameBank(x.bank as string, bank));
      return {
        bank,
        held: heldAt(bank),
        holds: banks.some((b) => sameBank(b, bank)),
        sav,
        bestSav,
        bestFd,
        newest,
        origins: (() => {
          const m = new Map<
            string,
            { kind: 'manual' | 'ai'; note: string; url: string | null; on: string; count: number }
          >();
          for (const o of mine) {
            const note =
              o.sourceNote ?? (o.sourceKind === 'ai' ? 'Read from the bank page' : 'Typed by you');
            const k = `${o.sourceKind}|${note}|${o.sourceUrl ?? ''}`;
            const cur = m.get(k);
            if (cur) {
              cur.count++;
              if (o.checkedOn > cur.on) cur.on = o.checkedOn;
            } else
              m.set(k, {
                kind: o.sourceKind,
                note,
                url: o.sourceUrl ?? null,
                on: o.checkedOn,
                count: 1,
              });
          }
          return [...m.values()].sort((a, b) => b.on.localeCompare(a.on));
        })(),
        src: src
          ? {
              ran: (src.last_run_on as string | null) ?? null,
              result: (src.last_result as string | null) ?? null,
              enabled: !!src.enabled,
            }
          : null,
      };
    })
    .filter((r) => view === 'all' || r.holds)
    .sort((a, b) =>
      sortBy === 'name'
        ? a.bank.localeCompare(b.bank)
        : sortBy === 'saving'
          ? (b.bestSav?.rate ?? -1) - (a.bestSav?.rate ?? -1)
          : sortBy === 'old'
            ? (a.newest ?? '').localeCompare(b.newest ?? '')
            : (b.bestFd?.rate ?? -1) - (a.bestFd?.rate ?? -1),
    );
  const boardHref = (o: { view?: string; sort?: string }) =>
    `/rates?view=${o.view ?? view}&sort=${o.sort ?? sortBy}`;

  return (
    <>
      <h1>Rates and where to put money</h1>
      <ListingTools name="rates">
        <p className="muted small">
          Compared after tax (NRE interest is not taxed in India; NRO interest is, at the rate in
          Settings). Never more than the insurance limit of ₹{limit.toLocaleString('en-IN')} per
          person per bank. A running deposit is never suggested to be broken early; moves are for
          maturity.
        </p>
        {(sources.data ?? []).some((x) =>
          String(x.last_result ?? '').startsWith('Not read: no AI key'),
        ) && (
          <p className="notice warn" role="alert">
            The weekly refresh ran but could not read any bank page, because no AI key is saved. Add
            a free Groq or Gemini key in{' '}
            <Link href="/settings#email">Settings, Bank emails and AI</Link>, then run
            &ldquo;Refresh interest rates&rdquo; again from GitHub &gt; Actions. Until then, load
            rates from your notes below.
          </p>
        )}
        <section className="card" aria-labelledby="board">
          <h2 id="board">Rate board</h2>
          <p className="muted small">
            Savings rates by balance slab and the best NRE fixed deposit, for the banks you use.
            Each row says when it was last checked and how. Click a heading to sort, or use the
            shortcuts.
          </p>
          <nav className="chipbar small" aria-label="Rate board options">
            <Link
              className={`fchip ${view === 'held' ? 'on' : ''}`}
              href={boardHref({ view: 'held' })}
            >
              Banks I use
            </Link>
            <Link
              className={`fchip ${view === 'all' ? 'on' : ''}`}
              href={boardHref({ view: 'all' })}
            >
              All banks on file
            </Link>
            <span className="muted">Sort:</span>
            {(
              [
                ['fd', 'Highest FD'],
                ['saving', 'Highest savings'],
                ['name', 'Bank name'],
                ['old', 'Oldest check first'],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={k}
                className={`fchip ${sortBy === k ? 'on' : ''}`}
                href={boardHref({ sort: k })}
              >
                {label}
              </Link>
            ))}
          </nav>
          <div className="xlwrap">
            <table className="xl rateboard">
              <thead>
                <tr>
                  <th>Bank</th>
                  <th className="num">You hold</th>
                  <th className="num">Savings, best</th>
                  <th>Savings by balance</th>
                  <th className="num">NRE FD, best</th>
                  <th>FD term</th>
                  <th>Where the rates came from</th>
                </tr>
              </thead>
              <tbody>
                {board.map((r) => {
                  const age = r.newest
                    ? offerAge({ checkedOn: r.newest } as RateOffer, todayIso)
                    : null;
                  return (
                    <tr key={r.bank} className="xlrow">
                      <td>
                        <strong>{r.bank}</strong>
                      </td>
                      <td className="num">{r.held > 0 ? formatInr(Math.round(r.held)) : '–'}</td>
                      <td className="num cur">{r.bestSav ? pct(r.bestSav.rate) : '–'}</td>
                      <td>
                        {r.sav.length === 0 ? (
                          <span className="muted small">no savings rate yet</span>
                        ) : (
                          <ul className="slabs">
                            {r.sav.map((o) => (
                              <li key={o.id}>
                                <b className="num">{pct(o.rate)}</b>{' '}
                                <span className="muted small">{slabText(o) ?? 'any balance'}</span>
                                {o.accountKind !== 'any' && (
                                  <span className="chip tiny"> {o.accountKind}</span>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                      <td className="num cur">{r.bestFd ? pct(r.bestFd.rate) : '–'}</td>
                      <td>{r.bestFd ? tenure(r.bestFd) : ''}</td>
                      <td className="small">
                        {r.origins.length === 0 && <span className="muted">no rates yet</span>}
                        {r.origins.map((o) => (
                          <div key={`${o.kind}${o.note}${o.url}`} className="origin">
                            <span className={`srcchip ${o.kind === 'ai' ? 'auto' : 'manual'}`}>
                              {o.kind === 'ai' ? 'Bank page' : 'You'}
                            </span>{' '}
                            {o.url ? (
                              <a href={o.url} target="_blank" rel="noreferrer">
                                {o.note}
                              </a>
                            ) : (
                              o.note
                            )}
                            <span
                              className={
                                age !== null && age > prefs.staleDays ? 'warnText' : 'muted'
                              }
                            >
                              {' '}
                              · {fmtShort(o.on)} ({o.count} rate{o.count === 1 ? '' : 's'})
                            </span>
                          </div>
                        ))}
                        {r.src ? (
                          <div className="muted">
                            Rate page: {r.src.result ? r.src.result : 'added, not read yet'}
                          </div>
                        ) : (
                          <div className="muted">
                            No rate page for this bank: <Link href="/settings#rates">add one</Link>{' '}
                            to refresh automatically
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {board.length === 0 && (
            <p className="muted">No rates on file for your banks yet. Paste them below.</p>
          )}
        </section>

        <section className="card" aria-labelledby="paste">
          <h2 id="paste">Load or update rates from your notes</h2>
          <p className="muted small">
            Paste your list as you keep it today; the app reads the slabs and terms. The weekly
            refresh then keeps the banks that have a rate page up to date, for savings (NRE and NRO)
            and NRE deposits only.
          </p>
          <ImportNotes example={NOTES_EXAMPLE} />
        </section>

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
                If you act on all of these: about{' '}
                <strong>{formatInr(Math.round(totalGain))}</strong> more interest a year.
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
                account (each name, in its order, has its own insurance allowance)
              </label>
              <label>
                Joint with (second name)
                <select name="with" defaultValue={sp.with ?? ''}>
                  <option value="">Not recorded</option>
                  {(owners.data ?? []).map((o) => (
                    <option key={o.id as string} value={o.id as string}>
                      {o.display_name as string}
                    </option>
                  ))}
                </select>
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
                Together about <strong>{formatInr(Math.round(plan.totalAnnual))}</strong> a year
                after tax, against {formatInr(Math.round(plan.baselineAnnual))} if the same money
                sat in savings at the usual rate:{' '}
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
                        <td>
                          {fProduct === 'savings' ? (slabText(o) ?? 'any balance') : tenure(o)}
                        </td>
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
      </ListingTools>
    </>
  );
}
