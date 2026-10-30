'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { supabaseEnv } from '@/lib/supabase/env';

/** A link token as the daily job makes it (base64url, 43 characters); anything else is refused before the database is asked. */
const TOKEN = /^[A-Za-z0-9_-]{32,128}$/;

async function call(fn: 'confirm_emergency_alert' | 'postpone_emergency_alert', token: string) {
  if (!TOKEN.test(token) || !supabaseEnv()) return false;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc(fn, { p_token: token });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * "I have received this": marks one person's message as received (confirm_emergency_alert), which stops the chain. A button press,
 * never the page load, so a mail scanner that opens links does not confirm for the person.
 */
export async function confirmAlert(f: FormData): Promise<void> {
  const token = String(f.get('token') ?? '');
  const ok = await call('confirm_emergency_alert', token);
  redirect(
    `/confirm/${encodeURIComponent(TOKEN.test(token) ? token : 'x')}?${ok ? 'done' : 'bad'}=1`,
  );
}

/** "I'm fine — postpone": counts as a member using the portal (postpone_emergency_alert). A button press, for the same reason. */
export async function postponeAlert(f: FormData): Promise<void> {
  const token = String(f.get('token') ?? '');
  const ok = await call('postpone_emergency_alert', token);
  redirect(
    `/postpone/${encodeURIComponent(TOKEN.test(token) ? token : 'x')}?${ok ? 'done' : 'bad'}=1`,
  );
}
