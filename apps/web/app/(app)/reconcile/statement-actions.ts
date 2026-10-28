'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { classifyLines, LINE_CLASS_LABEL, type LineClass } from '@fwos/core';
import { loadSettings, pageAll, type LoadedPortfolio } from '@fwos/data';
import { isPasswordError, readBankStatement, type BankStatement } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';
import {
  balanceOn,
  classifyContext,
  lineKeys,
  loadStatements,
  monthBalances,
  stmtLinesOf,
} from '@/lib/statement-data';
import { rebuildStatementMoves } from '@/lib/statement-rebuild';

const UUID = /^[0-9a-f-]{36}$/;
const MAX_BYTES = 5.5 * 1024 * 1024;

export interface StatementState {
  stage: 'idle' | 'previewed' | 'saved' | 'error';
  message?: string;
  /** what the file holds */
  from?: string | null;
  to?: string | null;
  opening?: number | null;
  closing?: number | null;
  lines?: number;
  /** lines not already stored from an earlier statement */
  fresh?: number;
  warnings?: string[];
  /** the account digits on the statement differ from the account chosen */
  mismatch?: string | null;
  /** what the new lines are, by class: count and sum */
  classes?: { label: string; count: number; total: number }[];
  /** recorded balances that the statement corrects */
  corrected?: number;
  saved?: { lines: number; balances: number; moves: number; toAnswer: number };
}

async function read(
  f: FormData,
): Promise<
  | { error: string }
  | { s: BankStatement; assetId: string; name: string; db: SupabaseClient; householdId: string }
> {
  const file = f.get('file');
  const assetId = String(f.get('asset') ?? '');
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose the statement file first.' };
  if (file.size > MAX_BYTES)
    return {
      error: 'That file is larger than 5.5 MB: download a shorter period (one year at a time).',
    };
  if (!UUID.test(assetId)) return { error: 'Choose which account the statement is for.' };
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { error: 'Create your household first.' };
  const db = supabase as unknown as SupabaseClient;
  const { data: acct } = await db
    .from('assets')
    .select('id, type')
    .eq('id', assetId)
    .eq('household_id', householdId)
    .maybeSingle();
  if (!acct || acct.type !== 'bank_account') return { error: 'Choose one of your bank accounts.' };
  const password = String(f.get('password') ?? '') || undefined;
  try {
    const s = await readBankStatement(new Uint8Array(await file.arrayBuffer()), password);
    if (s.lines.length === 0)
      return { error: s.warnings[0] ?? 'No transaction lines were found in that file.' };
    return { s, assetId, name: file.name, db, householdId };
  } catch (e) {
    if (isPasswordError(e))
      return {
        error: password
          ? 'That password did not open the PDF. Banks often use a mix of your name and date of birth, or your customer ID.'
          : 'The PDF is protected: type its password.',
      };
    return { error: e instanceof Error ? e.message : 'The file could not be read.' };
  }
}

/** The account's last four digits on file, for checking the statement belongs to it. */
async function last4Of(db: SupabaseClient, assetId: string) {
  const { data } = await db
    .from('assets')
    .select('identifier_last4')
    .eq('id', assetId)
    .maybeSingle();
  return (data?.identifier_last4 as string | null) ?? null;
}

/** The recorded balances of the account inside the statement's days that the statement shows to be different. */
async function conflicting(db: SupabaseClient, assetId: string, s: BankStatement) {
  const { data } = await db
    .from('observations')
    .select('id, as_of, amount')
    .eq('asset_id', assetId)
    .eq('kind', 'balance')
    .is('superseded_by', null)
    .gte('as_of', s.from!)
    .lte('as_of', s.to!);
  return ((data ?? []) as { id: string; as_of: string; amount: number }[])
    .map((o) => ({ ...o, proved: balanceOn(s, o.as_of) }))
    .filter((o) => o.proved !== null && Math.abs(Number(o.amount) - o.proved) > 1);
}

