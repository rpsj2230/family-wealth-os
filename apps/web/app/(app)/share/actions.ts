'use server';

import { buildDigest } from '@fwos/core';
import { buildDigestInput } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';

/** Today's summary as a short WhatsApp-ready text. Nothing is sent from here; you choose the contact in WhatsApp. */
export async function whatsappSummary(): Promise<{ ok: boolean; text: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, text: '' };
  const h = await supabase.from('households').select('name').eq('id', householdId).single();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Singapore' }).format(new Date());
  const input = await buildDigestInput(supabase as unknown as SupabaseClient, {
    date,
    householdName: (h.data as { name: string } | null)?.name ?? 'Household',
    appUrl: 'https://family-wealth-os-nine.vercel.app',
  });
  return { ok: true, text: buildDigest(input).whatsapp };
}
