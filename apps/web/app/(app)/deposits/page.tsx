import { ListingTools } from '@/components/ListingTools';
import { formatInr, formatInrCompact } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { buildDeposits, type DepositAsset } from '@/lib/deposits';
import { loadPortfolio } from '@/lib/portfolio-data';

export const dynamic = 'force-dynamic';

const KIND: Record<string, string> = {
  NRE: 'NRE',
  NRO: 'NRO',
  joint: 'Joint',
  unknown: 'Type not stated',
};

export default async function DepositsPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ today, fdRows, portfolio, ownerName }, assets, banks, settings] = await Promise.all([
    loadPortfolio(supabase),
    supabase
      .from('assets')
      .select('id, owner_id, institution_id, type, status, nickname, account_kind, is_joint'),
    supabase.from('institutions').select('id, name'),
    loadSettings(supabase as unknown as SupabaseClient),
  ]);
  const depositAssets: DepositAsset[] = (assets.data ?? []).map((a) => ({
    id: a.id as string,
    ownerId: a.owner_id as string,
    institutionId: (a.institution_id as string | null) ?? null,
    type: a.type as string,
    status: a.status as string,
    nickname: a.nickname as string,
    accountKind: (a.account_kind as string | null) ?? null,
    isJoint: !!a.is_joint,
  }));
  const bankName = new Map((banks.data ?? []).map((b) => [b.id as string, b.name as string]));
  const v = buildDeposits(
    depositAssets,
    portfolio.valued,
    fdRows,
    bankName,
    ownerName,
    today,
    settings.config.deposits.insuranceLimit,
  );
  const needsConfirm = v.fds.filter(
    (f) => f.status === 'matured_unconfirmed' || (f.status === 'active' && f.daysLeft < 0),
  );
  const soon = v.fds.filter(
    (f) =>
      f.status === 'active' &&
      f.daysLeft >= 0 &&
      f.daysLeft <= Math.max(...settings.config.deposits.maturityAlertDays),
  );
  const activeTotal = v.fds
    .filter((f) => f.status === 'active')
    .reduce((s, f) => s + f.accruedToday, 0);

  const byBank = Object.entries(v.cover.byBank)
    .map(([id, b]) => ({ id, name: v.cover.bankNames[id] ?? 'Unknown', ...b }))
    .sort((a, b) => b.uninsured - a.uninsured);

  return (
    <>
      <h1>Deposits and maturities</h1>
      <ListingTools name="deposits">
        <section className="card hero">
          <p className="muted small">Active fixed deposits, valued today with accrued interest</p>
          <p className="big">{formatInrCompact(activeTotal)}</p>
          <p className="small">
            {formatInr(activeTotal)} across {v.fds.filter((f) => f.status === 'active').length}{' '}
            deposits
          </p>
        </section>

        {needsConfirm.length > 0 && (
          <section className="card" aria-labelledby="conf">
            <h2 id="conf">Confirm what happened</h2>
            <ul className="list">
              {needsConfirm.map((f) => (
                <li key={f.id}>
                  <strong>{f.bank}</strong> · {f.owner} · {f.nickname} matured on {f.maturityOn}.
                  Renewed, paid out or still waiting? Set its status in{' '}
                  <a href="/monthly">Monthly update</a>. It is not counted in net worth until you
                  do.
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card" aria-labelledby="soon">
          <h2 id="soon">Maturing in the next 90 days</h2>
          {soon.length === 0 ? (
            <p className="muted">Nothing matures in the next 90 days.</p>
          ) : (
            <ul className="list">
              {soon.map((f) => (
                <li key={f.id}>
                  <strong>{f.maturityOn}</strong> ({f.daysLeft} days) — {f.bank}, {f.owner}:{' '}
                  {formatInr(f.bankMaturity ?? f.accruedToday)}{' '}
                  {f.bankMaturity === null ? '(estimated)' : '(bank figure)'}
                </li>
              ))}
            </ul>
          )}
          <p className="muted small">
            When an FD matures, the money moves from this list to your bank balance. It is not new
            wealth. Renewals are never assumed at the old rate.
          </p>
        </section>

        <section className="card" aria-labelledby="cal">
          <h2 id="cal">Maturity calendar</h2>
          <table className="tbl">
            <tbody>
              {v.byMonth.map((m) => (
                <tr key={m.month}>
                  <th scope="row">
                    {new Date(m.month + '-01T00:00:00Z').toLocaleDateString('en-IN', {
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    })}
                    <span className="muted small">
                      {' '}
                      · {m.items.length} FD{m.items.length === 1 ? '' : 's'}
                    </span>
                  </th>
                  <td className="num">{formatInr(m.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" aria-labelledby="reg">
          <h2 id="reg">All fixed deposits</h2>
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Deposit</th>
                <th className="num">Principal</th>
                <th className="num">Value today</th>
                <th>Rate</th>
                <th>Matures</th>
                <th className="num">Bank maturity amount</th>
              </tr>
            </thead>
            <tbody>
              {v.fds.map((f) => (
                <tr key={f.id} className={f.status !== 'active' ? 'dim' : ''}>
                  <td data-label="Deposit">
                    <strong>{f.bank}</strong> · {f.owner}
                    <br />
                    <span className="muted small">
                      {KIND[f.kind] ?? f.kind} · from {f.bookedOn}
                      {f.status !== 'active' ? ` · ${f.status.replace('_', ' ')}` : ''}
                    </span>
                  </td>
                  <td className="num" data-label="Principal">
                    {formatInr(f.principal)}
                  </td>
                  <td className="num" data-label="Value today">
                    {formatInr(f.accruedToday)}
                  </td>
                  <td data-label="Rate">{(f.rate * 100).toFixed(2)}%</td>
                  <td data-label="Matures">
                    {f.maturityOn}
                    <br />
                    <span className="muted small">
                      {f.daysLeft >= 0 ? `${f.daysLeft} days left` : `${-f.daysLeft} days ago`}
                    </span>
                  </td>
                  <td className="num" data-label="Bank maturity amount">
                    {f.bankMaturity === null ? '—' : formatInr(f.bankMaturity)}
                    {f.varianceVsBankPct !== null && Math.abs(f.varianceVsBankPct) > 0.05 && (
                      <span className="fail small">
                        {' '}
                        check: differs {f.varianceVsBankPct.toFixed(2)}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card" aria-labelledby="cover">
          <h2 id="cover">Deposit insurance (DICGC) position</h2>
          <p>
            Insured today: <strong>{formatInr(v.cover.insured)}</strong> · Above the cover limit:{' '}
            <strong className={v.cover.uninsured > 0 ? 'fail' : ''}>
              {formatInr(v.cover.uninsured)}
            </strong>
          </p>
          <table className="tbl responsive">
            <thead>
              <tr>
                <th>Bank</th>
                <th className="num">Deposits incl. interest</th>
                <th className="num">Above the limit</th>
              </tr>
            </thead>
            <tbody>
              {byBank.map((b) => (
                <tr key={b.id}>
                  <td data-label="Bank">{b.name}</td>
                  <td className="num" data-label="Deposits incl. interest">
                    {formatInr(b.total)}
                  </td>
                  <td
                    className={`num ${b.uninsured > 0 ? 'fail' : ''}`}
                    data-label="Above the limit"
                  >
                    {formatInr(b.uninsured)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <details>
            <summary>Breakdown by person and account type</summary>
            <table className="tbl responsive">
              <tbody>
                {v.cover.rows.map((r) => {
                  const [kind, owner] = r.capacityKey.split(':');
                  return (
                    <tr key={r.bankId + r.capacityKey}>
                      <td data-label="Bank / capacity">
                        {v.cover.bankNames[r.bankId]} · {v.cover.ownerNames[owner ?? ''] ?? '—'} ·{' '}
                        {kind === 'joint' ? 'joint accounts' : 'own name'}
                      </td>
                      <td className="num" data-label="Total">
                        {formatInr(r.total)}
                      </td>
                      <td className="num" data-label="Insured">
                        {formatInr(r.insured)}
                      </td>
                      <td className={`num ${r.uninsured > 0 ? 'fail' : ''}`} data-label="Above">
                        {formatInr(r.uninsured)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </details>
          <ul className="list small muted">
            {v.cover.assumptions.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </section>
      </ListingTools>
    </>
  );
}