/** Reads the file and shows what it holds and what its lines are; nothing is saved. */
export async function previewStatement(
  _prev: StatementState,
  f: FormData,
): Promise<StatementState> {
  const r = await read(f);
  if ('error' in r) return { stage: 'error', message: r.error };
  const { s, assetId, db } = r;
  const keys = lineKeys(s.lines);
  const stored = await loadStatements(db);
  const known = new Set(
    stored.lines
      .filter((l) => l.asset_id === assetId)
      .map(
        (l) =>
          `${l.txn_on}|${Math.round(l.amount * 100)}|${l.balance === null ? '' : Math.round(l.balance * 100)}`,
      ),
  );
  const freshIdx = s.lines
    .map((l, i) => ({ l, i, k: keys[i]!.split('|').slice(0, 3).join('|') }))
    .filter((x) => !known.has(x.k));
  const loaded = (await loadPortfolio(db)) as unknown as LoadedPortfolio;
  const { config } = await loadSettings(db);
  const owner = loaded.assetRows.find((a) => a.id === assetId)?.owner_id ?? '';
  const preview = freshIdx.map((x) => ({
    id: `new:${x.i}`,
    assetId,
    ownerId: owner,
    date: x.l.date,
    amount: x.l.credit - x.l.debit,
    narration: x.l.narration,
  }));
  const classified = classifyLines(
    [...stmtLinesOf(stored.lines, loaded), ...preview],
    classifyContext(loaded, config),
  ).filter((c) => c.id.startsWith('new:'));
  const amountOf = new Map(preview.map((p) => [p.id, p.amount]));
  const by = new Map<LineClass, { count: number; total: number }>();
  for (const c of classified) {
    const g = by.get(c.cls) ?? { count: 0, total: 0 };
    g.count++;
    g.total += amountOf.get(c.id) ?? 0;
    by.set(c.cls, g);
  }
  const mine = await last4Of(db, assetId);
  return {
    stage: 'previewed',
    from: s.from,
    to: s.to,
    opening: s.opening,
    closing: s.closing,
    lines: s.lines.length,
    fresh: freshIdx.length,
    warnings: s.warnings,
    mismatch: s.last4 && mine && s.last4 !== mine ? s.last4 : null,
    classes: [...by.entries()]
      .map(([cls, g]) => ({ label: LINE_CLASS_LABEL[cls], count: g.count, total: g.total }))
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    corrected: (await conflicting(db, assetId, s)).length,
  };
}

/**
 * Saves the statement: its new lines (an overlapping statement adds nothing twice), the balances it proves at each month's end (a
 * different recorded balance on a day it covers is replaced, never deleted), and then sorts every line again and rewrites the
 * movements that come from statements.
 */
export async function saveStatement(_prev: StatementState, f: FormData): Promise<StatementState> {
  const r = await read(f);
  if ('error' in r) return { stage: 'error', message: r.error };
  const { s, assetId, db, householdId, name } = r;
  const mine = await last4Of(db, assetId);
  if (s.last4 && mine && s.last4 !== mine && f.get('confirmMismatch') !== 'on')
    return {
      stage: 'error',
      message: `The statement is for an account ending ${s.last4}, not ${mine}. Choose the right account, or tick that it is right.`,
    };
  const { data: st, error: e1 } = await db
    .from('bank_statements')
    .insert({
      household_id: householdId,
      asset_id: assetId,
      from_on: s.from,
      to_on: s.to,
      opening: s.opening,
      closing: s.closing,
      line_count: s.lines.length,
      layout: s.layout,
      breaks: s.breaks,
      file_label: name.replace(/\d{6,}/g, (m) => `…${m.slice(-4)}`).slice(0, 120),
    })
    .select('id')
    .single();
  if (e1 || !st)
    return { stage: 'error', message: `The statement could not be saved: ${e1?.message ?? ''}` };
  const keys = lineKeys(s.lines);
  const rows = s.lines.map((l, i) => ({
    household_id: householdId,
    statement_id: st.id as string,
    asset_id: assetId,
    txn_on: l.date,
    amount: Math.round((l.credit - l.debit) * 100) / 100,
    balance: l.balance,
    narration: l.narration,
    line_key: keys[i]!,
  }));
  let added = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await db
      .from('statement_lines')
      .upsert(rows.slice(i, i + 500), {
        onConflict: 'household_id,asset_id,line_key',
        ignoreDuplicates: true,
      })
      .select('id');
    if (error) return { stage: 'error', message: `The lines could not be saved: ${error.message}` };
    added += data?.length ?? 0;
  }

  // the balances the statement proves, and the recorded ones it shows to be different
  const wrong = await conflicting(db, assetId, s);
  const { data: existing } = await db
    .from('observations')
    .select('as_of, amount')
    .eq('asset_id', assetId)
    .eq('kind', 'balance')
    .is('superseded_by', null)
    .gte('as_of', s.from!)
    .lte('as_of', s.to!);
  const have = new Set(
    ((existing ?? []) as { as_of: string; amount: number }[])
      .filter((o) => !wrong.some((w) => w.as_of === o.as_of))
      .map((o) => `${o.as_of}|${Math.round(Number(o.amount))}`),
  );
  const proven = new Map<string, number>();
  for (const b of monthBalances(s)) proven.set(b.date, b.amount);
  for (const w of wrong) proven.set(w.as_of, w.proved!);
  let balances = 0;
  const now = new Date().toISOString();
  for (const [date, amount] of proven) {
    if (have.has(`${date}|${Math.round(amount)}`)) continue;
    const { data: obs, error } = await db
      .from('observations')
      .insert({
        household_id: householdId,
        asset_id: assetId,
        kind: 'balance',
        amount,
        currency: 'INR',
        fx_rate: null,
        as_of: date,
        received_at: now,
        source: 'statement',
        source_ref: `stmt:${st.id as string}:${date}`,
        confidence: 'verified',
        note: 'Balance from a bank statement',
      })
      .select('id')
      .single();
    if (error || !obs) continue;
    balances++;
    for (const w of wrong.filter((x) => x.as_of === date))
      await db
        .from('observations')
        .update({ superseded_by: obs.id as string })
        .eq('id', w.id);
  }

  let moves: number;
  let toAnswer: number;
  try {
    const rb = await rebuildStatementMoves(db, householdId);
    moves = rb.added;
    toAnswer = rb.toAnswer;
  } catch (e) {
    return {
      stage: 'error',
      message: `The lines were saved, but the movements could not be rebuilt: ${e instanceof Error ? e.message : ''}. Open Explain movements > Bank statements and press Rebuild.`,
    };
  }
  revalidatePath('/', 'layout');
  return {
    stage: 'saved',
    saved: { lines: added, balances, moves, toAnswer },
    from: s.from,
    to: s.to,
  };
}

