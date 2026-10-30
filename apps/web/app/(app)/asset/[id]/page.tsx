import Link from 'next/link';
import { Suspense } from 'react';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader, type Crumb } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { FundDetailPanel } from '@/components/FundDetailPanel';
import { HistoryLine } from '@/components/HistoryLine';
import { EditButton } from '@/components/QuickEdit';
import { QuickEditHost } from '@/components/QuickEditHost';
import { StatementLines } from '@/components/StatementLines';
import { loadAssetDetail } from '@/lib/detail-data';
import { loadContext } from '@/lib/data';
import { HoldingChain } from '@/components/MoneyChainView';
import { chainContextOf, loadTrailContext } from '@/lib/trail-data';
import { accountLines } from '@fwos/data';
import { holdingSources } from '@fwos/core';
import { VALUE_TABLE } from '@/lib/detail-view';
import { loadFundDetail } from '@/lib/fund-detail-data';
import { fundEditRows } from '@/lib/invest-ledger';
import { parseRange, personStyles } from '@fwos/core';
import { FundEditProvider } from '@/components/invest/FundEdit';
import { FundPage, parseFundTab } from '@/components/invest/FundPage';
import { SipPlan } from '@/components/invest/SipPlan';
import { loadSipPlan } from '@/lib/sip-plan-data';
import { addFund, addFundTxn, saveFundEdit } from '../../investments/edit-actions';

