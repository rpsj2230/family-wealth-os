import Link from 'next/link';
import {
  rateAgoText,
  bankSummary,
  formatInr,
  moveText,
  niceDay,
  pageDifferences,
  pendingCorrections,
  ratePct,
  tenureText,
  topRateHistory,
  type BoardOffer,
  type RateEventRow,
  type SourceStatus,
} from '@fwos/core';
import { BankBadge } from '@/components/BankBadge';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import type { RateHint } from '@/lib/rates-view';
import { AddHint } from './AddHint';
import { AddOffer } from './AddOffer';
import { HistoryChart } from './HistoryChart';
import { HintList, LogTable, SourcePanel, rateSections, rowModel } from './Parts';
import { RateRows, type RateRowActions } from './RateRows';
import './rates.css';

export const BANK_TABS = ['rates', 'history', 'reading'] as const;
export type BankTab = (typeof BANK_TABS)[number];
export const parseBankTab = (s: string | undefined): BankTab =>
  (BANK_TABS as readonly string[]).includes(s ?? '') ? (s as BankTab) : 'rates';

/**
 * One bank's rates: edit them in place, see what moved and why, and see how the weekly refresh reads the bank's page.
 * Used by the signed-in page and by the public sample (which passes no actions, so nothing is stored).
 */
