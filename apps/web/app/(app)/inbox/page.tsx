import Link from 'next/link';
import type { AccountChoice, InboxEntry, InboxReading, SkipGroup } from '@fwos/core';
import { PageHead } from '@/components/PageHead';
import { loadAutomation } from '@/lib/automation';
import { loadContext } from '@/lib/data';
import { INBOX_TABS, InboxBoard, type InboxTab } from './Board';

export const dynamic = 'force-dynamic';

const FILTERS = ['all', 'notbalance', 'older', 'dismissed', 'problem'] as const;

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; f?: string }>;
}) {
  const sp = await searchParams;
  const tab: InboxTab = (INBOX_TABS as readonly string[]).includes(sp.tab ?? '')
    ? (sp.tab as InboxTab)
    : 'review';
  const filter = ((FILTERS as readonly string[]).includes(sp.f ?? '') ? sp.f : 'all') as
    SkipGroup | 'all';
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const iso = new Date().toISOString().slice(0, 10);

  const [msgs, assets, insts, owners, cfg, auto] = await Promise.all([
    supabase
      .from('inbox_messages')
      .select(
        'id, message_id, received_on, from_domain, subject, outcome, reason, reading, asset_id, resolved_at',
      )
      .order('created_at', { ascending: false })
      .limit(300),
    supabase
      .from('assets')
      .select('id, nickname, currency, identifier_last4, institution_id, owner_id, account_kind')
      .in('type', ['bank_account', 'third_party_held'])
      .order('nickname'),
    supabase.from('institutions').select('id, name'),
    supabase.from('owners').select('id, display_name'),
    supabase.from('integration_settings').select('ai_key_set, inbox_label').maybeSingle(),
    loadAutomation(supabase, iso),
  ]);

  // a message you applied is recognised by the balance it left behind
  const resolvedIds = (msgs.data ?? [])
    .filter((m) => m.outcome === 'needs_review' && m.resolved_at && m.reading)
    .map((m) => m.message_id as string);
  const recordedBy = new Set<string>();
  if (resolvedIds.length > 0) {
    const { data: obs } = await supabase
      .from('observations')
      .select('source_ref')
      .eq('source', 'email')
      .in(
        'source_ref',
        resolvedIds.map((x) => x.slice(0, 200)),
      );
    for (const o of obs ?? []) recordedBy.add(o.source_ref as string);
  }

  const bank = new Map((insts.data ?? []).map((i) => [i.id as string, i.name as string]));
  const who = new Map((owners.data ?? []).map((o) => [o.id as string, o.display_name as string]));
  const accounts: AccountChoice[] = (assets.data ?? []).map((a) => {
    const b = bank.get(a.institution_id as string) ?? '';
    const last4 = (a.identifier_last4 as string | null) ?? null;
    return {
      id: a.id as string,
      currency: a.currency as string,
      last4,
      bank: b,
      label: `${b ? `${b} · ` : ''}${a.nickname as string}${a.account_kind ? ` ${a.account_kind as string}` : ''}${last4 ? ` …${last4}` : ''} (${who.get(a.owner_id as string) ?? '?'})`,
    };
  });
  const entries: InboxEntry[] = (msgs.data ?? []).map((m) => ({
    id: m.id as string,
    receivedOn: (m.received_on as string | null) ?? null,
    fromDomain: (m.from_domain as string | null) ?? null,
    subject: (m.subject as string | null) ?? null,
    outcome: m.outcome as InboxEntry['outcome'],
    reason: (m.reason as string | null) ?? null,
    reading: (m.reading as InboxReading | null) ?? null,
    assetId: (m.asset_id as string | null) ?? null,
    resolvedAt: (m.resolved_at as string | null) ?? null,
    recordedByYou: recordedBy.has((m.message_id as string).slice(0, 200)),
  }));
  const settings = cfg.data as { ai_key_set?: boolean; inbox_label?: string } | null;
  const emailCard = auto.cards.find((c) => c.key === 'email');

  return (
    <>
      <PageHead
        title="Bank emails"
        subtitle="Forward bank alerts and statements to your Gmail label. Safe ones are recorded by themselves; anything uncertain waits here for you."
        pills={[
          auto.inboxWaiting > 0
            ? { label: `${auto.inboxWaiting} to review`, tone: 'warn' }
            : { label: 'Nothing to review', tone: 'ok' },
          ...(emailCard ? [{ label: `Reader: ${emailCard.status}`, tone: emailCard.tone }] : []),
        ]}
        actions={
          <Link className="btn" href="/monthly">
            Monthly update
          </Link>
        }
      />
      <InboxBoard
        base="/inbox"
        tab={tab}
        filter={filter}
        entries={entries}
        accounts={accounts}
        automation={auto.cards}
        label={settings?.inbox_label ?? 'FWOS/Inbox'}
        aiKeySet={!!settings?.ai_key_set}
      />
    </>
  );
}
