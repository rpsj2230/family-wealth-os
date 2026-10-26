import Link from 'next/link';
import type { Handbook } from '@fwos/core';
import { buildHandbookDoc } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadAccess } from '@/lib/data';
import { PrintButton } from './PrintButton';
import { refreshHandbook } from './actions';

export const dynamic = 'force-dynamic';

const when = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });

export default async function EmergencyPage() {
  const { supabase, householdId, role } = await loadAccess();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const isMember = role === 'admin' || role === 'member';
  if (!isMember) {
    const { data: st } = await supabase.rpc('emergency_status', { h: householdId });
    const status = st as {
      open: boolean;
      mode: string;
      inactiveDays: number;
      daysUntilOpen: number | null;
    } | null;
    if (status && !status.open)
      return (
        <>
          <h1>Family handbook</h1>
          <p className="notice warn">
            The handbook is locked for now.{' '}
            {status.mode === 'inactive'
              ? `It opens by itself when nobody from the household has signed in for ${status.inactiveDays} days${status.daysUntilOpen !== null ? ` (about ${status.daysUntilOpen} days from now if that stays so)` : ''}.`
              : 'A family member has to release it first.'}{' '}
            If something has happened, ask a trusted adult or the people listed on the paper copy.
          </p>
        </>
      );
  }
  let row = (
    await supabase.from('emergency_documents').select('content, generated_at').maybeSingle()
  ).data as { content: Handbook; generated_at: string } | null;
  // a member opening the page always sees a fresh handbook; the viewer sees the stored one
  if (isMember && (!row || Date.now() - Date.parse(row.generated_at) > 6 * 3_600_000)) {
    try {
      const doc = await buildHandbookDoc(supabase as unknown as SupabaseClient);
      await supabase.rpc('save_emergency_document', { p_household: householdId, p_content: doc });
      row = { content: doc, generated_at: new Date().toISOString() };
    } catch {
      /* show the stored one */
    }
  }
  if (!row)
    return (
      <>
        <h1>Family handbook</h1>
        <p className="notice warn">
          The handbook has not been created yet. A family member with full access can open this page
          to create it.
        </p>
      </>
    );
  const doc = row.content;

  return (
    <>
      <div className="noprint row" style={{ alignItems: 'center' }}>
        <h1 style={{ marginRight: 'auto' }}>{doc.title}</h1>
        {isMember && (
          <form action={refreshHandbook}>
            <button className="btn compact">Update now</button>
          </form>
        )}
        <PrintButton />
      </div>
      <p className="notice warn small">
        {doc.disclaimer} Last updated {when(row.generated_at)}.
      </p>
      <nav className="chipbar small noprint" aria-label="Sections">
        {doc.sections.map((s, i) => (
          <a key={s.id} className="fchip" href={`#${s.id}`}>
            {i + 1}. {s.title}
          </a>
        ))}
      </nav>
      {isMember && (
        <p className="small noprint">
          Missing contacts, locations or nominees? Add them in{' '}
          <Link href="/settings#emergency">Settings &gt; Emergency information</Link>; the handbook
          rewrites itself.
        </p>
      )}

      {doc.sections.map((s, i) => (
        <section className="card handbook" id={s.id} key={s.id}>
          <h2>
            {i + 1}. {s.title}
          </h2>
          {s.intro && <p className="muted">{s.intro}</p>}
          {s.paragraphs?.map((p, k) => (
            <p key={k}>{p}</p>
          ))}
          {s.steps && (
            <ol className="steps">
              {s.steps.map((t, k) => (
                <li key={k}>
                  <span className="box" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          )}
          {s.tables?.map((t, k) => (
            <div key={k}>
              {t.title && <h3>{t.title}</h3>}
              <div className="xlwrap">
                <table className="xl hb">
                  <thead>
                    <tr>
                      {t.table.headers.map((h) => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {t.table.rows.map((r, a) => (
                      <tr key={a} className="xlrow">
                        {r.map((c, b) => (
                          <td key={b}>{c}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {t.table.note && <p className="muted small">{t.table.note}</p>}
            </div>
          ))}
        </section>
      ))}
    </>
  );
}
