import type { Metadata } from 'next';
import Link from 'next/link';
import { Landmark, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import { formatInr, formatInrCompact } from '@fwos/core';
import { BottomNav, Sidebar } from '@/components/AppNav';
import { Stat } from '@/components/ui/stat';

export const metadata: Metadata = {
  title: 'Sample dashboard',
  robots: { index: false, follow: false },
};

async function noSignOut() {
  'use server';
}

/** Public preview of the dashboard layout with invented numbers: no private data is read. */
export default function DemoDashboard() {
  const total = 62_400_000;
  const liq = {
    liquid: 9_800_000,
    investable: 31_200_000,
    retirement: 8_400_000,
    illiquid: 13_000_000,
  };
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
          <Link href="/demo/retire" className="btn primary cta">
            Can I retire now?
          </Link>
          <section className="card hero" aria-label="Household net worth">
            <p className="muted small">Household net worth — estimated for today</p>
            <p className="big" aria-label={formatInr(total)}>
              {formatInrCompact(total)}
            </p>
            <p className="small">{formatInr(total)}</p>
            <p className="muted small">
              Last recorded values dated 2026-10-25. Since then, about ₹1,12,400 of interest, market
              and currency movement has been added as an estimate.
            </p>
            <div className="chips">
              <span className="chip">Interest ₹46,200</span>
              <span className="chip">Market ₹58,100</span>
              <span className="chip">Currency ₹8,100</span>
              <span className="chip">SIP instalments ₹40,000</span>
            </div>
          </section>
          <div className="statgrid">
            {(
              [
                ['liquid', 'Liquid', Wallet],
                ['investable', 'Investments', TrendingUp],
                ['retirement', 'Retirement accounts', PiggyBank],
                ['illiquid', 'Illiquid', Landmark],
              ] as const
            ).map(([k, label, Icon]) => (
              <Stat
                key={k}
                label={label}
                value={formatInrCompact(liq[k])}
                note={`${Math.round((liq[k] / total) * 100)}% of total`}
                icon={<Icon size={16} aria-hidden />}
              />
            ))}
          </div>
          <section className="card">
            <h2>Needs your attention</h2>
            <ul className="list">
              <li>
                <strong>Sample FD</strong> matures in 12 days (within 30-day window).
              </li>
              <li>3 records are stale or have no value; update them in Monthly Update.</li>
            </ul>
          </section>
          <section className="card">
            <h2>By type</h2>
            {types.map(([k, v]) => (
              <div key={k} style={{ margin: '10px 0' }}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span>{k}</span>
                  <span className="num">{formatInr(v)}</span>
                </div>
                <div className="bar" aria-hidden>
                  <span style={{ width: `${Math.round((v / total) * 100)}%` }} />
                </div>
              </div>
            ))}
          </section>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
