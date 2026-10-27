import { buildAutomationCards, type AutomationCard } from '@fwos/core';
import type { Ctx } from './data';

type Db = Ctx['supabase'];

/** Reads what the scheduled jobs left behind and turns it into status cards. Every query is small; a failed one only blanks its own card. */
export async function loadAutomation(
  db: Db,
  today: string,
): Promise<{ cards: AutomationCard[]; inboxWaiting: number; aiReady: boolean }> {
  const weekAgo = new Date(Date.parse(`${today}T00:00:00Z`) - 7 * 86_400_000).toISOString();
  const [latest, week, waiting, settings, aiOn, digestSet, digestLog, nav, fx, rates] =
    await Promise.all([
      db
        .from('inbox_messages')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1),
      db.from('inbox_messages').select('outcome').gte('created_at', weekAgo).limit(1000),
      db
        .from('inbox_messages')
        .select('id', { count: 'exact', head: true })
        .eq('outcome', 'needs_review')
        .is('resolved_at', null),
      db.from('integration_settings').select('inbox_label').maybeSingle(),
      db.from('ai_keys').select('provider', { count: 'exact', head: true }).eq('enabled', true),
      db.from('digest_settings').select('enabled').maybeSingle(),
      db
        .from('digest_log')
        .select('digest_date, status, channel, recipients, error')
        .order('digest_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1),
      db.from('mf_navs').select('nav_date').order('nav_date', { ascending: false }).limit(1),
      db
        .from('fx_rates')
        .select('rate_date')
        .eq('currency', 'SGD')
        .order('rate_date', { ascending: false })
        .limit(1),
      db.from('rate_sources').select('last_run_on').eq('enabled', true),
    ]);
  const w = { applied: 0, needs_review: 0, ignored: 0, error: 0 };
  for (const r of week.data ?? []) {
    const o = r.outcome as keyof typeof w;
    if (o in w) w[o]++;
  }
  const d = digestLog.data?.[0];
  const rateRows = rates.data ?? [];
  const lastRun = rateRows.reduce<string | null>((m, r) => {
    const v = r.last_run_on as string | null;
    return v && (!m || v > m) ? v : m;
  }, null);
  const cfg = settings.data as { inbox_label?: string } | null;
  const aiReady = (aiOn.count ?? 0) > 0;
  const inboxWaiting = waiting.count ?? 0;
  const cards = buildAutomationCards({
    today,
    inbox: {
      lastLoggedAt: (latest.data?.[0]?.created_at as string | undefined) ?? null,
      week: w,
      waiting: inboxWaiting,
      aiReady,
      label: cfg?.inbox_label ?? 'FWOS/Inbox',
    },
    market: {
      navLatest: (nav.data?.[0]?.nav_date as string | undefined) ?? null,
      fxLatest: (fx.data?.[0]?.rate_date as string | undefined) ?? null,
    },
    digest: {
      enabled: !!(digestSet.data as { enabled?: boolean } | null)?.enabled,
      last: d
        ? {
            date: d.digest_date as string,
            status: d.status as 'sending' | 'accepted_by_provider' | 'failed',
            channel: d.channel as string,
            recipients: Number(d.recipients ?? 0),
            error: (d.error as string | null) ?? null,
          }
        : null,
    },
    rates: { sources: rateRows.length, lastRunOn: lastRun },
  });
  return { cards, inboxWaiting, aiReady };
}
