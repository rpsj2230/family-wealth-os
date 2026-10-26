'use server';

import { revalidatePath } from 'next/cache';
import { formatInr, longDate } from '@fwos/core';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

export interface InboxResult {
  ok: boolean | null;
  message: string;
}

// the inbox itself is not refreshed here: the card on screen keeps showing what happened (and offers Undo) until you leave the page
const refresh = () => {
  revalidatePath('/monthly');
  revalidatePath('/');
};

/** Apply a reading the reader could not apply alone, after you chose (or confirmed) the account. */
export async function applyReading(
  _p: InboxResult | null,
  formData: FormData,
): Promise<InboxResult> {
  const id = String(formData.get('id') ?? '');
  const asset = String(formData.get('asset') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That message could not be found.' };
  if (!uuid.test(asset)) return { ok: false, message: 'Choose the account first.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('id, reading, message_id, resolved_at')
    .eq('id', id)
    .maybeSingle();
  const r = msg?.reading as {
    amount: number;
    currency: string;
    asOf: string;
    source: 'rule' | 'ai';
  } | null;
  if (!msg) return { ok: false, message: 'That message could not be found.' };
  if (msg.resolved_at) return { ok: false, message: 'This message was already handled.' };
  if (!r || !(Number(r.amount) >= 0) || !/^\d{4}-\d{2}-\d{2}$/.test(r.asOf))
    return {
      ok: false,
      message: 'No balance was read from this message. Record it in Monthly update instead.',
    };
  const { data: a } = await supabase
    .from('assets')
    .select('currency, nickname')
    .eq('id', asset)
    .maybeSingle();
  if (!a) return { ok: false, message: 'Choose the account first.' };
  if (a.currency !== r.currency)
    return {
      ok: false,
      message: `That account is in ${a.currency as string} but the balance is in ${r.currency}. Choose another account.`,
    };
  let fx: number | null = null;
  if (r.currency !== 'INR') {
    const { data: f } = await supabase
      .from('fx_rates')
      .select('inr_per_unit')
      .eq('currency', r.currency)
      .lte('rate_date', r.asOf)
      .order('rate_date', { ascending: false })
      .limit(1);
    fx = f?.[0] ? Number(f[0].inr_per_unit) : null;
    if (!fx)
      return {
        ok: false,
        message: `No ${r.currency} exchange rate is stored yet. Run “Refresh market data” on GitHub, then try again.`,
      };
  }
  const { error } = await supabase.from('observations').insert({
    household_id: householdId,
    asset_id: asset,
    kind: 'balance',
    amount: Number(r.amount),
    currency: r.currency,
    fx_rate: fx,
    as_of: r.asOf,
    received_at: new Date().toISOString(),
    source: 'email',
    source_ref: String(msg.message_id).slice(0, 200),
    confidence: 'manual_confirmed',
    note: 'Confirmed by you from the bank-email inbox',
  });
  if (error)
    return { ok: false, message: 'The balance could not be saved, so nothing was changed.' };
  await supabase
    .from('inbox_messages')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  refresh();
  const shown =
    r.currency === 'INR' ? formatInr(Number(r.amount)) : `${r.currency} ${Number(r.amount)}`;
  return {
    ok: true,
    message: `Recorded ${shown} as of ${longDate(r.asOf)} on ${a.nickname as string}.`,
  };
}

/** Ignore a message: it leaves the review queue and nothing is recorded. */
export async function dismissMessage(
  _p: InboxResult | null,
  formData: FormData,
): Promise<InboxResult> {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That message could not be found.' };
  const { supabase } = await loadContext();
  const { error } = await supabase
    .from('inbox_messages')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, message: 'It could not be ignored; please try again.' };
  refresh();
  return { ok: true, message: 'Ignored. You can put it back from the Skipped tab.' };
}

/** Put an ignored message back in the review queue. */
export async function restoreMessage(
  _p: InboxResult | null,
  formData: FormData,
): Promise<InboxResult> {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That message could not be found.' };
  const { supabase } = await loadContext();
  const { error } = await supabase
    .from('inbox_messages')
    .update({ resolved_at: null })
    .eq('id', id);
  if (error) return { ok: false, message: 'It could not be put back; please try again.' };
  refresh();
  return { ok: true, message: 'Put back in the review queue.' };
}
