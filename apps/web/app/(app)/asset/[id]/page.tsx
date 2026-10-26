import Link from 'next/link';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader, type Crumb } from '@/components/AssetFacts';
import { DetailTables } from '@/components/DetailTable';
import { HistoryLine } from '@/components/HistoryLine';
import { FundChart } from '@/components/FundChart';
import { loadContext } from '@/lib/data';
import { loadAssetDetail } from '@/lib/detail-data';
import { loadInvestmentView } from '@/lib/investments';
import { formatInr } from '@fwos/core';

export const dynamic = 'force-dynamic';

export default async function AssetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadAssetDetail(id);
  const fundView =
    d.type === 'mutual_fund'
      ? await (async () => {
          const { supabase } = await loadContext();
          const v = await loadInvestmentView(supabase);
          for (const g of v.groups) {
            const f = g.funds.find((x) => x.assetId === id);
            if (f) return { f, today: v.today };
          }
          return null;
        })()
      : null;
  const isFund = d.type === 'mutual_fund' || d.type === 'stock';
  const isBankLike =
    d.type === 'bank_account' || d.type === 'fixed_deposit' || d.type === 'third_party_held';
  const crumbs: Crumb[] = isFund
    ? [{ label: 'Investments', href: '/investments' }]
    : isBankLike
      ? [
          { label: 'Accounts', href: '/accounts' },
          ...(d.bank ? [{ label: d.bank.name, href: `/bank/${d.bank.id}` }] : []),
        ]
      : [{ label: 'Lent, policies, property', href: '/others' }];
  crumbs.push({ label: d.view.title });
  return (
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
            {isBankLike && (
              <Link className="btn compact" href="/accounts/edit">
                Edit details
              </Link>
            )}
            <Link className="btn compact" href="/monthly">
              Update balance
            </Link>
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
          <div className="termbar" role="img" aria-label={d.view.progress.caption}>
            <span style={{ width: `${Math.round(d.view.progress.pct * 100)}%` }} />
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
        <section className="detailsection" aria-label="Fund progress">
          <h2>How this fund has progressed</h2>
          <p className="muted small">
            {fundView.f.units !== null
              ? `${fundView.f.units.toLocaleString('en-IN', { maximumFractionDigits: 3 })} units`
              : 'Units not recorded yet'}
            {fundView.f.nav !== null ? ` × price ${fundView.f.nav}` : ''}
            {fundView.f.value ? ` = ${formatInr(Math.round(fundView.f.value))}` : ''}.{' '}
            <Link href="/investments/update">Update units and price</Link>
          </p>
          <FundChart
            history={fundView.f.history}
            today={fundView.today}
            caption={`${fundView.f.name}: value against money put in`}
            height={200}
          />
        </section>
      )}
      {d.view.charts.map((c) => (
        <section className="detailsection" key={c.title} aria-label={c.title}>
          <h2>{c.title}</h2>
          <HistoryLine points={c.points} label={c.label} money={c.money} />
        </section>
      ))}
      {d.view.related.length > 0 && (
        <section className="detailsection" aria-label="Other accounts at this bank">
          <h2>Other accounts of {d.person?.name ?? 'this person'} at this bank</h2>
          <ul className="related">
            {d.view.related.map((r) => (
              <li key={r.href}>
                <Link href={r.href}>{r.label}</Link>
                <span className="num">{r.value}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <DetailTables tables={d.view.tables} />
      <ActivityLog items={d.activity} />
    </>
  );
}
