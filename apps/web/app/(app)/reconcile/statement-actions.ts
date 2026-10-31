'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { classifyLines, LINE_CLASS_LABEL, type LineClass } from '@fwos/core';
import {
  classifyContext,
  conflictingBalances,
  lineKeys,
  loadSettings,
  loadStatements,
  pageAll,
  rebuildStatementMoves,
  saveBankStatement,
  stmtLinesOf,
  type LoadedPortfolio,
} from '@fwos/data';
import {
  isPasswordError,
  readBankStatement,
  readPastedRows,
  type BankStatement,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { loadPortfolio } from '@/lib/portfolio-data';

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
  /**
   * the balance before the first line against the account's own balance on file just before it: when they differ, lines between
   * them are missing (the difference and the days it can be in)
   */
  join?: { onFile: number; on: string; differs: number } | null;
  saved?: { lines: number; balances: number; moves: number; toAnswer: number };
}

async function read(
  f: FormData,
): Promise<
  | { error: string }
  | { s: BankStatement; assetId: string; name: string; db: SupabaseClient; householdId: string }
> {
  const file = f.get('file');
  const pasted = String(f.get('pasted') ?? '').trim();
  const assetId = String(f.get('asset') ?? '');
  if (!pasted && (!(file instanceof File) || file.size === 0))
    return { error: 'Choose the statement file first, or paste the rows.' };
  if (pasted.length > 500_000)
    return { error: 'That is too much to paste at once: paste one month or one page at a time.' };
  if (file instanceof File && file.size > MAX_BYTES)
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
  if (pasted) {
    const s = readPastedRows(pasted);
    if (s.lines.length === 0)
      return {
        error:
          'No transaction rows were found in what was pasted. Copy the rows of the table (date, narration, amounts and balance) from the bank’s page and paste them again.',
      };
    return {
      s,
      assetId,
      name: `Pasted ${new Date().toISOString().slice(0, 10)}`,
      db,
      householdId,
    };
  }
  if (!(file instanceof File)) return { error: 'Choose the statement file first.' };
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
    classifyContext(loaded, config, stored.remittances, stored.rules),
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
    corrected: (await conflictingBalances(db, assetId, s)).length,
    join: joinCheck(stored.lines, assetId, s),
  };
}