export const dynamic = 'force-dynamic';

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ range?: string; tab?: string; heat?: string; edit?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const d = await loadAssetDetail(id);
  const fundView = d.type === 'mutual_fund' ? await loadFundDetail(id, parseRange(sp.range)) : null;
  const sipView =
    d.type === 'mutual_fund' && fundView
      ? await loadSipPlan((await loadContext()).supabase, id, fundView.today)
      : null;
  const isFund = d.type === 'mutual_fund' || d.type === 'stock';
  const isBankLike =
    d.type === 'bank_account' || d.type === 'fixed_deposit' || d.type === 'third_party_held';
  const isLoan = d.type === 'receivable';
  const isDeposit = d.type === 'fixed_deposit';
  const crumbs: Crumb[] = isFund
    ? [{ label: 'Investments', href: '/investments' }]
    : isBankLike
      ? [
          { label: 'Accounts', href: '/accounts' },
          ...(d.bank ? [{ label: d.bank.name, href: `/bank/${d.bank.id}` }] : []),
        ]
      : [
          { label: 'Lent, policies, property', href: '/others' },
          {
            label: isLoan ? 'Money lent' : 'Property and other',
            href: isLoan ? '/others?tab=lent' : '/others?tab=property',
          },
        ];
  crumbs.push({ label: d.view.title });
  if (fundView && d.type === 'mutual_fund') {
    const v = fundView.view;
    const styles = personStyles(v.groups.map((g) => ({ id: g.ownerId, name: g.name })));
    const records = (
      <>
        <AssetFacts facts={d.view.facts} />
        <DetailTables
          tables={[
            ...d.view.tables.filter((t) => t.title === VALUE_TABLE),
            ...d.view.tables.filter((t) => t.title === 'Recorded values'),
          ]}
        />
        <Suspense fallback={null}>
          <HoldingTrail id={id} kind="fund" />
        </Suspense>
        <ActivityLog items={d.activity} />
      </>
    );
    return (
      <FundEditProvider
        rows={fundEditRows(v)}
        owners={v.groups.map((g) => ({ id: g.ownerId, name: g.name }))}
        goals={v.goals}
        styles={styles}
        today={v.today}
        actions={{ save: saveFundEdit, addFund, addTxn: addFundTxn }}
        linkBase={{ match: '/investments?tab=match', demo: false }}
        initialOpen={sp.edit ?? null}
      >
        <DetailHeader
          crumbs={crumbs}
          title={d.view.title}
          subtitle={d.view.subtitle}
          {...(d.person ? { person: d.person } : {})}
          {...(d.view.headline ? { headline: d.view.headline } : {})}
          {...(d.view.headlineNote ? { headlineNote: d.view.headlineNote } : {})}
          actions={
            <Link className="btn compact" href="/investments?tab=update">
              Update units and price
            </Link>
          }
        />
        <FundPage
          fund={fundView.fund}
          detail={fundView.detail}
          tab={parseFundTab(sp.tab)}
          heat={sp.heat === 'calendar' ? 'calendar' : 'financial'}
          base={`/asset/${id}`}
          keep={{}}
          today={fundView.today}
          demo={false}
          holdingMonths={fundView.holdingMonths}
          config={v.config}
          colour={d.person?.colour ?? 'var(--viz-1)'}
          tax={fundView.tax}
          taxHref="/tax"
          replaced={fundView.replaced}
          overview={(ex) => (
            <FundDetailPanel
              ex={ex}
              fund={fundView.fund}
              detail={fundView.detail}
              base={`/asset/${id}`}
              links={{ update: '/investments?tab=update', match: '/investments?tab=match' }}
              holdingMonths={fundView.holdingMonths}
              {...(d.person ? { colour: d.person.colour } : {})}
            />
          )}
          records={records}
          {...(sipView ? { sipPlan: <SipPlan view={sipView} today={fundView.today} /> } : {})}
        />
      </FundEditProvider>
    );
  }
  const page = (
    <>
      <DetailHeader
        crumbs={crumbs}
        title={d.view.title}
        subtitle={d.view.subtitle}
        {...(d.person ? { person: d.person } : {})}
        {...(d.view.headline ? { headline: d.view.headline } : {})}
        {...(d.view.headlineNote ? { headlineNote: d.view.headlineNote } : {})}
        actions={
          <>
            {isBankLike && <EditButton id={id} name={d.view.title} label="Edit details" button />}
            {isDeposit && (
              <Link className="btn compact" href="/deposits?tab=maturities">
                All maturities
              </Link>
            )}
            {d.type === 'mutual_fund' ? (
              <Link className="btn compact" href="/investments?tab=update">
                Update units and price
              </Link>
            ) : isLoan ? (
              <Link className="btn compact" href="/others?tab=lent">
                Record a repayment
              </Link>
            ) : isBankLike || d.type === 'stock' ? (
              <Link className="btn compact" href="/monthly">
                Update balance
              </Link>
            ) : (
              <Link className="btn compact" href="/others?tab=property">
                Record a new value
              </Link>
            )}
          </>
        }
      />
      {d.view.kpis.length > 0 && (
        <section className="kpis assetkpis" aria-label="Key figures">
          {d.view.kpis.map((k) => (
            <article key={k.label} className="kpi">
              <div className="kpi-label">{k.label}</div>
              <div className={`kpi-value ${k.tone ?? ''}`}>{k.value}</div>
              {k.note && <div className="kpi-sub muted">{k.note}</div>}
            </article>
          ))}
        </section>
      )}
      {d.view.progress && (
        <section className="detailsection" aria-label={d.view.progress.title}>
          <h2>{d.view.progress.title}</h2>
          <div className="termtrack">
            <div className="termbar" role="img" aria-label={d.view.progress.caption}>
              <span style={{ width: `${(d.view.progress.pct * 100).toFixed(2)}%` }} />
            </div>
            {/* the pointer: a line across the bar at today's place, and a label that stays inside the track */}
            <div
              className="termline"
              style={{ left: `${(d.view.progress.pct * 100).toFixed(2)}%` }}
              aria-hidden
            />
            <div
              className="termnow"
              style={{
                left: `clamp(34px, ${(d.view.progress.pct * 100).toFixed(2)}%, calc(100% - 34px))`,
              }}
              aria-hidden
            >
              Today
              <span>{d.view.progress.today}</span>
            </div>
          </div>
          <div className="termends small muted">
            <span>Booked {d.view.progress.from}</span>
            <b>{d.view.progress.caption}</b>
            <span>Matures {d.view.progress.to}</span>
          </div>
        </section>
      )}
      <AssetFacts facts={d.view.facts} />
      {fundView && (
        <FundDetailPanel
          fund={fundView.fund}
          detail={fundView.detail}
          base={`/asset/${id}`}
          links={{ update: '/investments?tab=update', match: '/investments?tab=match' }}
          holdingMonths={fundView.holdingMonths}
          {...(d.person ? { colour: d.person.colour } : {})}
        />
      )}
      {d.view.charts
        .filter((c) => !(fundView && c.label === 'NAV'))
        .map((c) => (
          <section className="detailsection" key={c.title} aria-label={c.title}>
            <h2>{c.title}</h2>
            <HistoryLine points={c.points} label={c.label} money={c.money} />
          </section>
        ))}
      {d.view.related.length > 0 && (
        <section className="detailsection" aria-label="Other accounts at this bank">
          <h2>Other accounts of {d.person?.name ?? 'this person'} at this bank</h2>
          <ul className="related">
            {d.view.related
              .filter((r) => !r.ended)
              .map((r) => (
                <li key={r.href}>
                  <span>
                    <Link href={r.href}>{r.label}</Link>
                    {r.note && <span className="muted small related-note">{r.note}</span>}
                  </span>
                  <span className="num">{r.value}</span>
                </li>
              ))}
          </ul>
          {d.view.related.some((r) => r.ended) && (
            <details className="disclose">
              <summary className="small muted">
                {d.view.related.filter((r) => r.ended).length} matured or closed
              </summary>
              <ul className="related">
                {d.view.related
                  .filter((r) => r.ended)
                  .map((r) => (
                    <li key={r.href}>
                      <span>
                        <Link href={r.href}>{r.label}</Link>
                        {r.note && <span className="muted small related-note">{r.note}</span>}
                      </span>
                      <span className="num muted small">{r.value}</span>
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </section>
      )}
      {d.type === 'bank_account' && (
        // the transactions need every statement line sorted by the rules: they arrive after the rest of the page
        <Suspense
          fallback={
            <section className="detailsection" aria-busy="true">
              <h2>Transactions</h2>
              <p className="muted small">Loading the transactions…</p>
            </section>
          }
        >
          <AccountTransactions
            id={id}
            fileName={`transactions-${d.view.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}
          />
        </Suspense>
      )}
      {(d.type === 'bank_account' || isDeposit) && (
        // the money trail follows every statement line: it arrives after the rest of the page
        <Suspense fallback={null}>
          <HoldingTrail id={id} kind={isDeposit ? 'deposit' : 'account'} />
        </Suspense>
      )}
      <DetailTables tables={d.view.tables} />
      <ActivityLog items={d.activity} />
    </>
  );
  return d.quick ? (
    <QuickEditHost
      model={d.quick.model}
      styles={d.quick.styles}
      today={d.quick.today}
      fxHint={d.quick.fxHint}
    >
      {page}
    </QuickEditHost>
  ) : (
    page
  );
}

/** The account's bank statement lines, each opening its own page with its trail; nothing when it has no statement on file. */
async function AccountTransactions({ id, fileName }: { id: string; fileName: string }) {
  const { count } = await (
    await loadContext()
  ).supabase
    .from('statement_lines')
    .select('id', { count: 'exact', head: true })
    .eq('asset_id', id);
  if (!count) return null;
  const lines = accountLines((await loadTrailContext()).data, id);
  return <StatementLines assetId={id} lines={lines} fileName={fileName} />;
}

/**
 * The holding's money trail, step by step: for a deposit, the lines that booked it and where they came from, and where its money went
 * when paid back; for a fund, its purchases paid from a statement on file; for an account, where today's money came from.
 */
async function HoldingTrail({ id, kind }: { id: string; kind: 'account' | 'deposit' | 'fund' }) {
  const t = await loadTrailContext();
  const c = chainContextOf(t);
  if (!holdingSources(c.chain, id).length && !(c.chain.outOf.get(id) ?? []).length) return null;
  return (
    <section className="detailsection" aria-labelledby="ht-h" data-testid="holding-trail">
      <h2 id="ht-h">Money trail</h2>
      <HoldingChain c={c} assetId={id} kind={kind} />
      <p className="small">
        <Link href={`/trail?h=${id}`}>Open it on the Money trail page</Link>
        {' · '}
        <Link href={`/trail?tab=flow&view=journey&h=${id}`}>See it as a diagram</Link>
      </p>
    </section>
  );
}
