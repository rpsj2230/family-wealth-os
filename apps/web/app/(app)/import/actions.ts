'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { importCasPdf, importFundCsv, type FundCsvFund } from '@fwos/data';
import {
  parseTxnCsv,
  planWorkbook,
  type ImportException,
  type ImportPlan,
  type TxnCsvRow,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { recordSnapshot } from '@/lib/portfolio-data';

export interface ImportState {
  stage: 'idle' | 'previewed' | 'committed' | 'error';
  message?: string;
  asOf?: string;
  fileName?: string;
  counts?: Record<string, number>;
  reconciliation?: ImportPlan['reconciliation'];
  exceptions?: ImportException[];
  committed?: { assets: number; observations: number };
}

const MAX_BYTES = 5 * 1024 * 1024;

async function readFile(formData: FormData) {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose your .xlsx workbook first.' } as const;
  if (!/\.xlsx$/i.test(file.name)) return { error: 'Only .xlsx files are supported.' } as const;
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 5 MB.' } as const;
  const bytes = Buffer.from(await file.arrayBuffer());
  const asOf = String(formData.get('asOf') ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf))
    return { error: 'Enter the date the balances represent.' } as const;
  return {
    bytes,
    asOf,
    name: file.name,
    hash: createHash('sha256').update(bytes).digest('hex'),
  } as const;
}

function summarize(plan: ImportPlan) {
  return {
    owners: plan.owners.length,
    institutions: plan.institutions.length,
    assets: plan.assets.length,
    observations: plan.observations.length,
    'fixed deposits': plan.fixedDeposits.length,
    funds: plan.funds.length,
    'money lent': plan.receivables.length,
    policies: plan.policies.length,
    tasks: plan.tasks.length,
  };
}

export async function previewImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  await loadContext();
  const f = await readFile(formData);
  if ('error' in f) return { stage: 'error', message: f.error };
  try {
    const plan = await planWorkbook(f.bytes, { asOf: f.asOf });
    return {
      stage: 'previewed',
      asOf: f.asOf,
      fileName: f.name,
      counts: summarize(plan),
      reconciliation: plan.reconciliation,
      exceptions: plan.exceptions,
    };
  } catch {
    return { stage: 'error', message: 'That file could not be read as the household workbook.' };
  }
}

export async function commitImport(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first (Dashboard).' };
  const f = await readFile(formData);
  if ('error' in f) return { stage: 'error', message: f.error };
  // Re-plan from the uploaded bytes on the server: the browser is never trusted to supply the plan.
  const plan = await planWorkbook(f.bytes, { asOf: f.asOf });
  const acknowledged: Record<string, true> = {};
  for (const c of formData.getAll('ack')) acknowledged[String(c)] = true;
  const { data, error } = await supabase.rpc('import_workbook_batch', {
    p_household: householdId,
    p_source_hash: f.hash,
    p_plan: { ...plan, acknowledged },
  });
  if (error) {
    const m = error.message;
    const friendly = /already imported/.test(m)
      ? 'This exact file has already been imported.'
      : /needs_input/.test(m)
        ? 'Please tick every item under "Needs your decision" before importing.'
        : /reconciliation failed/.test(m)
          ? 'The totals did not reconcile with the workbook, so nothing was imported.'
          : 'The import was refused and nothing was saved.';
    return { stage: 'error', message: friendly };
  }
  // keep the sheet's order, labels and links for the records just created
  await supabase.rpc('sync_workbook_layout', { p_household: householdId, p_plan: plan });
  await recordSnapshot(supabase, householdId, 'import');
  revalidatePath('/');
  return {
    stage: 'committed',
    committed: data as { assets: number; observations: number },
    asOf: f.asOf,
    fileName: f.name,
  };
}

/**
 * Applies the sheet's layout (row order, labels, joint flags, FD links, notes) to the records that already exist.
 * Never changes a balance or a deposit's money terms, so it is safe to run again after editing the sheet.
 */
