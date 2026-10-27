'use server';

import { revalidatePath } from 'next/cache';
import {
  configFromJson,
  fyBoundsOf,
  LIQUIDITY_KINDS,
  parseContactLines,
  profileFromJson,
} from '@fwos/core';
import {
  buildRatesRequest,
  checkRateSource,
  parseRatesResponse,
  prepareAi,
  testAiConnection,
  type AiProvider,
  type RateCheck,
} from '@fwos/ingest';
import { loadSettings, saveRatesRead } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { CONFIG_GROUPS, mergeGroup, parseGroup, withConfirmed } from '@/lib/settings-fields';

const EMAIL = /^[^@\s,]+@[^@\s,]+\.[^@\s,]+$/;

export interface FormResult {
  ok: boolean;
  message: string;
}

export async function saveDigestSettings(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const enabled = f.get('enabled') === 'on';
  const includeRetirement = f.get('include_retirement') === 'on';
  const typed = String(f.get('extra') ?? '')
    .split(/[\s,;]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  const extra = typed.filter((e) => EMAIL.test(e));
  if (extra.length < typed.length)
    return {
      ok: false,
      message: `Not saved: “${typed.find((e) => !EMAIL.test(e))}” is not an e-mail address.`,
    };
  if (extra.length > 5) return { ok: false, message: 'Not saved: at most five extra addresses.' };
  const { error } = await supabase.from('digest_settings').upsert({
    household_id: householdId,
    enabled,
    extra_recipients: [...new Set(extra)],
    include_retirement: includeRetirement,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  return {
    ok: true,
    message: enabled
      ? 'Saved. The summary e-mail goes out every morning at 08:30 Singapore time.'
      : 'Saved. The summary e-mail is switched off.',
  };
}

/** The AI key is write-only: it is saved here and read back only by the scheduled reader. */
export async function saveIntegrations(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const provider = String(f.get('provider') ?? '');
  const key = String(f.get('key') ?? '').trim();
  const clear = f.get('clear') === 'on';
  if (key !== '' && (key.length < 8 || key.length > 300))
    return { ok: false, message: 'That does not look like an API key. Paste the whole key.' };
  const label =
    String(f.get('label') ?? '')
      .trim()
      .slice(0, 100) || 'FWOS/Inbox';
  const { error } = await supabase.rpc('save_integrations', {
    p_household: householdId,
    p_provider:
      provider === 'anthropic' ||
      provider === 'groq' ||
      provider === 'gemini' ||
      provider === 'openrouter'
        ? provider
        : null,
    p_key: key === '' ? null : key,
    p_label: label,
    p_clear: clear,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  revalidatePath('/inbox');
  return {
    ok: true,
    message: clear
      ? 'Saved. The AI key is removed.'
      : key
        ? 'Saved. The key is stored on the server and will not be shown again.'
        : 'Saved.',
  };
}

export interface AiTestState {
  ran: boolean;
  ok: boolean;
  steps: { ok: boolean; text: string }[];
  ms: number;
}

/**
 * Tests the saved AI key: the provider answers and a made-up bank alert is read back correctly. The key is fetched through a
 * member-only function, used once on the server and never returned; only the outcome goes to the page.
 */
export async function testAi(): Promise<AiTestState> {
  const { supabase, householdId } = await loadContext();
  const fail = (text: string): AiTestState => ({
    ran: true,
    ok: false,
    steps: [{ ok: false, text }],
    ms: 0,
  });
  if (!householdId) return fail('Create your household first.');
  const { data, error } = await supabase.rpc('ai_credentials_for_test', {
    p_household: householdId,
  });
  const row = (data as { provider: AiProvider; api_key: string }[] | null)?.[0];
  if (error) return fail('The saved key could not be read for the test.');
  if (!row) return fail('No AI key is saved. Choose a service, paste a key and press Save first.');
  const r = await testAiConnection({
    provider: row.provider,
    key: row.api_key,
    today: new Date().toISOString().slice(0, 10),
    // the page waits for this: keep it well inside the time the host allows
    limits: { listMs: 12_000, callMs: 15_000, tries: 3 },
  });
  await supabase.rpc('record_ai_test', {
    p_household: householdId,
    p_ok: r.ok,
    p_note: (r.ok
      ? `Read a test alert with ${r.model ?? row.provider}`
      : (r.steps.find((x) => !x.ok)?.text ?? 'Failed')
    ).slice(0, 300),
  });
  revalidatePath('/settings');
  return { ran: true, ok: r.ok, steps: r.steps, ms: r.ms };
}

/**
 * Can this bank's rate page be synced? Reads the page and asks the saved AI to find the rates, then says what happened. Nothing is saved.
 * The key is fetched through the same member-only function as the AI test and never leaves the server.
 */
export async function checkRatePage(sourceId: string): Promise<RateCheck> {
  const fail = (text: string): RateCheck => ({
    ok: false,
    verdict: text,
    steps: [{ ok: false, text }],
    found: 0,
    ms: 0,
  });
  if (!/^[0-9a-f-]{36}$/.test(sourceId)) return fail('Unknown page.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const src = await supabase
    .from('rate_sources')
    .select('bank, url')
    .eq('id', sourceId)
    .maybeSingle();
  const row = src.data as { bank: string; url: string } | null;
  if (!row) return fail('This page is no longer in the list.');
  const { data } = await supabase.rpc('ai_credentials_for_test', { p_household: householdId });
  const cred = (data as { provider: AiProvider; api_key: string }[] | null)?.[0] ?? null;
  const maxAmount = (await loadSettings(supabase as unknown as SupabaseClient)).config.rates
    .maxAmount;
  return checkRateSource({
    maxAmount,
    bank: row.bank,
    url: row.url,
    ai: cred ? { provider: cred.provider, key: cred.api_key } : null,
    // the page waits for this: the host allows 60 seconds in all
    limits: { listMs: 8_000, callMs: 30_000, tries: 2 },
    pageMs: 12_000,
  });
}

export interface PasteResult {
  ok: boolean;
  message: string;
}

/**
 * Reads rates from text you copied from the bank's page in your own browser (open the page, select all, copy, paste here). For banks
 * that do not let a program open their page. The AI finds the rates in the text and they are stored like a refreshed page; a rate you
 * typed yourself is never overwritten.
 */
export async function readPastedRatePage(sourceId: string, text: string): Promise<PasteResult> {
  const fail = (message: string): PasteResult => ({ ok: false, message });
  if (!/^[0-9a-f-]{36}$/.test(sourceId)) return fail('Unknown page.');
  const pasted = text.replace(/\s+/g, ' ').trim();
  if (pasted.length < 200)
    return fail(
      'Paste the whole page: open it in your browser, press Ctrl+A (Cmd+A on a Mac), then Ctrl+C, and paste here. What was pasted is too short to hold a rate table.',
    );
  const { supabase, householdId } = await loadContext();
  if (!householdId) return fail('Create your household first.');
  const src = await supabase
    .from('rate_sources')
    .select('id, bank, url')
    .eq('id', sourceId)
    .maybeSingle();
  const row = src.data as { id: string; bank: string; url: string } | null;
  if (!row) return fail('This page is no longer in the list.');
  const { data } = await supabase.rpc('ai_credentials_for_test', { p_household: householdId });
  const cred = (data as { provider: AiProvider; api_key: string }[] | null)?.[0];
  if (!cred) return fail('No AI key is saved. Add one under Bank emails and AI first.');
  const today = new Date().toISOString().slice(0, 10);
  const note = async (result: string) => {
    await supabase
      .from('rate_sources')
      .update({ last_run_on: today, last_result: result.slice(0, 300) })
      .eq('id', row.id);
    revalidatePath('/settings');
    revalidatePath('/rates');
  };
  try {
    const maxAmount = (await loadSettings(supabase as unknown as SupabaseClient)).config.rates
      .maxAmount;
    const rt = await prepareAi(cred.provider, cred.api_key, {
      listMs: 8_000,
      callMs: 30_000,
      tries: 2,
    });
    const hints = await supabase
      .from('rate_hints')
      .select('hint')
      .eq('active', true)
      .eq('bank', row.bank)
      .limit(20);
    const req = buildRatesRequest(
      cred.provider,
      cred.api_key,
      row.bank,
      `### ${row.bank}: text pasted by the account holder from the bank's page\n${pasted.slice(0, 60_000)}`,
      rt.model || undefined,
      ((hints.data ?? []) as { hint: string }[]).map((h) => h.hint),
      maxAmount,
    );
    const res = await rt.call(req.url, req.init as unknown as Record<string, unknown>);
    if (!res.ok) {
      const msg = `The AI service answered ${res.status}. Try again in a minute.`;
      await note(`pasted page not read: ${msg}`);
      return fail(msg);
    }
    const read = parseRatesResponse(cred.provider, await res.json(), row.bank, { maxAmount });
    if (read.length === 0) {
      const msg =
        'No rates could be found in the pasted text. Check it is the page with the rate table.';
      await note(`pasted page not read: ${msg}`);
      return fail(msg);
    }
    const summary = await saveRatesRead({
      db: supabase as unknown as SupabaseClient,
      household: householdId,
      bank: row.bank,
      read,
      heldNames: [],
      today,
      thirdParty: false,
      sourceUrl: row.url,
      sourceNote: `Pasted by you from the bank's page on ${today}`,
    });
    await note(`pasted by you: ${summary}`);
    return { ok: true, message: `Saved: ${summary}.` };
  } catch (e) {
    const msg = `Could not read the pasted page (${(e as Error).message}).`;
    await note(`pasted page not read: ${msg}`);
    return fail(msg);
  }
}

const uuid = /^[0-9a-f-]{36}$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const field = (f: FormData, k: string) => String(f.get(k) ?? '').trim();
const numeric = (f: FormData, k: string) => {
  const v = field(f, k).replace(/[₹,\s]/g, '');
  return /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : null;
};
const pct = (f: FormData, k: string) => {
  const n = numeric(f, k.replace(/%$/, ''));
  return n === null ? null : n / 100;
};

/** A person's profile: date of birth, PAN (write-only), residency, guardian, role in the retirement plan. */
export async function saveOwnerProfile(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const owner = field(f, 'owner');
  if (!uuid.test(owner)) return { ok: false, message: 'Unknown person.' };
  const dob = field(f, 'dob');
  if (dob && (!isoDate.test(dob) || dob > new Date().toISOString().slice(0, 10)))
    return { ok: false, message: 'Enter a valid date of birth.' };
  const pan = field(f, 'pan').toUpperCase();
  if (pan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan))
    return { ok: false, message: 'A PAN looks like ABCDE1234F.' };
  const guardian = field(f, 'guardian');
  const role = field(f, 'planRole');
  const payload: Record<string, unknown> = {
    dob,
    taxResidency: field(f, 'residency'),
    guardianId: uuid.test(guardian) ? guardian : '',
    planRole: role === 'primary' || role === 'spouse' ? role : '',
    isMinor: f.get('minor') === 'on',
    notes: field(f, 'notes').slice(0, 500),
  };
  if (pan) payload.pan = pan;
  if (f.get('clearPan') === 'on') payload.clearPan = true;
  const { error } = await supabase.rpc('save_owner_profile', {
    p_household: householdId,
    p_owner: owner,
    p: payload,
  });
  if (error)
    return {
      ok: false,
      message: /primary|spouse|unique/i.test(error.message)
        ? 'Only one person can be the primary and one the spouse.'
        : 'That could not be saved.',
    };
  revalidatePath('/settings');
  revalidatePath('/retire');
  return { ok: true, message: 'Saved.' };
}

export async function addCashflow(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const kind = field(f, 'kind');
  const label = field(f, 'label').slice(0, 80);
  const amount = numeric(f, 'amount');
  const currency = field(f, 'currency').toUpperCase() || 'INR';
  const owner = field(f, 'owner');
  if (!['income', 'expense'].includes(kind) || !label || amount === null || amount < 0)
    return { ok: false, message: 'Enter a label and an amount.' };
  if (!/^[A-Z]{3}$/.test(currency))
    return { ok: false, message: 'Currency is three letters, for example SGD.' };
  const { error } = await supabase.from('cashflow_items').insert({
    household_id: householdId,
    kind,
    label,
    amount,
    currency,
    frequency: field(f, 'frequency') === 'yearly' ? 'yearly' : 'monthly',
    owner_id: uuid.test(owner) ? owner : null,
    starts_on: isoDate.test(field(f, 'from')) ? field(f, 'from') : null,
    ends_on: isoDate.test(field(f, 'to')) ? field(f, 'to') : null,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Added.' };
}

/** Change the amount, currency or frequency of an income or spending line without removing it. */
export async function updateCashflow(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const id = field(f, 'id');
  const amount = numeric(f, 'amount');
  const currency = field(f, 'currency').toUpperCase();
  if (!uuid.test(id)) return { ok: false, message: 'Unknown line.' };
  if (amount === null || amount < 0) return { ok: false, message: 'Enter the amount as a number.' };
  if (!/^[A-Z]{3}$/.test(currency))
    return { ok: false, message: 'Currency is three letters, for example SGD.' };
  const { error } = await supabase
    .from('cashflow_items')
    .update({
      amount,
      currency,
      frequency: field(f, 'frequency') === 'yearly' ? 'yearly' : 'monthly',
    })
    .eq('id', id);
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Saved.' };
}

export async function deleteCashflow(f: FormData): Promise<void> {
  const id = field(f, 'id');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('cashflow_items').delete().eq('id', id);
  revalidatePath('/settings');
}

async function readConfig(supabase: Awaited<ReturnType<typeof loadContext>>['supabase']) {
  const r = await supabase.from('household_config').select('config').maybeSingle();
  return (r.data as { config?: unknown } | null)?.config ?? null;
}

/**
 * One card of Money rules. Only that card's numbers change; the other cards, the "I need money" choices and the list of cards
 * you have confirmed are kept. A box that is not a number is reported by name, never replaced by the built-in value.
 */
export async function saveConfigGroup(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const group = CONFIG_GROUPS.find((g) => g.key === field(f, 'group'));
  if (!group) return { ok: false, message: 'Unknown group of rules.' };
  const parsed = parseGroup(group, (n) => (f.get(n) === null ? null : String(f.get(n))));
  if (!parsed.ok) return { ok: false, message: parsed.message };
  const prior = await readConfig(supabase);
  const doc = withConfirmed(
    configFromJson(mergeGroup(prior, parsed.raw)),
    prior,
    configFromJson(prior),
    group.key,
  );
  const { error } = await supabase
    .from('household_config')
    .upsert({ household_id: householdId, config: doc, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: `Saved. ${group.title} now uses these numbers everywhere.` };
}

/** Tax rules for one financial year; they replace the built-in numbers for that year. */
export async function saveTaxRule(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const fy = field(f, 'fy');
  if (!fyBoundsOf(fy)) return { ok: false, message: 'Financial year looks like 2027-28.' };
  const months = numeric(f, 'months');
  const stcg = pct(f, 'stcg');
  const ltcg = pct(f, 'ltcg');
  const ex = numeric(f, 'exemption');
  const cess = pct(f, 'cess');
  if (
    months === null ||
    months < 1 ||
    months > 60 ||
    stcg === null ||
    stcg < 0 ||
    stcg >= 1 ||
    ltcg === null ||
    ltcg < 0 ||
    ltcg >= 1 ||
    ex === null ||
    ex < 0 ||
    cess === null ||
    cess < 0 ||
    cess >= 1
  )
    return {
      ok: false,
      message: 'Check the numbers: months 1–60, rates between 0 and 100%, allowance zero or more.',
    };
  const { error } = await supabase.from('tax_rules').upsert({
    household_id: householdId,
    fy,
    holding_months_long: Math.round(months),
    stcg_rate: stcg,
    ltcg_rate: ltcg,
    ltcg_exemption: ex,
    cess,
    verified: f.get('verified') === 'on',
    source_note: field(f, 'note').slice(0, 300) || null,
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: `Tax rules for ${fy} saved.` };
}

export async function resetTaxRule(f: FormData): Promise<void> {
  const fy = field(f, 'fy');
  if (!fyBoundsOf(fy)) return;
  const { supabase } = await loadContext();
  await supabase.from('tax_rules').delete().eq('fy', fy);
  revalidatePath('/', 'layout');
}

export async function addRateSource(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const bank = field(f, 'bank').slice(0, 80);
  const url = field(f, 'url');
  if (!bank || !/^https:\/\/[^\s]+$/.test(url) || url.length > 500)
    return {
      ok: false,
      message: 'Enter the bank and the full address of its rate page, starting with https://',
    };
  const { error } = await supabase
    .from('rate_sources')
    .insert({ household_id: householdId, bank, url });
  if (error) return { ok: false, message: 'That page is already listed, or could not be saved.' };
  revalidatePath('/settings');
  return { ok: true, message: 'Added. It is read at the next weekly refresh.' };
}

export async function deleteRateSource(f: FormData): Promise<void> {
  const id = field(f, 'id');
  if (!uuid.test(id)) return;
  const { supabase } = await loadContext();
  await supabase.from('rate_sources').delete().eq('id', id);
  revalidatePath('/settings');
}

/** When the read-only family login may open the handbook. */
export async function saveEmergencyAccess(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const mode = ['always', 'inactive', 'manual'].find((m) => m === f.get('mode')) ?? 'always';
  const asked = numeric(f, 'days');
  if (mode === 'inactive' && (asked === null || asked < 7 || asked > 365))
    return { ok: false, message: 'Days of absence: a whole number from 7 to 365.' };
  const days = Math.min(365, Math.max(7, Math.round(asked ?? 30)));
  const intent = field(f, 'intent');
  const row: Record<string, unknown> = {
    household_id: householdId,
    mode,
    inactive_days: days,
    updated_at: new Date().toISOString(),
  };
  if (intent === 'release') row.released = true;
  if (intent === 'lock') row.released = false;
  const { error } = await supabase
    .from('emergency_access')
    .upsert(row, { onConflict: 'household_id' });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/settings');
  revalidatePath('/emergency');
  return {
    ok: true,
    message:
      intent === 'release'
        ? 'Released. The read-only family login can open the handbook now.'
        : intent === 'lock'
          ? 'Locked again. The family login follows the rule above.'
          : 'Saved.',
  };
}

/** Information the family needs that is not a balance: contacts, where documents are, a message. */
export async function saveEmergencyProfile(
  _p: FormResult | null,
  f: FormData,
): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const clean = profileFromJson({
    message: field(f, 'message'),
    contacts: parseContactLines(String(f.get('contacts') ?? '')),
    advisors: parseContactLines(String(f.get('advisors') ?? '')),
    willLocation: field(f, 'willLocation'),
    documentsLocation: field(f, 'documentsLocation'),
    passwordManager: field(f, 'passwordManager'),
    devices: field(f, 'devices'),
    emailAccounts: field(f, 'emailAccounts'),
    lockerDetails: field(f, 'lockerDetails'),
    backupKeyLocation: field(f, 'backupKeyLocation'),
    nominees: field(f, 'nominees'),
    instructions: field(f, 'instructions'),
  });
  const { error } = await supabase
    .from('emergency_profile')
    .upsert({ household_id: householdId, content: clean, updated_at: new Date().toISOString() });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/emergency');
  revalidatePath('/settings');
  return { ok: true, message: 'Saved. The handbook now includes this.' };
}

/** How the "I need money" planner chooses: which kinds of money it may use, in what order, and what each costs. */
export async function saveLiquidity(_p: FormResult | null, f: FormData): Promise<FormResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const order = LIQUIDITY_KINDS.map((k, i) => ({
    k,
    i,
    on: f.get(`on_${k}`) === 'on',
    p: numeric(f, `pri_${k}`) ?? i + 1,
  }))
    .filter((x) => x.on)
    .sort((a, b) => a.p - b.p || a.i - b.i)
    .map((x) => x.k);
  const days = field(f, 'scenarioDays')
    .split(/[\s,;]+/)
    .filter(Boolean)
    .map(Number);
  if (days.length === 0 || days.some((d) => !Number.isInteger(d) || d < 0 || d > 1095))
    return {
      ok: false,
      message: 'Deadlines: whole numbers of days from 0 to 1095, separated by commas.',
    };
  const needed: [string, string][] = [
    ['keepInBank', 'Leave in each savings account'],
    ['fdPenalty', 'Interest lost when a deposit is broken early'],
    ['recentFdDays', 'Days a deposit counts as recently added'],
    ['fdBreakDays', 'Days for a broken deposit to reach the bank'],
    ['mfDays', 'Working days from selling a fund'],
    ['stockDays', 'Working days from selling shares'],
    ['foreignDays', 'Days to convert a foreign-currency balance'],
    ['exitLoad', 'Exit load on a recent fund sale'],
    ['gainShare', 'Gain assumed when the cost is not recorded'],
    ['propDays', 'Days to sell a property'],
    ['propCost', 'Selling costs of a property'],
    ['recvDays', 'Days to collect money lent out'],
  ];
  const bad = needed.find(([k]) => numeric(f, k) === null);
  if (bad) return { ok: false, message: `${bad[1]}: enter a number.` };
  const prior = await readConfig(supabase);
  const clean = configFromJson({
    ...(prior as Record<string, unknown> | null),
    liquidity: {
      order,
      mode: field(f, 'mode'),
      keepInBank: numeric(f, 'keepInBank'),
      fdPenaltyPoints: pct(f, 'fdPenalty'),
      fdPartialBreak: f.get('fdPartial') === 'on',
      recentFdDays: numeric(f, 'recentFdDays'),
      fdBreakDays: numeric(f, 'fdBreakDays'),
      mfSettlementDays: numeric(f, 'mfDays'),
      stockSettlementDays: numeric(f, 'stockDays'),
      foreignCashDays: numeric(f, 'foreignDays'),
      exitLoadPct: pct(f, 'exitLoad'),
      assumedGainShare: pct(f, 'gainShare'),
      propertySaleDays: numeric(f, 'propDays'),
      propertyCostPct: pct(f, 'propCost'),
      receivableDays: numeric(f, 'recvDays'),
      scenarioDays: days,
    },
  });
  const { error } = await supabase.from('household_config').upsert({
    household_id: householdId,
    config: withConfirmed(clean, prior, configFromJson(prior), 'liquidity'),
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return { ok: true, message: 'Saved. The "I need money" page now follows these choices.' };
}