/** Does the statement start where the account's lines on file left off? Only judged when both give a balance. */
function joinCheck(
  lines: { asset_id: string; txn_on: string; balance: number | null }[],
  assetId: string,
  s: BankStatement,
): { onFile: number; on: string; differs: number } | null {
  if (s.opening === null || !s.from) return null;
  const before = lines
    .filter((l) => l.asset_id === assetId && l.balance !== null && l.txn_on < s.from!)
    .sort((a, b) => a.txn_on.localeCompare(b.txn_on));
  const last = before[before.length - 1];
  if (!last) return null;
  const differs = Math.round((s.opening - Number(last.balance)) * 100) / 100;
  return { onFile: Number(last.balance), on: last.txn_on, differs };
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
  let added: number;
  let balances: number;
  try {
    const saved = await saveBankStatement(db, householdId, assetId, s, name);
    added = saved.lines;
    balances = saved.balances;
  } catch (e) {
    return {
      stage: 'error',
      message: e instanceof Error ? e.message : 'The statement could not be saved.',
    };
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
  // "remember": the answer becomes a rule for every line naming the same person or words, past and future
  const remember = f.get('remember') === 'on';
  const name = String(f.get('name') ?? '')
    .trim()
    .slice(0, 160);
  const holding = String(f.get('holding') ?? '');
  if (remember && answer) {
    if (name.length < 2) back('Write the name or words to remember, as they appear on the line.');
    const { data: line } = await supabase
      .from('statement_lines')
      .select('amount')
      .eq('id', id)
      .eq('household_id', householdId!)
      .maybeSingle();
    const into = Number((line as { amount: number } | null)?.amount ?? 0) > 0;
    const rule = await ruleRow(supabase as unknown as SupabaseClient, householdId!, {
      name,
      match: f.get('match') === 'words' ? 'words' : 'name',
      answer,
      holding,
      direction: into ? 'in' : 'out',
      interest: false,
    });
    if ('error' in rule) back(rule.error);
    const { error } = await supabase.from('statement_rules').insert(rule.row);
    if (error) back(`The rule could not be saved: ${error.message}`);
    await rebuildOrSay(`Saved as a rule: every line naming “${name}” is placed the same way.`);
  }
  const { error } = await supabase
    .from('statement_lines')
    .update({ answer: answer || null })
    .eq('id', id)
    .eq('household_id', householdId!);
  if (error) back(`That could not be saved: ${error.message}`);
  await rebuildOrSay(answer ? 'Saved.' : 'Answer taken back.');
}

/**
 * A rule's row from an answer: spending, money from outside and earnings stand alone; money to or from a holding needs the holding
 * (a "Loan to …" makes it a loan: money lent and paid back).
 */
async function ruleRow(
  db: SupabaseClient,
  householdId: string,
  r: {
    name: string;
    match: 'name' | 'words';
    answer: string;
    holding: string;
    direction: 'in' | 'out' | 'any';
    interest: boolean;
  },
): Promise<{ row: Record<string, unknown> } | { error: string }> {
  const plain: Record<string, string> = {
    out: 'out',
    outside: 'outside',
    income: 'income',
    rent: 'rent',
  };
  let action = plain[r.answer];
  let assetId: string | null = null;
  if (r.answer === 'own') {
    if (!UUID.test(r.holding))
      return { error: 'Choose the holding the money went to or came from, to remember it.' };
    const { data } = await db
      .from('assets')
      .select('id, type')
      .eq('id', r.holding)
      .eq('household_id', householdId)
      .maybeSingle();
    if (!data) return { error: 'That holding was not found.' };
    assetId = r.holding;
    action = (data as { type: string }).type === 'receivable' ? 'loan' : 'own';
  }
  if (!action) return { error: 'Choose what the line was.' };
  return {
    row: {
      household_id: householdId,
      name: r.name,
      match: r.match,
      action,
      asset_id: assetId,
      direction: r.direction,
      interest: r.interest,
    },
  };
}

/** A rule added by hand (Rules on the Bank statements tab). */
export async function addRule(f: FormData): Promise<void> {
  const name = String(f.get('name') ?? '')
    .trim()
    .slice(0, 160);
  if (name.length < 2) back('Write the name or words the lines carry.');
  const direction = String(f.get('direction') ?? 'any');
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  const rule = await ruleRow(supabase as unknown as SupabaseClient, householdId!, {
    name,
    match: f.get('match') === 'words' ? 'words' : 'name',
    answer: String(f.get('answer') ?? ''),
    holding: String(f.get('holding') ?? ''),
    direction: direction === 'in' || direction === 'out' ? direction : 'any',
    interest: f.get('interest') === 'on',
  });
  if ('error' in rule) back(rule.error);
  const { error } = await supabase.from('statement_rules').insert(rule.row);
  if (error) back(`The rule could not be saved: ${error.message}`);
  await rebuildOrSay(`Rule saved: every line naming “${name}” is placed by it, now and in future.`);
}

/** Removes a rule; its lines are sorted again without it. */
export async function deleteRule(f: FormData): Promise<void> {
  const id = String(f.get('rule') ?? '');
  if (!UUID.test(id)) back('That rule was not found.');
  const { supabase, householdId } = await loadContext();
  if (!householdId) back('Create your household first.');
  const { error } = await supabase
    .from('statement_rules')
    .delete()
    .eq('id', id)
    .eq('household_id', householdId!);
  if (error) back(`That could not be removed: ${error.message}`);
  await rebuildOrSay('Rule removed; its lines are sorted again without it.');
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
