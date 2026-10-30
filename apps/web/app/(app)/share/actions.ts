'use server';

import { DEFAULT_APP_URL, buildDigest, withHome } from '@fwos/core';
import { buildDigestInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadHome } from '@/lib/home-data';

/**
 * Today's summary as a short WhatsApp-ready text. Nothing is sent from here; you choose the contact in WhatsApp. Its money figures
 * are Home's (the same loader and model), so the message and Home agree; if Home cannot be built, the text goes without those lines.
 */
export async function whatsappSummary(): Promise<{ ok: boolean; text: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, text: '' };
  const h = await supabase.from('households').select('name').eq('id', householdId).single();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const [input, home] = await Promise.all([
    buildDigestInput(supabase as unknown as SupabaseClient, {
      date,
      householdName: (h.data as { name: string } | null)?.name ?? 'Household',
      appUrl: DEFAULT_APP_URL,
    }),
    loadHome(supabase, '1Y').catch(() => null),
  ]);
  return { ok: true, text: buildDigest(withHome(input, home)).whatsapp };
}
