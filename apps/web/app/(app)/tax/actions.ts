'use server';

import { revalidatePath } from 'next/cache';
import { loadContext } from '@/lib/data';

const STATUS = ['planned', 'withheld', 'claimed', 'received'] as const;
const amount = (f: FormData, k: string): number | null => {
  const v = String(f.get(k) ?? '').replace(/[₹,\s]/g, '');
  return /^\d+(\.\d+)?$/.test(v) ? Number(v) : null;
};

/** Moves a refund record along: tax withheld at the sale, claimed in the return, received in the bank. */
export async function updateRefund(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const id = String(f.get('id') ?? '');
  const status = STATUS.find((s) => s === f.get('status'));
  if (!/^[0-9a-f-]{36}$/.test(id) || !status) return;
  await supabase
    .from('tds_refunds')
    .update({
      status,
      actual_gain: amount(f, 'actualGain'),
      actual_tds: amount(f, 'actualTds'),
      refund_received: amount(f, 'refundReceived'),
      notes:
        String(f.get('notes') ?? '')
          .trim()
          .slice(0, 300) || null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('household_id', householdId);
  revalidatePath('/tax');
}
