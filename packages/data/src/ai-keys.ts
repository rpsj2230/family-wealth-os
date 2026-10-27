import {
  createAiChain,
  isAiProvider,
  orderedEnabled,
  type AiChain,
  type AiChainDeps,
  type AiProvider,
  type AiUsageEvent,
  type AiUse,
  type StoredAiKey,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * The household's AI keys for server code. The keys are write-only for the app's users, so there are two ways in:
 *  - 'service': the scheduled jobs (service-role client) read and update the table directly, scoped to one household;
 *  - 'member':  the Settings actions (a signed-in member's client) go through functions that check membership.
 * A key is handed to the code that asks the AI and never returned to a page or written to a log.
 */
export type AiKeyAccess = 'service' | 'member';

/** The saved keys in the order they are tried, with their switch. `all` includes the ones switched off (to test a single key). */
export async function loadStoredAiKeys(
  db: SupabaseClient,
  household: string,
  access: AiKeyAccess,
  opts: { all?: boolean } = {},
): Promise<StoredAiKey[]> {
  type Row = { provider: string; api_key: string; priority: number; enabled: boolean };
  let rows: Row[];
  if (access === 'service') {
    const r = await db
      .from('ai_keys')
      .select('provider, api_key, priority, enabled')
      .eq('household_id', household)
      .order('priority');
    if (r.error) throw new Error('The saved AI keys could not be read.');
    rows = (r.data ?? []) as Row[];
  } else {
    const r = await db.rpc('ai_keys_for_server', { p_household: household, p_all: !!opts.all });
    if (r.error) throw new Error('The saved AI keys could not be read.');
    rows = (r.data ?? []) as Row[];
  }
  return rows
    .filter((r): r is Row & { provider: AiProvider } => isAiProvider(r.provider))
    .map((r) => ({
      provider: r.provider,
      key: r.api_key,
      priority: Number(r.priority),
      enabled: r.enabled,
    }))
    .filter((r) => opts.all || r.enabled);
}

/** Remembers on the key what a real use did: when it last worked, or why and when it last failed. */
export async function recordAiUse(
  db: SupabaseClient,
  household: string,
  access: AiKeyAccess,
  use: AiUse,
): Promise<void> {
  if (access === 'member') {
    await db.rpc('record_ai_key_use', {
      p_household: household,
      p_provider: use.provider,
      p_ok: use.ok,
      p_status: use.status,
      p_reason: use.reason,
      p_model: use.model,
    });
    return;
  }
  const now = new Date().toISOString();
  await db
    .from('ai_keys')
    .update(
      use.ok
        ? { last_ok_at: now, last_model: use.model?.slice(0, 100) ?? null }
        : {
            last_error_at: now,
            last_error_status: Math.max(0, Math.min(use.status, 999)),
            last_error: (use.reason ?? '').slice(0, 300),
          },
    )
    .eq('household_id', household)
    .eq('provider', use.provider);
}

/** Remembers on the key how its last test went. */
export async function recordAiTest(
  db: SupabaseClient,
  household: string,
  access: AiKeyAccess,
  provider: AiProvider,
  ok: boolean,
  note: string,
): Promise<void> {
  if (access === 'member') {
    await db.rpc('record_ai_key_test', {
      p_household: household,
      p_provider: provider,
      p_ok: ok,
      p_note: note,
    });
    return;
  }
  await db
    .from('ai_keys')
    .update({ tested_at: new Date().toISOString(), test_ok: ok, test_note: note.slice(0, 300) })
    .eq('household_id', household)
    .eq('provider', provider);
}

/** Logs one real call for the AI cost page: which service and model, what it was for, and the tokens it used. Never the text or the key. */
export async function recordAiUsage(
  db: SupabaseClient,
  household: string,
  access: AiKeyAccess,
  e: AiUsageEvent,
): Promise<void> {
  const t = e.tokens;
  if (access === 'member') {
    await db.rpc('record_ai_usage', {
      p_household: household,
      p_provider: e.provider,
      p_model: e.model,
      p_purpose: e.purpose,
      p_ok: e.ok,
      p_status: e.status,
      p_input: t?.input ?? 0,
      p_output: t?.output ?? 0,
      p_cache_read: t?.cacheRead ?? 0,
      p_cache_write: t?.cacheWrite ?? 0,
      p_known: !!t,
      p_ms: e.ms,
      p_note: e.note,
    });
    return;
  }
  await db.from('ai_usage').insert({
    household_id: household,
    provider: e.provider,
    model: e.model?.slice(0, 120) ?? null,
    purpose: e.purpose,
    ok: e.ok,
    status: Math.max(0, Math.min(e.status, 999)),
    input_tokens: t?.input ?? 0,
    output_tokens: t?.output ?? 0,
    cache_read_tokens: t?.cacheRead ?? 0,
    cache_write_tokens: t?.cacheWrite ?? 0,
    tokens_known: !!t,
    ms: Math.max(0, Math.round(e.ms)),
    note: e.note?.slice(0, 200) ?? null,
  });
}

/**
 * The chain of keys switched on, first choice first, wired to remember every real use on its key. Empty when no key is switched on
 * (the callers then say so in their own words).
 */
export async function aiChainFor(
  db: SupabaseClient,
  household: string,
  access: AiKeyAccess,
  deps: Omit<AiChainDeps, 'record' | 'usage'> = {},
): Promise<AiChain> {
  const rows = await loadStoredAiKeys(db, household, access);
  return createAiChain(orderedEnabled(rows), {
    ...deps,
    record: (use) => recordAiUse(db, household, access, use),
    usage: (e) => recordAiUsage(db, household, access, e),
  });
}
