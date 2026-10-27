import type { SupabaseClient } from '@supabase/supabase-js';

export interface RecordArgs {
  householdId: string;
  assetId: string;
  amount: number;
  currency: string;
  asOf: string;
  messageId: string;
  source: 'email' | 'statement';
  confidence: 'verified' | 'manual_confirmed' | 'imported_unverified';
  note: string;
}

/**
 * Records a balance taken from an email. Observations are append-only, so a number that already came from this same email is
 * not changed: a new one is added and the earlier one is marked as replaced by it, which keeps the history.
 */
export async function recordBalance(
  supabase: SupabaseClient,
  a: RecordArgs,
): Promise<{ ok: true } | { ok: false; message: string }> {
  let fx: number | null = null;
  if (a.currency !== 'INR') {
    const { data: f } = await supabase
      .from('fx_rates')
      .select('inr_per_unit')
      .eq('currency', a.currency)
      .lte('rate_date', a.asOf)
      .order('rate_date', { ascending: false })
      .limit(1);
    fx = f?.[0] ? Number(f[0].inr_per_unit) : null;
    if (!fx)
      return {
        ok: false,
        message: `No ${a.currency} exchange rate is stored yet. Run “Refresh market data” on GitHub, then try again.`,
      };
  }
  const ref = a.messageId.slice(0, 200);
  const { data: before } = await supabase
    .from('observations')
    .select('id')
    .eq('asset_id', a.assetId)
    .eq('source_ref', ref)
    .is('superseded_by', null);
  const { data: added, error } = await supabase
    .from('observations')
    .insert({
      household_id: a.householdId,
      asset_id: a.assetId,
      kind: 'balance',
      amount: a.amount,
      currency: a.currency,
      fx_rate: fx,
      as_of: a.asOf,
      received_at: new Date().toISOString(),
      source: a.source,
      source_ref: ref,
      confidence: a.confidence,
      note: a.note,
    })
    .select('id')
    .single();
  if (error || !added)
    return { ok: false, message: 'The balance could not be saved, so nothing was changed.' };
  for (const o of before ?? [])
    await supabase
      .from('observations')
      .update({ superseded_by: added.id as string })
      .eq('id', o.id as string);
  return { ok: true };
}

/** "₹1,23,456.78", "123456.78" or "1,23,456" → a number; anything else → null. */
export function parseAmount(v: FormDataEntryValue | null): number | null {
  const t = String(v ?? '')
    .replace(/[₹,\s]|rs\.?|inr/gi, '')
    .trim();
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 0 && n < 1e12 ? n : null;
}
