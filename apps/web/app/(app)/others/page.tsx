import { formatInr, receivableStatus } from '@fwos/core';
import { loadContext } from '@/lib/data';
import { addLoan, recordRepayment, setExpectedDate, updatePolicy } from './actions';

export const dynamic = 'force-dynamic';

export default async function OthersPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [recv, pays, pol, ins, owners] = await Promise.all([
    supabase
      .from('receivables')
      .select('asset_id, counterparty, lent, lent_on, expected_on')
      .order('counterparty'),
    supabase.from('receivable_payments').select('asset_id, amount, paid_on').order('paid_on'),
    supabase
      .from('policies')
      .select(
        'id, kind, insurer, coverage_text, paid_by, renewal_on, expires_on, nominee_note, documents_note',
      )
      .order('kind'),
    supabase.from('policy_insured').select('policy_id, owner_id'),
    supabase.from('owners').select('id, display_name'),
  ]);
  const today = new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const todayIso = today.toISOString().slice(0, 10);
  const who = new Map((owners.data ?? []).map((o) => [o.id as string, o.display_name as string]));
  const insured = new Map<string, string[]>();
  for (const x of ins.data ?? [])
    insured.set(x.policy_id as string, [
      ...(insured.get(x.policy_id as string) ?? []),
      who.get(x.owner_id as string) ?? '—',
    ]);

  return (
    <>
      <h1>Money lent and policies</h1>

      <section className="card" aria-labelledby="rec">
        <h2 id="rec">Money lent to others</h2>
        <p className="muted small">
          The amount owed is always money lent minus repayments you record here. It is not counted
          as cash.
        </p>
        {(recv.data ?? []).length === 0 && <p className="muted">Nothing recorded.</p>}
        {(recv.data ?? []).map((r) => {
          const payments = (pays.data ?? []).filter((p) => p.asset_id === r.asset_id);
          const s = receivableStatus(
            {
              id: r.asset_id as string,
              lent: Number(r.lent),
              repayments: payments.map((p) => ({
                amount: Number(p.amount),
                on: new Date((p.paid_on as string) + 'T00:00:00Z'),
              })),
              expectedOn: r.expected_on ? new Date((r.expected_on as string) + 'T00:00:00Z') : null,
            },
            today,
          );
          return (
            <div className="card" key={r.asset_id as string}>
              <h3>{r.counterparty as string}</h3>
              <p>
                Lent {formatInr(Number(r.lent))}
                {r.lent_on ? ` on ${r.lent_on as string}` : ''} · repaid {formatInr(s.repaid)} ·{' '}
                <strong>owed {formatInr(s.outstanding)}</strong>
                {s.status === 'overdue' ? (
                  <span className="fail"> · {s.daysOverdue} days overdue</span>
                ) : null}
                {s.status === 'settled' ? ' · settled' : ''}
              </p>
              {payments.length > 0 && (
                <ul className="list small">
                  {payments.map((p, i) => (
                    <li key={i}>
                      {formatInr(Number(p.amount))} on {p.paid_on as string}
                    </li>
                  ))}
                </ul>
              )}
              <form action={recordRepayment} className="form row">
                <input type="hidden" name="asset" value={r.asset_id as string} />
                <input
                  name="amount"
                  inputMode="decimal"
                  placeholder="Amount received"
                  aria-label="Amount received"
                  required
                />
                <input
                  name="on"
                  type="date"
                  max={todayIso}
                  defaultValue={todayIso}
                  aria-label="Date received"
                  required
                />
                <button className="btn">Record repayment</button>
              </form>
              <form action={setExpectedDate} className="form row">
                <input type="hidden" name="asset" value={r.asset_id as string} />
                <label className="check">
                  Expected back by{' '}
                  <input
                    name="on"
                    type="date"
                    defaultValue={(r.expected_on as string | null) ?? ''}
                  />
                </label>
                <button className="btn compact ghost">Save</button>
              </form>
            </div>
          );
        })}
        <details>
          <summary>Add a loan</summary>
          <form action={addLoan} className="form">
            <div className="formgrid">
              <label>
                Lent by
                <select name="owner" required>
                  {[...who.entries()].map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Lent to
                <input name="who" required maxLength={120} />
              </label>
              <label>
                Amount (₹)
                <input name="lent" inputMode="decimal" required />
              </label>
              <label>
                Lent on
                <input name="lent_on" type="date" max={todayIso} />
              </label>
              <label>
                Expected back by
                <input name="expected" type="date" />
              </label>
            </div>
            <button className="btn">Add loan</button>
          </form>
        </details>
      </section>

      <section className="card" aria-labelledby="pol">
        <h2 id="pol">Insurance policies</h2>
        <p className="muted small">
          Insurance cover is information, never part of net worth. Renewal and expiry dates feed the
          reminders.
        </p>
        {(pol.data ?? []).map((p) => (
          <div className="card" key={p.id as string}>
            <h3>
              {p.insurer as string}{' '}
              <span className="muted small">({(p.kind as string).replace('_', ' ')})</span>
            </h3>
            <p className="small">{p.coverage_text as string}</p>
            <p className="muted small">
              Insured: {(insured.get(p.id as string) ?? []).join(', ') || '—'}
              {p.paid_by ? ` · paid by ${p.paid_by as string}` : ''}
            </p>
            <details>
              <summary>Renewal, nominee and documents</summary>
              <form action={updatePolicy} className="form">
                <input type="hidden" name="id" value={p.id as string} />
                <div className="formgrid">
                  <label>
                    Next renewal
                    <input
                      name="renewal"
                      type="date"
                      defaultValue={(p.renewal_on as string | null) ?? ''}
                    />
                  </label>
                  <label>
                    Policy ends
                    <input
                      name="expires"
                      type="date"
                      defaultValue={(p.expires_on as string | null) ?? ''}
                    />
                  </label>
                  <label>
                    Nominee (name and relationship)
                    <input name="nominee" defaultValue={(p.nominee_note as string | null) ?? ''} />
                  </label>
                  <label>
                    Where the documents are
                    <input
                      name="documents"
                      defaultValue={(p.documents_note as string | null) ?? ''}
                    />
                  </label>
                </div>
                <button className="btn">Save</button>
              </form>
            </details>
          </div>
        ))}
      </section>
    </>
  );
}
