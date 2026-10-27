'use server';

import { revalidatePath } from 'next/cache';
import { formatInr, longDate, readingAmount, type InboxReading } from '@fwos/core';
import { runInbox, type InboxIo, type InboxRow, type KnownAccount } from '@fwos/ingest';
import { aiChainFor } from '@fwos/data';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { parseAmount, recordBalance, type Replaced } from './record';

/** "It replaced your imported ₹X dated 26 Oct." */
const replacedNote = (r: Replaced[]) =>
  r.length === 0
    ? ''
    : ` It replaced ${r.map((x) => `the ${x.source === 'workbook' ? 'imported' : 'typed'} ${formatInr(x.amount)} dated ${longDate(x.asOf)}`).join(' and ')}, which stays in the history as replaced.`;

const uuid = /^[0-9a-f-]{36}$/;

export interface InboxResult {
  ok: boolean | null;
  message: string;
  /** after reading a message again or correcting its number: what is recorded now */
  amount?: number;
  asOf?: string;
  /** a balance is now recorded from this message, on an account */
  recorded?: boolean;
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
    .select('id, reading, reason, message_id, resolved_at')
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
  // you may have corrected the number before applying it
  const typed = parseAmount(formData.get('amount'));
  const amount = typed !== null && typed !== Number(r.amount) ? typed : Number(r.amount);
  const edited = amount !== Number(r.amount);
  const saved = await recordBalance(supabase, {
    householdId,
    assetId: asset,
    amount,
    currency: r.currency,
    asOf: r.asOf,
    messageId: String(msg.message_id),
    source: 'email',
    confidence: 'manual_confirmed',
    note: edited
      ? 'Number corrected by you in the bank-email inbox'
      : 'Confirmed by you from the bank-email inbox',
    replaceNewer: true,
  });
  if (!saved.ok) return { ok: false, message: saved.message };
  if (edited)
    await supabase.rpc('save_inbox_result', {
      p_id: id,
      p_outcome: 'needs_review',
      p_reason: msg.reason ?? null,
      p_reading: { ...(msg.reading as object), amount, editedByYou: true },
      p_asset: asset,
      p_resolved: false,
    });
  await supabase
    .from('inbox_messages')
    .update({ resolved_at: new Date().toISOString() })
    .eq('id', id);
  refresh();
  const shown = r.currency === 'INR' ? formatInr(amount) : `${r.currency} ${amount}`;
  return {
    ok: true,
    message: `Recorded ${shown} as of ${longDate(r.asOf)} on ${a.nickname as string}.${replacedNote(saved.replaced)}`,
    amount,
    asOf: r.asOf,
    recorded: true,
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

const AI_LIMITS = { listMs: 12_000, callMs: 15_000, tries: 3 };

/**
 * Asks the AI to read this one email again (rules first, then the AI whether or not the email says "balance"), and records the
 * number at once when it finds one that belongs to a single account. Nothing waits for you: the email and the number are shown
 * side by side afterwards, and Save number replaces a wrong one. An email logged before copies were kept is queued for the next
 * mailbox run instead.
 */
export async function readAgain(_p: InboxResult | null, formData: FormData): Promise<InboxResult> {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That message could not be found.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('id, message_id, received_on, from_domain, subject, body_text')
    .eq('id', id)
    .maybeSingle();
  if (!msg) return { ok: false, message: 'That message could not be found.' };

  if (!msg.body_text) {
    const { error } = await supabase
      .from('inbox_messages')
      .update({ rescan_requested_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return { ok: false, message: 'It could not be queued; please try again.' };
    return {
      ok: true,
      message:
        'This email was logged before the app kept a copy, so it will be fetched from Gmail again and read by the AI at the next mailbox run (every 3 hours, or press Run workflow on “Read bank emails” in GitHub Actions). Its result will appear here.',
    };
  }

  const today = new Date().toISOString().slice(0, 10);
  let chain;
  try {
    chain = await aiChainFor(supabase as unknown as SupabaseClient, householdId, 'member', {
      limits: AI_LIMITS,
    });
  } catch {
    return { ok: false, message: 'The saved AI keys could not be read.' };
  }
  if (chain.empty)
    return {
      ok: false,
      message:
        'No AI key is switched on. Add one in Settings (Bank e-mails and AI), then try again.',
    };
  let last: InboxRow | null = null;
  let accountName = '';
  let replaced: Replaced[] = [];
  const io: InboxIo = {
    async accounts() {
      const [assets, inst] = await Promise.all([
        supabase
          .from('assets')
          .select('id, nickname, type, currency, identifier_last4, institution_id')
          .in('type', ['bank_account', 'third_party_held']),
        supabase.from('institutions').select('id, name'),
      ]);
      const bank = new Map((inst.data ?? []).map((i) => [i.id as string, i.name as string]));
      return (assets.data ?? []).map((a): KnownAccount => {
        return {
          assetId: a.id as string,
          institution: bank.get(a.institution_id as string) ?? '',
          last4: (a.identifier_last4 as string | null) ?? null,
          currency: a.currency as string,
          type: a.type as string,
        };
      });
    },
    async latestObservation(assetId) {
      const { data } = await supabase
        .from('observations')
        .select('amount, as_of, source')
        .eq('asset_id', assetId)
        .is('superseded_by', null)
        .order('as_of', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1);
      return data?.[0]
        ? {
            amount: Number(data[0].amount),
            asOf: data[0].as_of as string,
            source: data[0].source as string,
          }
        : null;
    },
    alreadySeen: async () => false,
    async record(row) {
      last = row;
    },
    async apply({ assetId, reading, messageId, source, replaceNewer }) {
      const res = await recordBalance(supabase, {
        householdId,
        assetId,
        amount: reading.amount,
        currency: reading.currency,
        asOf: reading.asOf,
        messageId,
        source,
        confidence: reading.source === 'rule' ? 'verified' : 'imported_unverified',
        note: 'Read again from the bank email; correct the number in the inbox if it is wrong',
        replaceNewer: !!replaceNewer,
      });
      if (!res.ok) throw new Error(res.message);
      const { data: a } = await supabase
        .from('assets')
        .select('nickname')
        .eq('id', assetId)
        .maybeSingle();
      accountName = (a?.nickname as string | undefined) ?? '';
      replaced = res.replaced;
    },
    async pdfText() {
      throw new Error('attachments are not read here');
    },
  };

  try {
    await runInbox(
      [
        {
          messageId: String(msg.message_id),
          from: `alerts@${(msg.from_domain as string | null) || 'unknown.invalid'}`,
          subject: (msg.subject as string | null) ?? '',
          text: String(msg.body_text),
          receivedOn: (msg.received_on as string | null) ?? today,
          attachments: [],
          reread: true,
        },
      ],
      io,
      { today, ai: chain },
    );
  } catch (e) {
    return { ok: false, message: `It could not be read again: ${(e as Error).message}` };
  }
  const row = last as InboxRow | null;
  if (!row) return { ok: false, message: 'Nothing came back from the reader; please try again.' };
  if (row.outcome === 'error')
    return { ok: false, message: `It could not be read again: ${row.reason ?? 'unknown error'}` };

  await supabase.rpc('save_inbox_result', {
    p_id: id,
    p_outcome: row.outcome,
    p_reason: row.reason,
    p_reading: row.reading,
    p_asset: row.assetId,
    p_resolved: row.outcome !== 'needs_review',
  });
  refresh();
  const rd = row.reading as InboxReading | null;
  if (row.outcome === 'applied' && rd)
    return {
      ok: true,
      recorded: true,
      amount: rd.amount,
      asOf: rd.asOf,
      message: `Read ${readingAmount(rd)} as of ${longDate(rd.asOf)} and recorded it${accountName ? ` on ${accountName}` : ''}. Check it against the email below; if it is wrong, type the right number and press Save number.${replacedNote(replaced)}`,
    };
  if (rd)
    return {
      ok: true,
      recorded: false,
      amount: rd.amount,
      asOf: rd.asOf,
      message: `Read ${readingAmount(rd)} as of ${longDate(rd.asOf)}, but it was not recorded: ${row.reason ?? 'it needs you'}. It is now under “Needs your review”.`,
    };
  return {
    ok: true,
    recorded: false,
    message: `The AI found no balance in this email${row.reason && !/no balance/.test(row.reason) ? ` (${row.reason})` : ''}. If you can see one in the email below, record it in Monthly update.`,
  };
}

/**
 * You looked at the email and the number is wrong: record the right one. The earlier number is kept in the history, marked as
 * replaced, and the corrected one counts from now on.
 */
export async function saveNumber(_p: InboxResult | null, formData: FormData): Promise<InboxResult> {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return { ok: false, message: 'That message could not be found.' };
  const amount = parseAmount(formData.get('amount'));
  if (amount === null)
    return { ok: false, message: 'Type the balance as a plain number, for example 123456.78.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { data: msg } = await supabase
    .from('inbox_messages')
    .select('id, message_id, reading, reason, asset_id')
    .eq('id', id)
    .maybeSingle();
  const r = msg?.reading as InboxReading | null;
  if (!msg || !r) return { ok: false, message: 'No balance was read from this message.' };
  if (!msg.asset_id)
    return {
      ok: false,
      message: 'Choose the account first: use “Needs your review” for this message.',
    };
  if (amount === Number(r.amount))
    return { ok: true, message: 'That is the number already recorded.', amount, recorded: true };
  const saved = await recordBalance(supabase, {
    householdId,
    assetId: msg.asset_id as string,
    amount,
    currency: r.currency,
    asOf: r.asOf,
    messageId: String(msg.message_id),
    source: 'email',
    confidence: 'manual_confirmed',
    note: 'Number corrected by you in the bank-email inbox',
    replaceNewer: true,
  });
  if (!saved.ok) return { ok: false, message: saved.message };
  const { error } = await supabase.rpc('save_inbox_result', {
    p_id: id,
    p_outcome: 'applied',
    p_reason: msg.reason ?? null,
    p_reading: { ...r, amount, editedByYou: true },
    p_asset: msg.asset_id,
    p_resolved: true,
  });
  refresh();
  if (error)
    return {
      ok: true,
      amount,
      asOf: r.asOf,
      recorded: true,
      message: `Recorded ${readingAmount({ ...r, amount })}, but the inbox line could not be updated.`,
    };
  return {
    ok: true,
    recorded: true,
    amount,
    asOf: r.asOf,
    message: `Updated to ${readingAmount({ ...r, amount })} as of ${longDate(r.asOf)}. The earlier ${readingAmount(r)} stays in the history as replaced.${replacedNote(saved.replaced)}`,
  };
}
