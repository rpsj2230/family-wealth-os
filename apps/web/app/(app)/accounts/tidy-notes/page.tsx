import Link from 'next/link';
import { loadContext } from '@/lib/data';
import { loadTidyPlan } from '@/lib/tidy-notes';
import { applyTidyNotes } from '../actions';

export const dynamic = 'force-dynamic';

export default async function TidyNotesPage() {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const { plan, bankName, bankNow, label, before } = await loadTidyPlan(supabase);
  const nothing = plan.assets.length === 0;
  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link href="/accounts">Accounts</Link> <span aria-hidden>›</span> <span>Tidy notes</span>
      </nav>
      <h1>Move bank-level notes up to the bank</h1>
      <p className="muted">
        Facts about the whole bank (minimum balance, lounge cards, no debit card) belong on the
        bank, once, not repeated on every account. Things about one account (an address change, KYC,
        a maturity instruction) stay where they are. Nothing is changed until you press the button
        below.
      </p>
      {nothing ? (
        <p className="notice ok" role="status">
          Nothing to move: no account note holds a bank-level fact that is not already on its bank.
        </p>
      ) : (
        <>
          <section className="card">
            <h2>What each bank&apos;s note will say</h2>
            <ul className="list">
              {plan.banks.map((b) => (
                <li key={b.institutionId}>
                  <strong>{bankName.get(b.institutionId)}</strong>
                  {bankNow.get(b.institutionId) ? (
                    <div className="small muted">now: {bankNow.get(b.institutionId)}</div>
                  ) : null}
                  <div>will be: {b.notes}</div>
                </li>
              ))}
              {plan.banks.length === 0 && (
                <li className="muted">
                  The banks already say all of this; only the repeats on the accounts are removed.
                </li>
              )}
            </ul>
          </section>
          <section className="card">
            <h2>{plan.assets.length} account notes will change</h2>
            <div className="xlwrap">
              <table className="tbl lines">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Note now</th>
                    <th>Note after</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.assets.map((a) => (
                    <tr key={a.assetId}>
                      <td>{label.get(a.assetId)}</td>
                      <td>{before.get(a.assetId)}</td>
                      <td>{a.notes ?? <span className="muted">(empty)</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {plan.kept.length > 0 && (
              <p className="notice warn small">
                {plan.kept.length} lines stay on their accounts because the bank note would become
                too long.
              </p>
            )}
            <form action={applyTidyNotes}>
              <button className="btn primary">Move them</button>
            </form>
          </section>
        </>
      )}
    </>
  );
}
