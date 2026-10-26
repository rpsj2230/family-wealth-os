import Link from 'next/link';
import { Landmark, PiggyBank, TrendingUp, Wallet } from 'lucide-react';
import { Stat } from '@/components/ui/stat';
import { PersonBadge } from '@/components/Person';
import {
  formatInr,
  formatInrCompact,
  maturityAlerts,
  personStyles,
  receivableStatus,
} from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { loadAccess, loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import { addMember, createHousehold } from './actions';
import { HistoryChart } from './HistoryChart';
import { SnapshotBeacon } from './SnapshotBeacon';
import { WhatsAppButton } from './share/WhatsAppButton';

export const dynamic = 'force-dynamic';

const TYPE_LABEL: Record<string, string> = {
  bank_account: 'Bank balances',
  fixed_deposit: 'Fixed deposits',
  mutual_fund: 'Mutual funds',
  stock: 'Stocks',
  receivable: 'Money lent',
  property: 'Property',
  ulip: 'ULIP / pension',
  nps: 'NPS',
  third_party_held: 'Held by others',
  other: 'Other',
};
const LIQ_LABEL: Record<string, string> = {
  liquid: 'Liquid (bank + FD)',
  investable: 'Investments (funds, stocks)',
  retirement: 'Retirement (ULIP, NPS)',
  illiquid: 'Illiquid (property, loans, held by others)',
};
const BASIS_LABEL: Record<string, string> = {
  calculated: 'Calculated from contract terms or units × NAV',
  estimated: 'Estimated (assumed interest rate or NAV change)',
  carried_forward: 'Carried forward from the last recorded value',
};

export default async function Dashboard({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  const { problem } = await searchParams;
  if ((await loadAccess()).role === 'emergency_viewer') redirect('/emergency');
  const { supabase, householdId, role } = await loadContext();

  if (!householdId) {
    return (
      <section className="card">
        <h1>Set up your household</h1>
        <p className="muted">
          This creates the private space that you and your spouse share. You become its
          administrator.
        </p>
        {problem && (
          <p className="notice warn" role="alert">
            Could not set up the household: {problem}. If you share an account with someone who has
            already set it up, ask them to add you, or sign in with the same email they used.
          </p>
        )}
        <form action={createHousehold} className="form">
          <label>
            Household name
            <input name="name" defaultValue="Our household" required />
          </label>
          <button className="btn primary">Create household</button>
        </form>
      </section>
    );
  }

  const [
    { today, assetRows, obsRows, fdRows, ownerName: nameOf, portfolio: p },
    tasks,
    recv,
    pays,
    snaps,
  ] = await Promise.all([
    loadPortfolio(supabase),
    supabase.from('tasks').select('id, status').eq('status', 'open'),
    supabase.from('receivables').select('asset_id, counterparty, lent, expected_on'),
    supabase.from('receivable_payments').select('asset_id, amount, paid_on'),
    supabase.from('snapshots').select('taken_on, total').order('taken_on', { ascending: true }),
  ]);

  if (assetRows.length === 0) {
    return (
      <section className="card">
        <h1>Welcome</h1>
        <p>Your household is ready, but nothing has been recorded yet.</p>
        <p>
          <Link className="btn primary" href="/import">
            Import your Excel workbook
          </Link>
        </p>
        {role === 'admin' && <AddMember />}
      </section>
    );
  }

  const nw = p.netWorth;
  const lastVerified = obsRows.reduce<string | null>(
    (m, o) => (!m || o.as_of > m ? o.as_of : m),
    null,
  );
  const delta = nw.estimateTotals.estimatedTotal - nw.estimateTotals.anchorTotal;

  const nickname = new Map(assetRows.map((a) => [a.id, a.nickname]));
  const settings = await loadSettings(supabase as unknown as SupabaseClient);
  const alerts = maturityAlerts(
    fdRows.map((f) => ({
      id: f.asset_id,
      name: nickname.get(f.asset_id) ?? 'FD',
      maturityOn: new Date(f.maturity_on + 'T00:00:00Z'),
      status: assetRows.find((a) => a.id === f.asset_id)?.status ?? 'active',
    })),
    today,
    settings.config.deposits.maturityAlertDays,
  );
  const paidBy = new Map<string, number>();
  for (const x of pays.data ?? [])
    paidBy.set(x.asset_id as string, (paidBy.get(x.asset_id as string) ?? 0) + Number(x.amount));
  const overdue = (recv.data ?? [])
    .map((r) => ({
      name: r.counterparty as string,
      s: receivableStatus(
        {
          id: r.asset_id as string,
          lent: Number(r.lent),
          repayments: paidBy.has(r.asset_id as string)
            ? [{ amount: paidBy.get(r.asset_id as string)!, on: today }]
            : [],
          expectedOn: r.expected_on ? new Date((r.expected_on as string) + 'T00:00:00Z') : null,
        },
        today,
      ),
    }))
    .filter((x) => x.s.status === 'overdue');
  const stale = Object.values(p.lines).filter(
    (l) => l.freshness === 'stale' || l.freshness === 'missing',
  );
  const assumptions = Object.values(p.lines).filter((l) => l.usedAssumption).length;

  const styles = personStyles([...nameOf.entries()].map(([id, name]) => ({ id, name })));
  type Action = { tone: 'bad' | 'warn' | 'info'; text: string; href: string };
  const actions: Action[] = [
    ...nw.excluded
      .filter((e) => e.reason === 'status_not_counted')
      .map((e): Action => ({
        tone: 'bad',
        text: `${e.name} has matured: say where the money went (not counted until then)`,
        href: '/accounts',
      })),
    ...overdue.map((o): Action => ({
      tone: 'bad',
      text: `${o.name} owes ${formatInr(o.s.outstanding)}, ${o.s.daysOverdue} days overdue`,
      href: '/others',
    })),
    ...alerts.map((a): Action => ({
      tone: 'warn',
      text: `${a.name} matures in ${a.daysLeft} days`,
      href: '/accounts',
    })),
    ...(stale.length > 0
      ? [
          {
            tone: 'warn',
            text: `${stale.length} balances are out of date`,
            href: '/monthly',
          } as Action,
        ]
      : []),
    ...nw.excluded
      .filter((e) => e.reason === 'no_valuation')
      .map((e): Action => ({
        tone: 'info',
        text: `${e.name} has no value recorded yet`,
        href: '/monthly',
      })),
  ];

  return (
    <>
      <SnapshotBeacon />
      <div className="row">
        <Link href="/raise" className="btn primary cta">
          I need money
        </Link>
        <Link href="/retire" className="btn cta">
          Can I retire now?
        </Link>
      </div>
      <section className="card hero" aria-label="Household net worth">
        <p className="muted small">Household net worth — estimated for today</p>
        <p className="big" aria-label={formatInr(nw.total)}>
          {formatInrCompact(nw.total)}
        </p>
        <p className="small">{formatInr(nw.total)}</p>
        <p className="muted small">
          Last recorded values dated {lastVerified ?? '—'}. Since then, about {formatInr(delta)} of
          interest, market and currency movement has been added as an estimate
          {assumptions > 0
            ? ` (${assumptions} accounts use an assumed 3% savings rate until you set the real one)`
            : ''}
          .
        </p>
        <div className="chips">
          <span className="chip">Interest {formatInr(nw.estimateTotals.interest)}</span>
          <span className="chip">Market {formatInr(nw.estimateTotals.market)}</span>
          <span className="chip">Currency {formatInr(nw.estimateTotals.fx)}</span>
          {nw.estimateTotals.contribution > 0 && (
            <span className="chip">
              SIP instalments {formatInr(nw.estimateTotals.contribution)}
            </span>
          )}
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
            value={formatInrCompact(nw.byLiquidity[k])}
            note={`${nw.total > 0 ? Math.round((nw.byLiquidity[k] / nw.total) * 100) : 0}% of total`}
            icon={<Icon size={16} aria-hidden />}
          />
        ))}
      </div>

      <div className="personstrip" aria-label="By person">
        {Object.entries(nw.byOwner)
          .sort((x, y) => y[1] - x[1])
          .map(([id, v]) => (
            <Link
              key={id}
              href={`/accounts?p=${id}`}
              className="pcard"
              style={{ ['--person' as string]: styles[id]?.colour }}
            >
              <PersonBadge p={styles[id]} name size={26} />
              <div className="num pvalue">{formatInrCompact(v)}</div>
              <div className="bar" aria-hidden>
                <span
                  style={{
                    width: `${nw.total > 0 ? Math.max(3, Math.round((v / nw.total) * 100)) : 0}%`,
                    background: styles[id]?.colour,
                  }}
                />
              </div>
              <div className="muted small">
                {nw.total > 0 ? Math.round((v / nw.total) * 100) : 0}% of the family
              </div>
            </Link>
          ))}
      </div>

      <section className="card" aria-labelledby="attn">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline' }}>
          <h2 id="attn">Needs you</h2>
          <Link href="/monthly" className="small">
            Monthly update →
          </Link>
        </div>
        {actions.length === 0 ? (
          <p className="notice ok" role="status">
            Nothing needs you today. Everything that could be updated automatically has been.
          </p>
        ) : (
          <ul className="list nobullet actions">
            {actions.slice(0, 6).map((x, i) => (
              <li key={i} className={`action ${x.tone}`}>
                <Link href={x.href}>
                  <span className="dot" aria-hidden />
                  <span>{x.text}</span>
                  <span className="go" aria-hidden>
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {actions.length > 6 && (
          <p className="muted small">and {actions.length - 6} more in Tasks and Monthly update.</p>
        )}
      </section>

      <p>
        <WhatsAppButton />
      </p>

      <HistoryChart
        points={(snaps.data ?? []).map((x) => ({
          date: x.taken_on as string,
          value: Number(x.total),
        }))}
        today={today.toISOString().slice(0, 10)}
      />

      <section className="grid2">
        <div className="card">
          <h2>By liquidity</h2>
          <table className="tbl">
            <tbody>
              {Object.entries(nw.byLiquidity).map(([k, v]) => (
                <tr key={k}>
                  <th scope="row">{LIQ_LABEL[k]}</th>
                  <td className="num">{formatInr(v)}</td>
                </tr>
              ))}
              <tr className="sum">
                <th scope="row">Investable financial assets</th>
                <td className="num">{formatInr(nw.investableFinancial)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="card">
        <h2>By type</h2>
        {Object.entries(nw.byType)
          .sort((x, y) => y[1]! - x[1]!)
          .map(([k, v]) => (
            <div key={k} style={{ margin: '10px 0' }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <span>{TYPE_LABEL[k] ?? k}</span>
                <span className="num">{formatInr(v!)}</span>
              </div>
              <div className="bar" aria-hidden>
                <span
                  style={{
                    width: `${nw.total > 0 ? Math.max(2, Math.round((v! / nw.total) * 100)) : 0}%`,
                  }}
                />
              </div>
            </div>
          ))}
      </section>

      <section className="card">
        <h2>How reliable are these numbers?</h2>
        <table className="tbl">
          <tbody>
            {(Object.keys(BASIS_LABEL) as (keyof typeof BASIS_LABEL)[]).map((b) => (
              <tr key={b}>
                <th scope="row">{BASIS_LABEL[b]}</th>
                <td className="num">{formatInr(nw.estimateTotals.byBasis[b as 'calculated'])}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Insurance cover is never counted as wealth. Matured or unconfirmed deposits are excluded
          until confirmed. {(tasks.data ?? []).length} open admin tasks.
        </p>
      </section>

      {role === 'admin' && <AddMember />}
    </>
  );
}

function AddMember() {
  return (
    <section className="card">
      <h2>Add your spouse</h2>
      <p className="muted small">
        Create their login in Supabase first, then enter the same email here. They will see
        everything you see.
      </p>
      <form action={addMember} className="form row">
        <input
          name="email"
          type="email"
          placeholder="spouse@example.com"
          required
          aria-label="Spouse email"
        />
        <button className="btn">Add</button>
      </form>
    </section>
  );
}
