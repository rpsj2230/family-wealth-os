import { formatInr } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { applyReading, dismissMessage } from './actions';

export const dynamic = 'force-dynamic';

interface Reading {
  bank: string;
  last4: string | null;
  amount: number;
  currency: string;
  asOf: string;
  source: 'rule' | 'ai';
}

export default async function InboxPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [review, done, accounts, cfg] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select('id, received_on, from_domain, subject, reason, reading, asset_id')
      .eq('outcome', 'needs_review')
      .is('resolved_at', null)
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('inbox_messages')
      .select('id, received_on, from_domain, subject, outcome, reason, reading')
      .in('outcome', ['applied', 'error'])
      .order('created_at', { ascending: false })
      .limit(15),
    supabase
      .from('assets')
      .select('id, nickname, currency, identifier_last4')
      .in('type', ['bank_account', 'third_party_held'])
      .order('nickname'),
    supabase.from('integration_settings').select('ai_key_set').maybeSingle(),
  ]);
  const fmt = (r: Reading) =>
    `${r.currency === 'INR' ? formatInr(r.amount) : `${r.currency} ${r.amount.toLocaleString('en-IN')}`} on ${r.asOf}${r.last4 ? ` · account ending ${r.last4}` : ''} · ${r.source === 'ai' ? 'read by AI' : 'read by rule'}`;

  return (
    <>
      <h1>Bank email inbox</h1>
      <p className="muted">
        Forward bank emails to the Gmail label you set up. Balance alerts from a bank&apos;s own
        address are recorded automatically. Anything uncertain waits here for you.
        {!(cfg.data as { ai_key_set?: boolean } | null)?.ai_key_set && (
          <> Statements (PDF) need an AI key; add one in Settings.</>
        )}
      </p>

      <section className="card">
        <h2>Needs your decision ({(review.data ?? []).length})</h2>
        {(review.data ?? []).length === 0 && <p className="muted">Nothing waiting.</p>}
        {(review.data ?? []).map((m) => {
          const r = m.reading as Reading | null;
          return (
            <div className="card" key={m.id as string}>
              <h3>{(m.subject as string) || '(no subject)'}</h3>
              <p className="muted small">
                From {m.from_domain as string} · {m.received_on as string} · {m.reason as string}
              </p>
              {r ? (
                <>
                  <p>{fmt(r)}</p>
                  <form action={applyReading} className="form row">
                    <input type="hidden" name="id" value={m.id as string} />
                    <select
                      name="asset"
                      defaultValue={(m.asset_id as string | null) ?? ''}
                      required
                      aria-label="Record this balance on"
                    >
                      <option value="" disabled>
                        Choose the account
                      </option>
                      {(accounts.data ?? [])
                        .filter((a) => a.currency === r.currency)
                        .map((a) => (
                          <option key={a.id as string} value={a.id as string}>
                            {a.nickname as string}
                            {a.identifier_last4 ? ` (…${a.identifier_last4 as string})` : ''}
                          </option>
                        ))}
                    </select>
                    <button className="btn">Record this balance</button>
                  </form>
                </>
              ) : (
                <p className="muted small">No balance could be read from this message.</p>
              )}
              <form action={dismissMessage}>
                <input type="hidden" name="id" value={m.id as string} />
                <button className="btn compact ghost">Dismiss</button>
              </form>
            </div>
          );
        })}
      </section>

      <section className="card">
        <h2>Recently handled</h2>
        {(done.data ?? []).length === 0 ? (
          <p className="muted">Nothing yet.</p>
        ) : (
          <ul className="list small">
            {(done.data ?? []).map((m) => (
              <li key={m.id as string}>
                {m.received_on as string} · {m.from_domain as string} ·{' '}
                {m.outcome === 'applied' && m.reading
                  ? `recorded ${fmt(m.reading as Reading)}`
                  : `error: ${(m.reason as string) ?? ''}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
