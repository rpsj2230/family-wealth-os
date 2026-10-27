import Link from 'next/link';
import { redirect } from 'next/navigation';
import {
  afterTaxRate,
  buildBoardCards,
  canonicalBanks,
  niceDay,
  offerAge,
  parseSort,
  parseView,
  ratePct,
  rankOffers,
  sameBank,
  slabText,
  tenureText,
  type RateKind,
} from '@fwos/core';
import { loadRatesContext } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { Why } from '@/components/Why';
import { ratesExplain } from '@/lib/explain-rates';
import { loadContext } from '@/lib/data';
import { loadBoardOffers, loadRateEvents, loadRateSources } from '@/lib/rates-view';
import { plannerRedirect } from '@/lib/rates-redirect';
import { slugify } from '@/lib/slug';
import { AddOffer } from './AddOffer';
import { BoardToolbar, RateBoard } from './Board';
import { ImportNotes } from './ImportNotes';

export const dynamic = 'force-dynamic';

/** The notes the family keeps today; offered by a button so one click loads them, never pre-filled. */
const NOTES_EXAMPLE = `JanaBank - Saving [2.5%-1Lk, 3.50% - 1Lk to 5Lk, 4.50% - 5Lk to 10 lk, 6.75% - 10lk to 50 lk, 7% - above 50 lk], NRE FD[8% -2 Yr]
Equitas - Saving [2.5%-3Lk, 5% > 3Lk to 5Lk, 6.00% 5-10lk, 6.50% -above 10lk], NRE FD[8.0% -3 Yrs]
ESAF - Saving [2.5%-1Lk, 3.00% - 1Lk to 2Lk, 5% - 2Lk to 5lk], NRE FD[8% -800 days (2.2 Yrs)]
AU Bank - Saving [2.5%-3Lk, 2.75% - 3Lk to 5Lk, 3.50% - 5Lk to 10 lk], NRE FD[7.40% -2.5 yrs]
YesBank - Saving [2.5%-1Lk, 2.5% > 1 lk to 25Lk], NRE FD[7.25% -1.5Yrs]
RBL - Saving [3.00%-5Lk, 5% - 5lk to 10lk, 6% - above 10lk], NRE FD[7.20% -1.5 yrs]
IDFC - Saving [2.5%-3Lk, 7% > 3Lk to 25 Lk, 6.25% >25lk], NRE FD[7.10% - 500 days (1.5 Yrs)]
IndusInd - Saving [2.5%-1Lk, 3% > 25Lk], NRE FD[7.00% -2Yr]
HDFC - Saving [3%-50Lk], NRE FD[6.5% - 3Yrs]`;

