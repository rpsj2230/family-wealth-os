'use server';

import { revalidatePath } from 'next/cache';
import { importTaxFile } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';

export interface TaxFileState {
  ok: boolean | null;
  message: string;
  warnings?: string[];
}

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * A Form 26AS or AIS uploaded by hand. A PAN typed here only helps to open a protected AIS: it is not saved. The AI reader is not
 * available here (the key can only be read by the background job), so a file this reader cannot understand can be forwarded to
 * the inbox label instead.
 */
export async function uploadTaxFile(_p: TaxFileState | null, f: FormData): Promise<TaxFileState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const file = f.get('file');
  const ownerId = String(f.get('owner') ?? '');
  const fyHint = String(f.get('fy') ?? '');
  const typedPan = String(f.get('pan') ?? '')
    .trim()
    .toUpperCase();
  const typedPw = String(f.get('password') ?? '').trim();
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choose the file first.' };
  if (file.size > MAX_BYTES) return { ok: false, message: 'That file is larger than 5 MB.' };
  if (!/^[0-9a-f-]{36}$/.test(ownerId))
    return { ok: false, message: 'Choose whose statement this is.' };
  if (typedPan && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(typedPan))
    return { ok: false, message: 'A PAN looks like ABCDE1234F.' };
  const { data: o } = await supabase
    .from('owners')
    .select('id, dob, pan_last4')
    .eq('id', ownerId)
    .maybeSingle();
  if (!o) return { ok: false, message: 'Choose whose statement this is.' };
  const dob = (o.dob as string | null)
    ? `${(o.dob as string).slice(8, 10)}${(o.dob as string).slice(5, 7)}${(o.dob as string).slice(0, 4)}`
    : null;
  const passwords = [
    ...(typedPw ? [typedPw] : []),
    ...(dob ? [dob] : []),
    ...(dob && typedPan ? [typedPan.toLowerCase() + dob, typedPan + dob] : []),
  ];
  const res = await importTaxFile(
    supabase as unknown as SupabaseClient,
    householdId,
    { id: ownerId, panLast4: (o.pan_last4 as string | null) ?? null },
    new Uint8Array(await file.arrayBuffer()),
    { passwords, ai: null, fyHint: /^\d{4}-\d{2}$/.test(fyHint) ? fyHint : null },
  );
  revalidatePath('/tax/filing');
  return { ok: res.ok, message: res.message, warnings: res.warnings };
}
