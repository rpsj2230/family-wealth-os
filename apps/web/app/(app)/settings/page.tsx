import { Suspense } from 'react';
import { configFromJson, DEFAULT_CONFIG, fyOf, profileFromJson, RULES } from '@fwos/core';
import { isAiProvider, type AiProvider } from '@fwos/ingest';
import type { AiKeyRow } from '@/lib/ai-key-view';
import type { TaxRuleRow } from '@fwos/core';
import { loadSettings } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { PageHead } from '@/components/PageHead';
import { loadContext } from '@/lib/data';
import { loadGmailModel } from '@/lib/gmail-statements-data';
import { confirmedGroups } from '@/lib/settings-fields';
import { SETTINGS_TABS, settingsTabOf, todoByTab } from '@/lib/settings-tabs';
import { loadSheetSyncInfo } from '@/lib/sheet-sync-data';
import { loadSetupStatus, setupProgress, sgToday } from '@/lib/setup-status';
import './settings.css';
import type { FlowRow, PersonRow } from './PeopleForms';
import { AnchorRedirect, SettingsNav } from './SettingsNav';
import {
  AccessSection,
  ConnectionsSection,
  NotificationsSection,
  PeopleSection,
  RulesSection,
  SetupSection,
  TaxSection,
  type DeliveryRow,
  type RateSourceRow,
  type TaxYear,
} from './sections';

export const dynamic = 'force-dynamic';
// the AI connection test and the Google Sheet test wait for those services
export const maxDuration = 60;

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const tab = settingsTabOf((await searchParams).tab);
  const { supabase, householdId } = await loadContext();
  if (!householdId) return <p>Create your household on the dashboard first.</p>;
  const db = supabase as unknown as SupabaseClient;
  const items = await loadSetupStatus(db);
  const { done, total } = setupProgress(items);
  const meta = SETTINGS_TABS.find((t) => t.key === tab)!;

  return (
    <>
      <PageHead
        title="Settings"
        subtitle="Everything you can change, one section at a time. Numbers that rules or laws can change live here, never in the code."
        pills={[
          done === total
            ? { label: 'Everything set up', tone: 'ok' }
            : { label: `${total - done} setup items open`, tone: 'warn' },
        ]}
      />
      <Suspense fallback={null}>
        <AnchorRedirect />
      </Suspense>
      <div className="setlayout">
        <SettingsNav current={tab} todo={todoByTab(items)} />
        <div className="setmain">
          <h2 className="settitle">{meta.label}</h2>
          {tab === 'setup' && <SetupSection items={items} />}
          {tab === 'people' && <PeopleTab db={db} />}
          {tab === 'rules' && <RulesTab db={db} />}
          {tab === 'tax' && <TaxTab db={db} />}
          {tab === 'notifications' && <NotificationsTab db={db} />}
          {tab === 'connections' && <ConnectionsTab db={db} />}
          {tab === 'access' && <AccessTab db={db} />}
        </div>
      </div>
    </>
  );
}

async function PeopleTab({ db }: { db: SupabaseClient }) {
  const [people, flows, fx] = await Promise.all([
    db
      .from('owners')
      .select(
        'id, display_name, dob, pan_last4, tax_residency, guardian_id, plan_role, is_minor, notes',
      )
      .order('created_at'),
    db
      .from('cashflow_items')
      .select('id, owner_id, kind, label, amount, currency, frequency')
      .order('kind')
      .order('created_at'),
    db
      .from('fx_rates')
      .select('currency, rate_date, inr_per_unit')
      .order('rate_date', { ascending: false })
      .limit(20),
  ]);
  const fxNow: Record<string, number> = { INR: 1 };
  for (const r of fx.data ?? [])
    if (!((r.currency as string) in fxNow)) fxNow[r.currency as string] = Number(r.inr_per_unit);
  const rows: PersonRow[] = (people.data ?? []).map((o) => ({
    id: o.id as string,
    name: o.display_name as string,
    dob: (o.dob as string | null) ?? '',
    panLast4: (o.pan_last4 as string | null) ?? null,
    residency: (o.tax_residency as string | null) ?? '',
    guardian: (o.guardian_id as string | null) ?? '',
    planRole: (o.plan_role as string | null) ?? '',
    isMinor: !!o.is_minor,
    notes: (o.notes as string | null) ?? '',
  }));
  const flowRows: FlowRow[] = (flows.data ?? []).map((f) => ({
    id: f.id as string,
    ownerId: (f.owner_id as string | null) ?? null,
    kind: f.kind as 'income' | 'expense',
    label: f.label as string,
    amount: Number(f.amount),
    currency: f.currency as string,
    frequency: f.frequency as 'monthly' | 'yearly',
  }));
  return <PeopleSection people={rows} flows={flowRows} fxNow={fxNow} />;
}

async function RulesTab({ db }: { db: SupabaseClient }) {
  const r = await db.from('household_config').select('config').maybeSingle();
  const raw = (r.data as { config?: unknown } | null)?.config ?? null;
  const config = configFromJson(raw);
  return <RulesSection config={config} confirmed={confirmedGroups(raw, config)} />;
}