export async function syncLayout(_prev: ImportState, formData: FormData): Promise<ImportState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first (Dashboard).' };
  const f = await readFile(formData);
  if ('error' in f) return { stage: 'error', message: f.error };
  let plan: ImportPlan;
  try {
    plan = await planWorkbook(f.bytes, { asOf: f.asOf });
  } catch {
    return { stage: 'error', message: 'That file could not be read as the household workbook.' };
  }
  const { data, error } = await supabase.rpc('sync_workbook_layout', {
    p_household: householdId,
    p_plan: plan,
  });
  if (error)
    return { stage: 'error', message: 'The layout could not be applied; nothing was changed.' };
  const r = data as { matched: number; unmatched: string[] };
  revalidatePath('/accounts');
  revalidatePath('/monthly');
  return {
    stage: 'committed',
    message: `Layout applied to ${r.matched} records.${r.unmatched.length ? ` ${r.unmatched.length} could not be matched and were left as they are: ${r.unmatched.slice(0, 6).join(', ')}${r.unmatched.length > 6 ? '…' : ''}.` : ''}`,
    fileName: f.name,
  };
}

export interface CasState {
  ok: boolean | null;
  message: string;
  lines?: string[];
}

/**
 * A fund statement (CAS) uploaded by hand. The password typed here only opens the PDF: it is not saved and not logged.
 * (Statements forwarded to the inbox are opened with the PAN saved in Settings, with nothing to type.)
 */
export async function importCas(_p: CasState | null, f: FormData): Promise<CasState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const file = f.get('file');
  const owner = String(f.get('owner') ?? '');
  const typed = String(f.get('password') ?? '').trim();
  if (!(file instanceof File) || file.size === 0)
    return { ok: false, message: 'Choose the statement PDF first.' };
  if (!/\.pdf$/i.test(file.name))
    return { ok: false, message: 'Only PDF statements are supported.' };
  if (file.size > MAX_BYTES) return { ok: false, message: 'That file is larger than 5 MB.' };
  if (!/^[0-9a-f-]{36}$/.test(owner))
    return { ok: false, message: 'Choose whose statement this is.' };
  if (typed.length > 60) return { ok: false, message: 'That password is too long.' };
  const { data: o } = await supabase
    .from('owners')
    .select('id, pan_last4')
    .eq('id', owner)
    .maybeSingle();
  if (!o) return { ok: false, message: 'Choose whose statement this is.' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await importCasPdf(
      supabase as unknown as SupabaseClient,
      householdId,
      bytes,
      [
        {
          ownerId: owner,
          // as typed, then in capitals and in small letters (people differ on how they typed it when requesting)
          passwords: [...new Set(typed ? [typed, typed.toUpperCase(), typed.toLowerCase()] : [])],
          panLast4: (o.pan_last4 as string | null) ?? null,
        },
      ],
      { sourceRef: `upload:${hash}`, today },
    );
    revalidatePath('/', 'layout');
    if (res.outcome === 'failed') return { ok: false, message: res.detail };
    const r = res.report!;
    return {
      ok: true,
      message: `${r.matched} funds updated, ${r.created} added, ${r.transactionsAdded} new transactions${r.needsReview.length ? `. Please check: ${r.needsReview.join(', ')}` : '.'}`,
      lines: r.lines,
    };
  } catch (e) {
    return { ok: false, message: `The statement could not be imported (${(e as Error).message}).` };
  }
}

export interface FundCsvState {
  stage: 'idle' | 'previewed' | 'committed' | 'error';
  message?: string;
  people?: {
    name: string;
    files: string[];
    funds: FundCsvFund[];
    skipped: number;
    notes: string[];
  }[];
}

const CSV_MAX_BYTES = 2 * 1024 * 1024;

