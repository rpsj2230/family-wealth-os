import type { Metadata } from 'next';
import Link from 'next/link';
import { formatInr, formatInrCompact, linearPath, type SeriesPoint } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { BarList, Donut, Sparkline } from '@/components/charts';
import { FundChart } from '@/components/FundChart';
import { TrendChart } from '@/components/TrendChart';

export const metadata: Metadata = {
  title: 'Sample dashboard',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

const TODAY = '2026-10-26';
const month = (i: number) => {
  const d = new Date(Date.UTC(2025, 10 + i, 1));
  d.setUTCDate(0);
  return d.toISOString().slice(0, 10);
};

/** Public preview of the dashboard layout with invented numbers: no private data is read. */
export default function DemoDashboard() {
  const total = 62_400_000;
  const trend = Array.from({ length: 12 }, (_, i) => ({
    date: month(i),
    value: Math.round(48_000_000 + i * 1_150_000 + Math.sin(i) * 400_000),
  }));
  trend.push({ date: TODAY, value: total });
  const projection = linearPath(trend[trend.length - 1]!, 1_150_000, 2);
  const funds: SeriesPoint[] = trend.map((p, i) => ({
    date: p.date,
    value: Math.round(p.value * 0.28),
    invested: Math.round(11_000_000 + i * 380_000),
  }));
  const palette = ['#4f46e5', '#0891b2', '#16a34a', '#d97706', '#db2777', '#7c3aed'];
  const types: [string, number][] = [
    ['Fixed deposits', 21_500_000],
    ['Mutual funds', 17_900_000],
    ['Property', 13_000_000],
    ['Bank accounts', 6_300_000],
    ['Retirement accounts', 3_700_000],
  ];
  return (
    <div className="shell">
      <Sidebar email="sample@example.com" signOut={noSignOut} />
      <div>
        <header className="topbar">
          <Link href="/login" className="brand">
            <img className="logo sm" src="/brand/rp-logo.png" alt="RP" />
            <span>Family Wealth OS</span>
          </Link>
        </header>
        <main className="content">
          <p className="notice warn" role="note">
            Sample screen with invented numbers. <Link href="/login">Sign in</Link> to see your own.
          </p>
          <div className="pagehead">
            <h1>Family wealth</h1>
            <div className="row">
              <Link href="/demo/raise" className="btn primary cta">
                I need money
              </Link>
              <Link href="/demo/retire" className="btn cta">
                Can I retire now?
              </Link>
            </div>
          </div>

          <section className="kpis" aria-label="Key figures">
            <article className="kpi main">
              <div className="kpi-label">Net worth today</div>
              <div className="kpi-value">{formatInrCompact(total)}</div>
              <div className="kpi-sub gain">+₹11,50,000 (+1.9%) in 30 days</div>
              <div className="kpi-spark">
                <Sparkline
                  points={trend.map((x) => x.value)}
                  label="Net worth"
                  width={160}
                  height={34}
                />
              </div>
            </article>
            <article className="kpi">
              <div className="kpi-label">Cash and deposits</div>
              <div className="kpi-value">{formatInrCompact(9_800_000)}</div>
              <div className="kpi-sub muted">16% of net worth</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">Mutual funds</div>
              <div className="kpi-value">{formatInrCompact(17_900_000)}</div>
              <div className="kpi-sub gain">+₹42,300 (+0.24%) today</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">Fund returns</div>
              <div className="kpi-value gain">+₹6,12,000</div>
              <div className="kpi-sub muted">XIRR +13.2% a year</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">Goals on track</div>
              <div className="kpi-value">
                2<span className="muted"> / 3</span>
              </div>
              <div className="kpi-sub muted">see each goal</div>
            </article>
            <article className="kpi">
              <div className="kpi-label">Needs you</div>
              <div className="kpi-value">3</div>
              <div className="kpi-sub muted">2 open tasks</div>
            </article>
          </section>

          <section className="dashgrid">
            <div className="card span2">
              <h2>Net worth over time</h2>
              <TrendChart
                series={[
                  {
                    name: 'Net worth',
                    colour: 'var(--primary, #4f46e5)',
                    area: true,
                    points: trend,
                  },
                  {
                    name: 'If the pace holds',
                    colour: 'var(--ok, #15803d)',
                    dashed: true,
                    points: [trend[trend.length - 1]!, ...projection].map((x) => ({
                      date: x.date,
                      value: x.value,
                    })),
                  },
                ]}
                caption="Household net worth over time"
                today={TODAY}
                height={240}
                defaultRange="all"
              />
              <p className="muted small">
                Dotted line: if the last 12 months&apos; pace continues. A straight extension, not a
                forecast.
              </p>
            </div>
            <div className="card">
              <h2>Where the money is</h2>
              <Donut
                caption="Net worth by kind of asset"
                slices={types.map(([label, value], i) => ({ label, value, colour: palette[i]! }))}
                centre={{ top: formatInrCompact(total), bottom: 'total' }}
              />
            </div>
            <div className="card">
              <h2>Whose money</h2>
              <Donut
                caption="Net worth by person"
                slices={[
                  { label: 'Person A', value: 31_000_000, colour: '#2563eb' },
                  { label: 'Person B', value: 24_400_000, colour: '#ea580c' },
                  { label: 'Joint', value: 7_000_000, colour: '#16a34a' },
                ]}
              />
            </div>
            <div className="card span2">
              <h2>Mutual funds</h2>
              <FundChart
                history={funds}
                today={TODAY}
                caption="Value of all mutual funds against the money put in"
                height={200}
              />
            </div>
            <div className="card">
              <h2>Goals</h2>
              <ul className="goalbars">
                {(
                  [
                    ['Education', 82, 'gain'],
                    ['Retirement', 64, 'gain'],
                    ['House', 31, 'fail'],
                  ] as const
                ).map(([name, v, tone]) => (
                  <li key={name}>
                    <div className="barhead">
                      <span>{name}</span>
                      <span className={tone}>{v}% funded</span>
                    </div>
                    <div className="bartrack">
                      <div
                        className="barfill"
                        style={{
                          width: `${v}%`,
                          background:
                            tone === 'fail' ? 'var(--bad, #b91c1c)' : 'var(--ok, #15803d)',
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div className="card">
              <h2>When can I get at it?</h2>
              <BarList
                caption="Money available over time"
                items={[
                  { label: 'In accounts now', value: 4_200_000, colour: palette[0]! },
                  { label: 'Deposits maturing in 30 days', value: 1_900_000, colour: palette[1]! },
                  { label: '91–180 days', value: 2_300_000, colour: palette[2]! },
                  { label: 'Beyond a year', value: 6_100_000, colour: palette[3]! },
                ]}
              />
            </div>
            <div className="card">
              <h2>Coming up</h2>
              <ul className="timeline">
                <li className="soon">
                  <span className="when">in 12d</span> Sample bank FD matures{' '}
                  <span className="num small">₹10.0 L</span>
                </li>
                <li>
                  <span className="when">in 40d</span> Term policy renews
                </li>
                <li>
                  <span className="when">in 96d</span> Advance tax instalment
                </li>
              </ul>
            </div>
            <div className="card">
              <h2>How reliable are these numbers?</h2>
              <div className="fresh">
                <span className="f-ok" style={{ flex: 82 }} />
                <span className="f-aging" style={{ flex: 12 }} />
                <span className="f-stale" style={{ flex: 6 }} />
              </div>
              <p className="small">
                <b>82%</b> of 101 balances are up to date; 12 getting old, 6 out of date. Total{' '}
                {formatInr(total)}.
              </p>
            </div>
          </section>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
