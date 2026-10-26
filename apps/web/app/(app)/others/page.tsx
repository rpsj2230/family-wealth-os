import Link from 'next/link';
import { personStyles } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ListingTools } from '@/components/ListingTools';
import { PageHead } from '@/components/PageHead';
import { Tabs } from '@/components/Tabs';
import { loadContext } from '@/lib/data';
import { holdingLines, loanLines, loanTotals, policyDue } from '@/lib/others-summary';
import { loadPortfolio } from '@/lib/portfolio-data';
import {
  HoldingsTab,
  LOAN_COLS,
  LoansTab,
  OthersKpis,
  POLICY_COLS,
  PoliciesTab,
  type PolicyLine,
} from './Parts';
import {
  addHolding,
  addLoan,
  addPolicy,
  recordHoldingValue,
  recordRepayment,
  setExpectedDate,
  updatePolicy,
} from './actions';

export const dynamic = 'force-dynamic';

const TABS = ['lent', 'policies', 'property'] as const;

export default async function OthersPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const sp = await searchParams;
  const tab = (TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as (typeof TABS)[number])
    : 'lent';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const [{ assetRows, obsRows, portfolio, today }, recv, pays, pol, ins, owners, settings] =
    await Promise.all([
      loadPortfolio(supabase),
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
      supabase.from('owners').select('id, display_name').order('created_at'),
      loadSettings(supabase as unknown as SupabaseClient),
    ]);
  const people = (owners.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
  }));
  const styles = personStyles(people);
  const who = new Map(people.map((o) => [o.id, o.name]));
  const todayIso = today.toISOString().slice(0, 10);
  const policyDays = settings.config.reminders.policyDays;

  const ownerOf = new Map(assetRows.map((a) => [a.id, a.owner_id]));
  const loans = loanLines(
    (recv.data ?? []).map((r) => ({
      assetId: r.asset_id as string,
      counterparty: r.counterparty as string,
      ownerId: ownerOf.get(r.asset_id as string) ?? null,
      lent: Number(r.lent),
      lentOn: (r.lent_on as string | null) ?? null,
      expectedOn: (r.expected_on as string | null) ?? null,
      repayments: (pays.data ?? [])
        .filter((p) => p.asset_id === r.asset_id)
        .map((p) => ({ amount: Number(p.amount), on: p.paid_on as string })),
    })),
    todayIso,
  );
  const insuredBy = new Map<string, string[]>();
  for (const x of ins.data ?? [])
    insuredBy.set(x.policy_id as string, [
      ...(insuredBy.get(x.policy_id as string) ?? []),
      who.get(x.owner_id as string) ?? '–',
    ]);
  const policies: PolicyLine[] = (pol.data ?? []).map((p) => ({
    id: p.id as string,
    kind: p.kind as string,
    insurer: p.insurer as string,
    coverage: (p.coverage_text as string | null) ?? null,
    paidBy: (p.paid_by as string | null) ?? null,
    renewalOn: (p.renewal_on as string | null) ?? null,
    expiresOn: (p.expires_on as string | null) ?? null,
    nominee: (p.nominee_note as string | null) ?? null,
    documents: (p.documents_note as string | null) ?? null,
    insured: insuredBy.get(p.id as string) ?? [],
  }));
  const holdings = holdingLines(
    assetRows,
    obsRows,
    new Map(portfolio.valued.map((v) => [v.assetId, v.estimate?.estimatedAmount ?? null])),
  );

  const t = loanTotals(loans);
  const dueNow = policies.filter((p) => {
    const s = policyDue(p, todayIso, policyDays).state;
    return s === 'soon' || s === 'lapsed';
  }).length;

  return (
    <>
      <PageHead
        title="Lent, policies, property"
        subtitle="Money others owe you, your insurance policies, and property and retirement holdings that are not bank or fund accounts."
        pills={[
          t.overdueCount > 0
            ? {
                label: `${t.overdueCount} loan${t.overdueCount === 1 ? '' : 's'} overdue`,
                tone: 'bad',
              }
            : { label: 'No loan overdue', tone: 'ok' },
          ...(dueNow > 0
            ? [
                {
                  label: `${dueNow} policy date${dueNow === 1 ? '' : 's'} to look at`,
                  tone: 'warn' as const,
                },
              ]
            : []),
        ]}
        actions={
          <Link className="btn" href="/emergency">
            Family emergency guide
          </Link>
        }
      />
      <OthersKpis
        loans={loans}
        policies={policies}
        holdings={holdings}
        today={todayIso}
        policyDays={policyDays}
      />
      <Tabs
        base="/others"
        current={tab}
        tabs={[
          { key: 'lent', label: 'Money lent', badge: t.overdueCount },
          { key: 'policies', label: 'Policies', badge: dueNow },
          { key: 'property', label: 'Property and other', badge: null },
        ]}
      />
      {tab === 'lent' && (
        <ListingTools name="loans" listCols={LOAN_COLS}>
          <LoansTab
            loans={loans}
            people={people}
            styles={styles}
            today={todayIso}
            actions={{ addLoan, recordRepayment, setExpectedDate }}
          />
        </ListingTools>
      )}
      {tab === 'policies' && (
        <ListingTools name="policies" listCols={POLICY_COLS}>
          <PoliciesTab
            policies={policies}
            people={people}
            today={todayIso}
            policyDays={policyDays}
            actions={{ addPolicy, updatePolicy }}
          />
        </ListingTools>
      )}
      {tab === 'property' && (
        <ListingTools name="holdings">
          <HoldingsTab
            holdings={holdings}
            people={people}
            styles={styles}
            today={todayIso}
            actions={{ addHolding, recordHoldingValue }}
          />
        </ListingTools>
      )}
    </>
  );
}
