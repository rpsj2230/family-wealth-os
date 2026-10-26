import Link from 'next/link';
import { ActionForm } from '@/components/ActionForm';
import { ActivityLog } from '@/components/ActivityLog';
import { AssetFacts, DetailHeader } from '@/components/AssetFacts';
import { loadPolicyDetail } from '@/lib/detail-data';
import { POLICY_KIND } from '@/lib/others-summary';
import { savePolicy } from '../../others/actions';
import '@/app/holdings.css';

export const dynamic = 'force-dynamic';

export default async function PolicyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const d = await loadPolicyDetail(id);
  const e = d.edit;
  return (
    <>
      <DetailHeader
        crumbs={[
          { label: 'Lent, policies, property', href: '/others?tab=policies' },
          { label: 'Policy' },
        ]}
        title={d.title}
        subtitle="Cover is information only and never part of net worth. Its dates feed the reminders and the family emergency guide."
        actions={
          <Link className="btn compact" href="/others?tab=policies">
            All policies
          </Link>
        }
      />
      <AssetFacts facts={d.facts} />
      <section className="detailsection" aria-label="Change this policy">
        <details className="disclose">
          <summary>Change this policy</summary>
          <ActionForm action={savePolicy} submit="Save the policy" primary keepAfterSave>
            <input type="hidden" name="id" value={e.id} />
            <label>
              Kind
              <select name="kind" required defaultValue={e.kind}>
                {Object.entries(POLICY_KIND).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Insurer
              <input name="insurer" required maxLength={120} defaultValue={e.insurer} />
            </label>
            <label>
              Cover, in a few words
              <input name="coverage" maxLength={300} defaultValue={e.coverage} />
            </label>
            <label>
              Policy number (last 4 only)
              <input name="ref" maxLength={4} defaultValue={e.ref} />
            </label>
            <label>
              Paid by
              <input name="paid_by" maxLength={120} defaultValue={e.paidBy} />
            </label>
            <label>
              Next renewal
              <input name="renewal" type="date" defaultValue={e.renewalOn} />
            </label>
            <label>
              Policy ends
              <input name="expires" type="date" defaultValue={e.expiresOn} />
            </label>
            <label>
              Nominee (name and relationship)
              <input name="nominee" maxLength={500} defaultValue={e.nominee} />
            </label>
            <label>
              Where the documents are
              <input name="documents" maxLength={500} defaultValue={e.documents} />
            </label>
            <label>
              Notes
              <input name="notes" maxLength={500} defaultValue={e.notes} />
            </label>
            <fieldset className="insuredset">
              <legend className="small muted">Insured</legend>
              {e.people.map((p) => (
                <label key={p.id} className="check">
                  <input
                    type="checkbox"
                    name="insured"
                    value={p.id}
                    defaultChecked={e.insuredIds.includes(p.id)}
                  />{' '}
                  {p.name}
                </label>
              ))}
            </fieldset>
          </ActionForm>
        </details>
      </section>
      <ActivityLog items={d.activity} />
    </>
  );
}