function back(message: string): never {
  revalidatePath('/', 'layout');
  redirect(`/reconcile?tab=statements&msg=${encodeURIComponent(message)}`);
}

async function rebuildOrSay(done: string): Promise<never> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  try {
    await rebuildStatementMoves(supabase as unknown as SupabaseClient, householdId!);
  } catch (e) {
    back(`Saved, but the movements could not be rebuilt: ${e instanceof Error ? e.message : ''}`);
  }
  back(done);
}

/** What a line was, when no rule could say: saved on the line, then every line is sorted again. Empty takes the answer back. */
export async function answerLine(f: FormData): Promise<void> {
  const id = String(f.get('line') ?? '');
  const answer = String(f.get('answer') ?? '');
  if (!UUID.test(id) || !['outside', 'own', 'income', 'rent', 'out', ''].includes(answer))
    back('Choose what the line was.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  const { error } = await supabase
    .from('statement_lines')
    .update({ answer: answer || null })
    .eq('id', id)
    .eq('household_id', householdId!);
  if (error) back(`That could not be saved: ${error.message}`);
  await rebuildOrSay(answer ? 'Saved.' : 'Answer taken back.');
}

/** Removes an imported statement and its lines; the balances it recorded stay (they are what the bank showed). */
export async function deleteStatement(f: FormData): Promise<void> {
  const id = String(f.get('statement') ?? '');
  if (!UUID.test(id)) back('That statement was not found.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  const { error } = await supabase
    .from('bank_statements')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId!);
  if (error) back(`That could not be removed: ${error.message}`);
  await rebuildOrSay('Statement removed with its lines.');
}

/** Sorts every line again: after a rule in Settings changed, or a deposit or a CAS was added. */
export async function rebuildStatements(): Promise<void> {
  await rebuildOrSay('Every line sorted again with the current rules.');
}

/**
 * Removes answers given before the statements arrived (Earlier months, Recent, Interest) that the statements now cover, so the same
 * money is not counted twice. Only the movements listed on the page can be removed, and only ones you entered by hand.
 */
export async function removeCovered(f: FormData): Promise<void> {
  const ids = f
    .getAll('move')
    .map(String)
    .filter((x) => UUID.test(x));
  if (ids.length === 0) back('Nothing was chosen.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  const db = supabase as unknown as SupabaseClient;
  const rows = await pageAll<{ id: string; idem_key: string | null; source: string }>((from, to) =>
    db.from('money_moves').select('id, idem_key, source').in('id', ids).range(from, to),
  );
  const ok = rows
    .filter((m) => m.source !== 'statement' && !(m.idem_key ?? '').startsWith('stmt:'))
    .map((m) => m.id);
  if (ok.length > 0) {
    const { error } = await db
      .from('money_moves')
      .delete()
      .in('id', ok)
      .eq('household_id', householdId!);
    if (error) back(`That could not be removed: ${error.message}`);
  }
  back(
    `${ok.length} earlier answer${ok.length === 1 ? '' : 's'} removed: the statements now count that money.`,
  );
}