async function TaxTab({ db }: { db: SupabaseClient }) {
  const [settings, custom] = await Promise.all([
    loadSettings(db),
    db.from('tax_rules').select('*'),
  ]);
  const customFy = new Set(((custom.data ?? []) as unknown as TaxRuleRow[]).map((c) => c.fy));
  const currentFy = fyOf(sgToday());
  const years: TaxYear[] = settings.rules.map((r) => ({
    custom: customFy.has(r.fy),
    builtin: RULES.some((b) => b.fy === r.fy),
    current: r.fy === currentFy,
    sources: customFy.has(r.fy) ? [] : r.sources,
    v: {
      fy: r.fy,
      months: r.equity.holdingMonthsLong,
      stcg: Math.round(r.equity.stcgRate * 1e4) / 100,
      ltcg: Math.round(r.equity.ltcgRate * 1e4) / 100,
      exemption: r.equity.ltcgExemption,
      cess: Math.round(r.cess * 1e4) / 100,
      verified: r.verification === 'primary',
      note: r.notes[0] ?? '',
    },
  }));
  return <TaxSection years={years} currentFy={currentFy} />;
}

async function NotificationsTab({ db }: { db: SupabaseClient }) {
  const [digest, integ, log] = await Promise.all([
    db
      .from('digest_settings')
      .select('enabled, extra_recipients, include_retirement')
      .maybeSingle(),
    db.from('integration_settings').select('telegram_set, telegram_chat_ids').maybeSingle(),
    db
      .from('digest_log')
      .select('digest_date, channel, status, recipients, error')
      .order('digest_date', { ascending: false })
      .limit(14),
  ]);
  const d = digest.data as {
    enabled: boolean;
    extra_recipients: string[];
    include_retirement: boolean;
  } | null;
  const t = integ.data as { telegram_set: boolean; telegram_chat_ids: string | null } | null;
  const deliveries: DeliveryRow[] = (log.data ?? []).map((r) => ({
    date: r.digest_date as string,
    channel: (r.channel as string | null) ?? 'email',
    status: r.status as string,
    recipients: Number(r.recipients),
    error: (r.error as string | null) ?? null,
  }));
  return (
    <NotificationsSection
      digest={{
        enabled: d?.enabled ?? false,
        extra: d?.extra_recipients ?? [],
        includeRetirement: d?.include_retirement ?? true,
      }}
      telegram={{ isSet: !!t?.telegram_set, chatIds: t?.telegram_chat_ids ?? '' }}
      deliveries={deliveries}
    />
  );
}

async function ConnectionsTab({ db }: { db: SupabaseClient }) {
  const [integ, aiKeys, sources, gsheet] = await Promise.all([
    db.from('integration_settings').select('inbox_label').maybeSingle(),
    db
      .from('ai_keys')
      .select(
        'provider, priority, enabled, label, last_ok_at, last_model, last_error_at, last_error_status, last_error, tested_at, test_ok, test_note',
      )
      .order('priority'),
    db.from('rate_sources').select('id, bank, url, last_run_on, last_result').order('bank'),
    loadSheetSyncInfo(db as unknown as Parameters<typeof loadSheetSyncInfo>[0]),
  ]);
  const gmail = await loadGmailModel(
    db as unknown as Parameters<typeof loadGmailModel>[0],
    null,
    (await loadSettings(db).catch(() => null))?.config.statementMail ??
      DEFAULT_CONFIG.statementMail,
    [],
    new Date().toISOString().slice(0, 10),
  ).catch(() => null);
  const i = integ.data as { inbox_label: string } | null;
  const keys: AiKeyRow[] = ((aiKeys.data ?? []) as unknown as Record<string, unknown>[])
    .filter((r) => isAiProvider(r.provider))
    .map((r) => ({
      provider: r.provider as AiProvider,
      priority: Number(r.priority),
      enabled: !!r.enabled,
      label: (r.label as string | null) ?? null,
      lastOkAt: (r.last_ok_at as string | null) ?? null,
      lastModel: (r.last_model as string | null) ?? null,
      lastErrorAt: (r.last_error_at as string | null) ?? null,
      lastErrorStatus: r.last_error_status === null ? null : Number(r.last_error_status),
      lastError: (r.last_error as string | null) ?? null,
      testedAt: (r.tested_at as string | null) ?? null,
      testOk: (r.test_ok as boolean | null) ?? null,
      testNote: (r.test_note as string | null) ?? null,
    }));
  const rows: RateSourceRow[] = (sources.data ?? []).map((r) => ({
    id: r.id as string,
    bank: r.bank as string,
    url: r.url as string,
    lastRunOn: (r.last_run_on as string | null) ?? null,
    lastResult: (r.last_result as string | null) ?? null,
  }));
  return (
    <ConnectionsSection
      ai={{ keys, label: i?.inbox_label ?? 'FWOS/Inbox' }}
      sources={rows}
      gsheet={gsheet}
      gmail={gmail}
    />
  );
}

async function AccessTab({ db }: { db: SupabaseClient }) {
  const [profile, access] = await Promise.all([
    db.from('emergency_profile').select('content').maybeSingle(),
    db.from('emergency_access').select('mode, inactive_days, released').maybeSingle(),
  ]);
  const a = access.data as { mode: string; inactive_days: number; released: boolean } | null;
  return (
    <AccessSection
      profile={profileFromJson((profile.data as { content: unknown } | null)?.content)}
      access={{
        mode: a?.mode === 'inactive' || a?.mode === 'manual' ? a.mode : 'always',
        days: a?.inactive_days ?? 30,
        released: !!a?.released,
      }}
    />
  );
}