/** Reads every chosen file and the person chosen for it; the lines of one person's files are combined. */
async function readFundCsv(formData: FormData) {
  const files = formData.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: 'Choose at least one transactions file first.' } as const;
  if (files.length > 12) return { error: 'Choose at most 12 files at a time.' } as const;
  const byOwner = new Map<string, { rows: TxnCsvRow[]; files: string[]; hashes: string[] }>();
  const notes: string[] = [];
  for (const [i, file] of files.entries()) {
    const owner = String(formData.get(`owner_${i}`) ?? '');
    if (!/^[0-9a-f-]{36}$/.test(owner))
      return { error: `Choose whose file "${file.name}" is.` } as const;
    if (!/\.csv$/i.test(file.name)) return { error: `"${file.name}" is not a .csv file.` } as const;
    if (file.size > CSV_MAX_BYTES) return { error: `"${file.name}" is larger than 2 MB.` } as const;
    const bytes = Buffer.from(await file.arrayBuffer());
    const parsed = parseTxnCsv(bytes.toString('utf8'));
    if (parsed.rows.length === 0)
      return { error: `${file.name}: ${parsed.warnings[0] ?? 'no transactions found.'}` } as const;
    for (const w of parsed.warnings) notes.push(`${file.name}: ${w}`);
    const g = byOwner.get(owner) ?? { rows: [], files: [], hashes: [] };
    g.rows.push(...parsed.rows);
    g.files.push(file.name);
    g.hashes.push(createHash('sha256').update(bytes).digest('hex'));
    byOwner.set(owner, g);
  }
  return { byOwner, notes } as const;
}

async function runFundCsv(formData: FormData, dryRun: boolean): Promise<FundCsvState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first.' };
  const f = await readFundCsv(formData);
  if ('error' in f) return { stage: 'error', message: f.error };
  const { data: owners } = await supabase.from('owners').select('id, display_name');
  const names = new Map((owners ?? []).map((o) => [o.id as string, o.display_name as string]));
  const today = new Date().toISOString().slice(0, 10);
  const people: NonNullable<FundCsvState['people']> = [];
  try {
    for (const [ownerId, g] of f.byOwner) {
      if (!names.has(ownerId)) return { stage: 'error', message: 'Choose a person from the list.' };
      const res = await importFundCsv(
        supabase as unknown as SupabaseClient,
        householdId,
        ownerId,
        g.rows,
        { today, dryRun },
      );
      people.push({
        name: names.get(ownerId)!,
        files: g.files,
        funds: res.funds,
        skipped: res.report.skipped,
        notes: [...res.notes, ...res.report.lines.filter((l) => l.startsWith('error'))],
      });
      if (!dryRun) {
        const sourceRef = `csv:${ownerId}:${createHash('sha256').update(g.hashes.sort().join()).digest('hex').slice(0, 24)}`;
        await supabase.from('cas_imports').upsert(
          {
            household_id: householdId,
            owner_id: ownerId,
            source_ref: sourceRef,
            received_on: today,
            schemes: res.funds.filter((x) => x.status !== 'review').length,
            transactions: res.report.transactionsAdded,
            outcome: res.report.needsReview.length ? 'partial' : 'imported',
            detail: [`From ${g.files.join(', ')}`, ...res.report.lines].join('\n').slice(0, 2000),
          },
          { onConflict: 'household_id,source_ref' },
        );
      }
    }
  } catch (e) {
    return {
      stage: 'error',
      message: `${dryRun ? 'The preview' : 'The import'} could not be completed (${(e as Error).message}).${dryRun ? '' : ' Run the preview again to see what was saved.'}`,
    };
  }
  if (!dryRun) {
    await recordSnapshot(supabase, householdId, 'import');
    revalidatePath('/', 'layout');
  }
  const extra = f.notes.length
    ? [{ name: 'Files', files: [], funds: [], skipped: 0, notes: f.notes }]
    : [];
  return { stage: dryRun ? 'previewed' : 'committed', people: [...people, ...extra] };
}

/** Shows what a fund-transactions file would do, without saving anything. */
export async function previewFundCsv(_p: FundCsvState, f: FormData): Promise<FundCsvState> {
  return runFundCsv(f, true);
}

/** Stores the funds, transactions, units, amount invested and value from the file(s), for the person chosen for each. */
export async function commitFundCsv(_p: FundCsvState, f: FormData): Promise<FundCsvState> {
  return runFundCsv(f, false);
}