export function BankView({
  bank,
  offers,
  events,
  hints,
  source,
  today,
  staleDays,
  tab,
  base,
  backHref,
  newMoneyHref,
  held,
  actions,
  toggleHint,
  syncHref = '/rates/sync',
}: {
  bank: string;
  offers: BoardOffer[];
  /** this bank's log, newest first */
  events: RateEventRow[];
  hints: RateHint[];
  source: SourceStatus;
  today: string;
  staleDays: number;
  tab: BankTab;
  base: string;
  backHref: string;
  newMoneyHref: string;
  held: number;
  actions?: RateRowActions | undefined;
  toggleHint?: ((f: FormData) => Promise<void>) | undefined;
  /** the Sync bank rates page (the public sample has its own) */
  syncHref?: string;
}) {
  const sum = bankSummary(offers, events, bank);
  const diffs = pageDifferences(offers);
  const pending = pendingCorrections(offers);
  const move = moveText(sum.lastMove);
  const history = topRateHistory(events, bank);
  const age = sum.checkedOn
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${sum.checkedOn}T00:00:00Z`)) /
            86_400_000,
        ),
      )
    : null;
  const needsLook = source.health === 'bad' || source.health === 'warn' ? 1 : 0;
  const sections = rateSections(offers);

  return (
    <>
      <p
        className="small"
        style={{ margin: '0 0 8px', display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <BankBadge name={bank} size={24} />
        <Link href={backHref}>← All banks</Link>
      </p>
      <PageHead
        title={bank}
        subtitle={
          held > 0
            ? `You hold ${formatInr(Math.round(held))} here. Change a rate, and the old and new figures are logged.`
            : 'Change a rate, and the old and new figures are logged. Rates you type are never overwritten by the refresh.'
        }
        pills={[
          ...(age === null
            ? [{ label: 'no rate on file', tone: 'warn' as const }]
            : [
                {
                  label: `checked ${rateAgoText(age)}`,
                  tone: age > staleDays ? ('warn' as const) : ('ok' as const),
                },
              ]),
          ...(diffs.length > 0
            ? [{ label: `${diffs.length} differ from the page`, tone: 'warn' as const }]
            : []),
          ...(source.health === 'bad'
            ? [{ label: 'refresh could not read the page', tone: 'bad' as const }]
            : []),
        ]}
        actions={
          <>
            <a className="btn primary" href="#add">
              Add a rate
            </a>
            <Link className="btn" href={syncHref}>
              Sync rates
            </Link>
            <Link className="btn ghost" href={`${backHref}?tab=add`}>
              Paste from notes
            </Link>
          </>
        }
      />

      <section className="kpis" aria-label="This bank at a glance">
        <article className="kpi main">
          <div className="kpi-label">Best NRE deposit</div>
          <div className="kpi-value">{sum.bestFd ? ratePct(sum.bestFd.rate) : '–'}</div>
          <div className="kpi-sub muted">
            {sum.bestFd ? tenureText(sum.bestFd) : 'no NRE deposit rate on file'}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Best savings</div>
          <div className="kpi-value">{sum.bestSaving ? ratePct(sum.bestSaving.rate) : '–'}</div>
          <div className="kpi-sub muted">
            {sum.savings.length} balance step{sum.savings.length === 1 ? '' : 's'}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Last move</div>
          <div className={`kpi-value rt-move ${move?.dir ?? ''}`}>
            {move ? (move.dir === 'up' ? '▲' : move.dir === 'down' ? '▼' : '•') : '–'}
          </div>
          <div className="kpi-sub muted">
            {move ? `${move.what ? `${move.what}: ` : ''}${move.text}` : 'no change logged yet'}
          </div>
        </article>
        <article className="kpi">
          <div className="kpi-label">Rates on file</div>
          <div className="kpi-value">{offers.length}</div>
          <div className="kpi-sub muted">
            {sum.checkedOn ? `newest check ${niceDay(sum.checkedOn)}` : 'none yet'}
          </div>
        </article>
      </section>

      <Tabs
        base={base}
        current={tab}
        tabs={[
          { key: 'rates', label: 'Rates', badge: diffs.length || null },
          { key: 'history', label: 'History and log' },
          { key: 'reading', label: 'How it is read', badge: needsLook || pending.length || null },
        ]}
      />

      {tab === 'rates' && (
        <>
          {diffs.length > 0 && (
            <section className="card" aria-labelledby="diff-h">
              <h2 id="diff-h">The bank page says something different</h2>
              <p className="muted small">
                These rates are yours (typed, pasted or corrected) and are kept as they are. The
                page now shows another figure. Use the page&apos;s figure on the row to let the
                refresh own the rate again, or leave yours.
              </p>
              <ul className="list">
                {diffs.map((d) => (
                  <li key={d.id}>
                    <b>{d.what}</b>: you have {ratePct(d.yours)}, the page says {ratePct(d.page)}
                    {d.seenOn ? ` (seen ${niceDay(d.seenOn)})` : ''}
                    {d.correction ? ' (a figure you corrected earlier)' : ''}.
                  </li>
                ))}
              </ul>
            </section>
          )}
          {sections.length === 0 && (
            <p className="empty">
              No rates on file for {bank} yet. Add one below, paste your notes, or list the
              bank&apos;s rate page in <Link href="/settings#rates">Settings</Link>.
            </p>
          )}
          {sections.map((s) => (
            <section className="card" key={s.key} aria-labelledby={`sec-${s.key}`}>
              <div className="sectionhead" style={{ marginTop: 0 }}>
                <h2 id={`sec-${s.key}`}>{s.title}</h2>
                <span className="small muted">
                  {s.offers.length} rate{s.offers.length === 1 ? '' : 's'}
                </span>
              </div>
              <RateRows
                rows={s.offers.map((o) => rowModel(o, today, staleDays))}
                actions={actions}
              />
            </section>
          ))}
          <section className="card" id="add" aria-labelledby="add-h">
            <h2 id="add-h">Add a rate for {bank}</h2>
            <AddOffer banks={[bank]} bank={bank} />
          </section>
        </>
      )}

      {tab === 'history' && (
        <>
          <section className="card" aria-labelledby="hist-h">
            <h2 id="hist-h">Best rates over time</h2>
            <HistoryChart points={history} today={today} />
          </section>
          <section className="card" aria-labelledby="log-h">
            <h2 id="log-h">Every change</h2>
            <p className="muted small">
              Newest first. “By” says whether you or the weekly refresh made the change; “Why” is
              the reason you gave when you corrected a figure the bank page had given.
            </p>
            <ListingTools name={`rate-log-${bank.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
              <LogTable events={events} />
            </ListingTools>
          </section>
        </>
      )}

      {tab === 'reading' && (
        <>
          <SourcePanel status={source} bank={bank} />
          <section className="card" aria-labelledby="pend-h">
            <h2 id="pend-h">Corrections waiting for the next refresh</h2>
            {pending.length === 0 ? (
              <p className="muted small">
                None. When you change a figure the bank page gave, it appears here until the page
                agrees with it.
              </p>
            ) : (
              <>
                <p className="muted small">
                  You replaced what the refresh read. Your figure stays. At the next refresh the
                  page is read again: if it shows your figure, the refresh takes the rate back; if
                  it still shows the old one, the reason is worked out and saved as a rule.
                </p>
                <ul className="list">
                  {pending.map((p) => (
                    <li key={p.id}>
                      <b>{p.what}</b>: read as {ratePct(p.read)}, you set {ratePct(p.yours)} (
                      {p.reason.toLowerCase()}).
                      {p.stillWrong
                        ? ` The refresh has read the old figure again ${p.times} time${p.times === 1 ? '' : 's'}.`
                        : ''}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
          <section className="card" aria-labelledby="hint-h">
            <h2 id="hint-h">What the refresh has learned about {bank}</h2>
            <p className="muted small">
              Each rule is handed to the reader the next time it reads this bank&apos;s page. Switch
              off a rule that is wrong or no longer needed.
            </p>
            <HintList hints={hints} toggle={toggleHint} />
            {actions && (
              <details className="disclose">
                <summary>Write a rule yourself</summary>
                <AddHint bank={bank} />
              </details>
            )}
          </section>
          <section className="card">
            <h2>Where each rate came from</h2>
            <p className="muted small">
              “You” means typed, pasted or corrected by you; “Bank page” means read by the weekly
              refresh from the page named.
            </p>
            <table className="tbl lines responsive">
              <thead>
                <tr>
                  <th>Rate</th>
                  <th className="num">Now</th>
                  <th>From</th>
                  <th>Checked</th>
                </tr>
              </thead>
              <tbody>
                {offers
                  .slice()
                  .sort((a, b) => a.product.localeCompare(b.product) || a.tenureFrom - b.tenureFrom)
                  .map((o) => {
                    const m = rowModel(o, today, staleDays);
                    return (
                      <tr key={o.id}>
                        <td data-label="Rate">{m.what}</td>
                        <td className="num" data-label="Now">
                          {ratePct(o.rate)}
                        </td>
                        <td data-label="From">
                          <span className={`srcchip ${o.sourceKind === 'ai' ? 'auto' : 'manual'}`}>
                            {o.sourceKind === 'ai' ? 'Bank page' : 'You'}
                          </span>{' '}
                          {m.url ? (
                            <a href={m.url} target="_blank" rel="noreferrer">
                              {m.note}
                            </a>
                          ) : (
                            m.note
                          )}
                        </td>
                        <td data-label="Checked" className={m.stale ? 'warnText' : ''}>
                          {niceDay(o.checkedOn)}
                        </td>
                      </tr>
                    );
                  })}
              </tbody>
            </table>
          </section>
        </>
      )}
      <p className="small muted">
        Deciding where to put new money against these rates? Use{' '}
        <Link href={newMoneyHref}>New money</Link>.
      </p>
    </>
  );
}
