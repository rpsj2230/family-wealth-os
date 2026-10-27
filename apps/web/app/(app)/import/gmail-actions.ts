'use server';

import { revalidatePath } from 'next/cache';
import { configFromJson } from '@fwos/core';
import { mergeGroup } from '@/lib/settings-fields';
import { loadContext } from '@/lib/data';
import { scanRequestedText } from '@/lib/gmail-statements';

export interface GmailResult {
  ok: boolean | null;
  message: string;
}

const uuid = /^[0-9a-f-]{36}$/;
const REGISTRARS = ['cams', 'kfintech', 'mfcentral'];
const back = () => revalidatePath('/import');

/**
 * Scan now: leaves one waiting request (the app has no key to start a GitHub job, so the job picks the request up when it next
 * starts). Says plainly when that will be and how to run it at once.
 */
export async function requestScan(_p?: GmailResult | null, _f?: FormData): Promise<GmailResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { error } = await supabase.rpc('request_statement_scan', { p_household: householdId });
  if (error) return { ok: false, message: 'The request could not be saved. Try again.' };
  back();
  return { ok: true, message: scanRequestedText() };
}

/** The Switch off / Switch on button: Settings > Gmail statements, the first tick, changed alone. Other numbers and the list of confirmed cards stay. */
export async function setGmailEnabled(_p: GmailResult | null, f: FormData): Promise<GmailResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const on = String(f.get('enabled') ?? '') === '1';
  const r = await supabase.from('household_config').select('config').maybeSingle();
  const prior = (r.data as { config?: unknown } | null)?.config ?? null;
  const merged = mergeGroup(prior, { statementMail: { enabled: on } });
  const confirmed =
    prior &&
    typeof prior === 'object' &&
    Array.isArray((prior as { confirmed?: unknown }).confirmed)
      ? { confirmed: (prior as { confirmed: unknown[] }).confirmed }
      : {};
  const { error } = await supabase.from('household_config').upsert({
    household_id: householdId,
    config: { ...configFromJson(merged), ...confirmed },
    updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  revalidatePath('/', 'layout');
  return {
    ok: true,
    message: on
      ? 'Switched on. The next scan reads your Gmail again.'
      : 'Switched off. The app no longer opens your Gmail for statements. Nothing already imported is changed.',
  };
}

/** “I have asked”: notes that a full statement was requested on the registrar’s own page. Nothing is sent anywhere. */
export async function markRequested(_p: GmailResult | null, f: FormData): Promise<GmailResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const owner = String(f.get('owner') ?? '');
  const registrar = String(f.get('registrar') ?? '');
  if (!uuid.test(owner)) return { ok: false, message: 'Choose whose statement you asked for.' };
  if (!REGISTRARS.includes(registrar))
    return { ok: false, message: 'Choose where you asked for it.' };
  const open = await supabase
    .from('statement_requests')
    .select('id', { count: 'exact', head: true })
    .eq('owner_id', owner)
    .eq('registrar', registrar)
    .eq('status', 'asked');
  if ((open.count ?? 0) > 0)
    return { ok: true, message: 'That request is already noted and still waiting.' };
  const { error } = await supabase.from('statement_requests').insert({
    household_id: householdId,
    owner_id: owner,
    registrar,
    requested_on: new Date().toISOString().slice(0, 10),
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  back();
  return {
    ok: true,
    message:
      'Noted. Your Gmail is scanned daily; the statement is imported when it arrives, and you will see it here.',
  };
}

export async function cancelRequest(_p: GmailResult | null, f: FormData): Promise<GmailResult> {
  const { supabase } = await loadContext();
  const id = String(f.get('id') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That request could not be found.' };
  const { error } = await supabase
    .from('statement_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'asked');
  if (error) return { ok: false, message: 'That could not be saved.' };
  back();
  return { ok: true, message: 'Request removed from the list.' };
}

/**
 * Saves one extra statement password for a person (write-only: it can be added and removed, never shown or returned). The password is
 * used by the mailbox scan to open a PDF and is kept nowhere else.
 */
export async function addStatementPassword(
  _p: GmailResult | null,
  f: FormData,
): Promise<GmailResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const owner = String(f.get('owner') ?? '');
  const password = String(f.get('statementPassword') ?? '');
  if (!uuid.test(owner)) return { ok: false, message: 'Choose whose statement this is for.' };
  if (password.length < 1 || password.length > 64)
    return { ok: false, message: 'The password must be 1 to 64 characters.' };
  const { error } = await supabase.rpc('add_statement_password', {
    p_household: householdId,
    p_owner: owner,
    p_password: password,
  });
  if (error) return { ok: false, message: 'That could not be saved.' };
  back();
  return {
    ok: true,
    message:
      'Saved. It is never shown again. Press Scan now to try the statements that could not be opened.',
  };
}

export async function clearStatementPasswords(
  _p: GmailResult | null,
  f: FormData,
): Promise<GmailResult> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const owner = String(f.get('owner') ?? '');
  if (!uuid.test(owner)) return { ok: false, message: 'Choose the person first.' };
  const { error } = await supabase.rpc('clear_statement_passwords', {
    p_household: householdId,
    p_owner: owner,
  });
  if (error) return { ok: false, message: 'That could not be removed.' };
  back();
  return { ok: true, message: 'The saved statement passwords were removed.' };
}