const TABS = ['banks', 'best', 'add'] as const;
type Tab = (typeof TABS)[number];
export default async function RatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const moved = plannerRedirect(sp);
  if (moved) redirect(moved);
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const db = supabase as unknown as SupabaseClient;
  const [rc, offers, events, sources] = await Promise.all([
    loadRatesContext(db),
    loadBoardOffers(supabase),
    loadRateEvents(supabase),
    loadRateSources(supabase),
  ]);
  const today = rc.today.toISOString().slice(0, 10);
  const prefs = rc.config.rates;
  const wantsBest = sp.product !== undefined || sp.fk !== undefined || sp.ft !== undefined;
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as Tab)
    : wantsBest
      ? 'best'
      : 'banks';

  const view = parseView(sp.view);
  const sort = parseSort(sp.sort);
  const everyCard = buildBoardCards({
    offers,
    events,
    holdings: rc.holdings,
    sources,
    today,
    staleDays: prefs.staleDays,
    view: 'all',
    sort,
  });
  const cards = view === 'all' ? everyCard : everyCard.filter((c) => c.holds);
  const stale = offers.filter((o) => offerAge(o, today) > prefs.staleDays).length;
  const newest = offers.reduce<string | null>(
    (m, o) => (!m || o.checkedOn > m ? o.checkedOn : m),
    null,
  );
  const unreadable = everyCard.filter((c) => c.holds && c.source.health === 'bad');
  const differs = everyCard.reduce((s, c) => s + c.differs, 0);
  const needLook = cards.filter(
    (c) => c.differs > 0 || c.misread > 0 || c.source.health === 'bad',
  ).length;
  const bestFd = cards.reduce<(typeof cards)[number] | null>(
    (m, c) => (c.bestFd && (!m || c.bestFd.rate > m.bestFd!.rate) ? c : m),
    null,
  );
  const bestSav = cards.reduce<(typeof cards)[number] | null>(
    (m, c) => (c.bestSaving && (!m || c.bestSaving.rate > m.bestSaving!.rate) ? c : m),
    null,
  );
  const bankNames = canonicalBanks([
    ...rc.holdings.map((h) => h.bank),
    ...offers.map((o) => o.bank),
  ]);

  // "Compare" tab: the best offer of each bank for one product, account type and term
  const fProduct = sp.product === 'savings' ? 'savings' : 'fd';
  const fKind = (['NRE', 'NRO', 'resident'].includes(sp.fk ?? '') ? sp.fk : 'NRE') as RateKind;
  const fTenure = Number(sp.ft) > 0 ? Number(sp.ft) : prefs.defaultTenureMonths;
  const ranked =
    tab === 'best'
      ? rankOffers(
          offers,
          fProduct === 'fd'
            ? { product: 'fd', kind: fKind, tenureMonths: fTenure }
            : { product: 'savings', kind: fKind },
          prefs,
        )
      : [];
  const held = (bank: string) =>
    rc.holdings.some((h) => !h.needsConfirmation && sameBank(h.bank, bank));

  const ex = ratesExplain({
    offers,
    today,
    staleDays: prefs.staleDays,
    unreadable: unreadable.length,
    banks: everyCard.length,
    sample: false,
  });

  return (
    <>
      <PageHead
        title="Rates"
        subtitle="What each bank pays, where every figure came from and when it was last checked. Deciding where to put money against these rates is on New money."
        pills={[
          { label: `${offers.length} rates on file`, tone: 'info', why: ex['rates.freshness'] },
          ...(newest ? [{ label: `newest check ${niceDay(newest)}` }] : []),
          ...(stale > 0
            ? [{ label: `${stale} older than ${prefs.staleDays} days`, tone: 'warn' as const }]
            : []),
          ...(unreadable.length > 0
            ? [
                {
                  label: `${unreadable.length} bank page${unreadable.length === 1 ? '' : 's'} not read`,
                  tone: 'bad' as const,
                },
              ]
            : []),
        ]}
        actions={
          <>
            <Link className="btn primary" href="/rates?tab=add">
              Add or import rates
            </Link>
            <Link className="btn" href="/new-money">
              New money
            </Link>
            <Link className="btn ghost" href="/settings#rates">
              Rate pages and limits
            </Link>
          </>
        }
      />

      <section className="kpis" aria-label="Rates at a glance">
        <article className="kpi main">
          <div className="kpi-label">
            Best NRE deposit, banks shown
            <Why explain={ex['rates.best']} />
          </div>
          <div className="kpi-value">{bestFd ? ratePct(bestFd.bestFd!.rate) : '–'}</div>
          <div className="kpi-sub muted">
            {bestFd ? `${bestFd.bank}, ${tenureText(bestFd.bestFd!)}` : 'no deposit rate on file'}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">
            Best savings
            <Why explain={ex['rates.best']} />
          </div>
          <div className="kpi-value">{bestSav ? ratePct(bestSav.bestSaving!.rate) : '–'}</div>
          <div className="kpi-sub muted">
            {bestSav
              ? `${bestSav.bank}${slabText(bestSav.bestSaving!) ? `, ${slabText(bestSav.bestSaving!)}` : ''}`
              : 'no savings rate on file'}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">
            Needs a look
            <Why explain={ex['rates.freshness']} />
          </div>
          <div className="kpi-value">{needLook}</div>
          <div className="kpi-sub muted">
            {differs > 0
              ? `${differs} rate${differs === 1 ? '' : 's'} differ from the bank page`
              : 'banks with a difference or an unread page'}
          </div>
        </article>
      </section>

      <Tabs
        base="/rates"
        current={tab}
        tabs={[
          { key: 'banks', label: 'Banks', badge: cards.length },
          { key: 'best', label: 'Best rates' },
          { key: 'add', label: 'Add or import' },
        ]}
      />

      {tab === 'banks' && (
        <>
          {unreadable.length > 0 && (
            <div className="rt-note bad" role="alert" style={{ marginBottom: 14 }}>
              <p>
                <b>
                  The weekly refresh could not read {unreadable.length} bank page
                  {unreadable.length === 1 ? '' : 's'}:
                </b>{' '}
                {unreadable.map((c, i) => (
                  <span key={c.bank}>
                    {i > 0 ? ', ' : ''}
                    <Link href={`/rates/${slugify(c.bank)}?tab=reading`}>{c.bank}</Link>
                  </span>
                ))}
                . Each bank&apos;s card says why and what to do. Rates already on file are
                unchanged.
              </p>
            </div>
          )}
          <BoardToolbar base="/rates" view={view} sort={sort} />
          <RateBoard cards={cards} staleDays={prefs.staleDays} base="/rates" />
        </>
      )}

      {tab === 'best' && (
        <section className="card" aria-labelledby="best-h">
          <h2 id="best-h">Best rate at each bank</h2>
          <p className="muted small">
            One row per bank, highest first. NRO interest is shown after Indian tax at the rate in
            Settings; NRE interest is not taxed in India.
          </p>
          <nav className="chipbar small" aria-label="Choose the rates to compare">
            {(['fd', 'savings'] as const).map((p) => (
              <Link
                key={p}
                className={`fchip ${fProduct === p ? 'on' : ''}`}
                href={`/rates?tab=best&product=${p}&fk=${fKind}&ft=${fTenure}`}
              >
                {p === 'fd' ? 'Fixed deposits' : 'Savings'}
              </Link>
            ))}
            {(['NRE', 'NRO', 'resident'] as const).map((k) => (
              <Link
                key={k}
                className={`fchip ${fKind === k ? 'on' : ''}`}
                href={`/rates?tab=best&product=${fProduct}&fk=${k}&ft=${fTenure}`}
              >
                {k === 'resident' ? 'Resident' : k}
              </Link>
            ))}
            {fProduct === 'fd' && (
              <form
                method="get"
                action="/rates"
                className="row"
                style={{ gap: 6, alignItems: 'center' }}
              >
                <input type="hidden" name="tab" value="best" />
                <input type="hidden" name="product" value="fd" />
                <input type="hidden" name="fk" value={fKind} />
                <label className="small muted" htmlFor="ft">
                  Term in months
                </label>
                <input
                  id="ft"
                  name="ft"
                  inputMode="numeric"
                  defaultValue={fTenure}
                  style={{ width: 72, minHeight: 36 }}
                />
                <button className="btn compact">Show</button>
              </form>
            )}
          </nav>
          {ranked.length === 0 ? (
            <p className="empty">No matching rates on file. Try another account type or term.</p>
          ) : (
            <ListingTools name="best-rates">
              <table className="tbl lines responsive">
                <thead>
                  <tr>
                    <th>Bank</th>
                    <th>{fProduct === 'savings' ? 'Balance' : 'Term'}</th>
                    <th className="num">Rate</th>
                    <th className="num">After tax</th>
                    <th>Checked</th>
                    <th>Where from</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map((o) => {
                    const age = offerAge(o, today);
                    return (
                      <tr key={o.id}>
                        <td data-label="Bank">
                          <Link href={`/rates/${slugify(o.bank)}`}>
                            <strong>{o.bank}</strong>
                          </Link>
                          {held(o.bank) && <span className="chip tiny"> you bank here</span>}
                          {o.conditions && <div className="small muted">{o.conditions}</div>}
                        </td>
                        <td data-label={fProduct === 'savings' ? 'Balance' : 'Term'}>
                          {fProduct === 'savings' ? (slabText(o) ?? 'any balance') : tenureText(o)}
                        </td>
                        <td className="num" data-label="Rate">
                          {ratePct(o.rate)}
                        </td>
                        <td className="num" data-label="After tax">
                          <b>
                            {ratePct(
                              afterTaxRate(
                                o.rate,
                                fKind === 'resident' ? null : fKind,
                                prefs.nroTaxRate,
                              ),
                            )}
                          </b>
                        </td>
                        <td
                          data-label="Checked"
                          className={age > prefs.staleDays ? 'warnText' : ''}
                        >
                          {niceDay(o.checkedOn)}
                        </td>
                        <td data-label="Where from">
                          <span className={`srcchip ${o.sourceKind === 'ai' ? 'auto' : 'manual'}`}>
                            {o.sourceKind === 'ai' ? 'Bank page' : 'You'}
                          </span>{' '}
                          <span className="small muted">
                            {o.sourceNote ??
                              (o.sourceKind === 'ai' ? 'Read from the bank page' : 'Typed by you')}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ListingTools>
          )}
          <p className="small muted">
            To choose where a sum should go, with the insurance limit applied, use{' '}
            <Link href="/new-money">New money</Link>.
          </p>
        </section>
      )}

      {tab === 'add' && (
        <>
          <section className="card" aria-labelledby="paste-h">
            <h2 id="paste-h">Paste your notes</h2>
            <p className="muted small">
              Paste your list as you keep it and the app reads the slabs and terms. Every figure is
              marked as typed by you. The Monday refresh keeps banks that have a rate page up to
              date, for savings and NRE deposits only, and never overwrites a rate you typed.
            </p>
            <ImportNotes example={NOTES_EXAMPLE} />
          </section>
          <section className="card" aria-labelledby="one-h">
            <h2 id="one-h">Add or correct one rate</h2>
            <AddOffer banks={bankNames} />
          </section>
          <p className="small muted">
            Want rates to arrive by themselves? List each bank&apos;s rate page under{' '}
            <Link href="/settings#rates">Settings, Rate pages</Link>. Each bank&apos;s page on this
            site says whether it was read and why not.
          </p>
        </>
      )}
    </>
  );
}
