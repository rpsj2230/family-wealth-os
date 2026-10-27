'use server';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { importCasPdf, importFundCsv, previewCasPdf } from '@fwos/data';
import { parseTxnCsv, type TxnCsvRow } from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import {
  appliedView,
  selectionFromForm,
  toView,
  type CasState,
  type FundCsvState,
  type PersonPreview,
} from '@/lib/fund-import';
import { recordSnapshot } from '@/lib/portfolio-data';

const MAX_BYTES = 5 * 1024 * 1024;

/** The statement PDF, the person it belongs to and the password typed for it. Nothing here is stored. */
async function readCasForm(f: FormData) {
  const file = f.get('file');
  const owner = String(f.get('owner') ?? '');
  const typed = String(f.get('password') ?? '').trim();
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose the statement PDF first.' } as const;
  if (!/\.pdf$/i.test(file.name)) return { error: 'Only PDF statements are supported.' } as const;
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 5 MB.' } as const;
  if (!/^[0-9a-f-]{36}$/.test(owner)) return { error: 'Choose whose statement this is.' } as const;
  if (typed.length > 60) return { error: 'That password is too long.' } as const;
  return { file, owner, typed } as const;
}

async function candidateFor(
  supabase: Awaited<ReturnType<typeof loadContext>>['supabase'],
  owner: string,
  typed: string,
) {
  const { data: all } = await supabase.from('owners').select('id, display_name, pan_last4');
  const o = (all ?? []).find((x) => x.id === owner);
  if (!o) return null;
  return {
    name: o.display_name as string,
    // the chosen person first, with the typed password; everyone else only so each folio's PAN can be matched to its owner
    candidates: [
      {
        ownerId: owner,
        // as typed, then in capitals and in small letters (people differ on how they typed it when requesting)
        passwords: [...new Set(typed ? [typed, typed.toUpperCase(), typed.toLowerCase()] : [])],
        panLast4: (o.pan_last4 as string | null) ?? null,
      },
      ...(all ?? [])
        .filter((x) => x.id !== owner)
        .map((x) => ({
          ownerId: x.id as string,
          passwords: [] as string[],
          panLast4: (x.pan_last4 as string | null) ?? null,
        })),
    ],
    names: new Map((all ?? []).map((x) => [x.id as string, x.display_name as string])),
  };
}

/**
 * Step one for a fund statement uploaded by hand: opens it and shows what it would change, compared with what is already on file.
 * Nothing is written. The password typed here only opens the PDF: it is not saved and not logged.
 */
export async function previewCas(_p: CasState | null, f: FormData): Promise<CasState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first.' };
  const form = await readCasForm(f);
  if ('error' in form) return { stage: 'error', message: form.error };
  const who = await candidateFor(supabase, form.owner, form.typed);
  if (!who) return { stage: 'error', message: 'Choose whose statement this is.' };
  const bytes = new Uint8Array(await form.file.arrayBuffer());
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await previewCasPdf(
      supabase as unknown as SupabaseClient,
      householdId,
      bytes,
      who.candidates,
      {
        today,
      },
    );
    if (!res.ok) return { stage: 'error', message: res.detail };
    const list = res.people ?? [{ ownerId: res.ownerId, diff: res.diff }];
    const people: PersonPreview[] = list.map((p) => ({
      ownerId: p.ownerId,
      name: who.names.get(p.ownerId) ?? who.name,
      files: [],
      diff: toView(p.diff),
      notes: [],
    }));
    return {
      stage: 'previewed',
      person: people[0]!,
      people,
      skipped: (res.skipped ?? []).map((k) => ({
        panLast4: k.panLast4,
        holder: k.holder,
        schemes: k.schemes,
      })),
      basis: res.basis ?? 'unknown',
      warnings: res.warnings,
    };
  } catch (e) {
    return {
      stage: 'error',
      message: `The statement could not be read (${(e as Error).message}). Nothing was changed.`,
    };
  }
}

/**
 * Step two: writes only the items that were ticked at the preview (the statement is read again, so the browser is never trusted to
 * supply the changes). An item that was shown and not ticked is remembered, so the same statement does not propose it again.
 */
export async function importCas(_p: CasState | null, f: FormData): Promise<CasState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first.' };
  const form = await readCasForm(f);
  if ('error' in form) return { stage: 'error', message: form.error };
  const select = selectionFromForm(f);
  if (!select)
    return { stage: 'error', message: 'Preview the changes first, then apply the ones you want.' };
  const who = await candidateFor(supabase, form.owner, form.typed);
  if (!who) return { stage: 'error', message: 'Choose whose statement this is.' };
  const bytes = new Uint8Array(await form.file.arrayBuffer());
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 24);
  const today = new Date().toISOString().slice(0, 10);
  try {
    const res = await importCasPdf(
      supabase as unknown as SupabaseClient,
      householdId,
      bytes,
      who.candidates,
      {
        sourceRef: `upload:${hash}`,
        today,
        select,
      },
    );
    revalidatePath('/', 'layout');
    if (res.outcome === 'failed' || !res.report) return { stage: 'error', message: res.detail };
    return {
      stage: 'applied',
      message: res.report.summary,
      applied: {
        name: res.people?.length
          ? res.people.map((p) => who.names.get(p.ownerId) ?? who.name).join(' and ')
          : who.name,
        ...appliedView(res.report),
      },
    };
  } catch (e) {
    return {
      stage: 'error',
      message: `The statement could not be imported (${(e as Error).message}). Preview it again to see what was saved.`,
    };
  }
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

async function runFundCsv(formData: FormData, apply: boolean): Promise<FundCsvState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { stage: 'error', message: 'Create your household first.' };
  const f = await readFundCsv(formData);
  if ('error' in f) return { stage: 'error', message: f.error };
  const select = apply ? selectionFromForm(formData) : null;
  if (apply && !select)
    return { stage: 'error', message: 'Preview the changes first, then apply the ones you want.' };
  const { data: owners } = await supabase.from('owners').select('id, display_name');
  const names = new Map((owners ?? []).map((o) => [o.id as string, o.display_name as string]));
  const today = new Date().toISOString().slice(0, 10);
  const people: PersonPreview[] = [];
  try {
    for (const [ownerId, g] of f.byOwner) {
      if (!names.has(ownerId)) return { stage: 'error', message: 'Choose a person from the list.' };
      const res = await importFundCsv(
        supabase as unknown as SupabaseClient,
        householdId,
        ownerId,
        g.rows,
        { today, apply, ...(select ? { select } : {}) },
      );
      people.push({
        ownerId,
        name: names.get(ownerId)!,
        files: g.files,
        diff: toView(res.diff),
        notes: res.notes,
        ...(res.report ? { applied: appliedView(res.report) } : {}),
      });
      if (apply && res.report) {
        const sourceRef = `csv:${ownerId}:${createHash('sha256').update(g.hashes.sort().join()).digest('hex').slice(0, 24)}`;
        await supabase.from('cas_imports').upsert(
          {
            household_id: householdId,
            owner_id: ownerId,
            source_ref: sourceRef,
            received_on: today,
            schemes: res.report.statementFunds,
            transactions: res.report.transactionsAdded,
            outcome: res.report.needsReview.length ? 'partial' : 'imported',
            detail: [res.report.summary, `From ${g.files.join(', ')}`, ...res.report.lines]
              .join('\n')
              .slice(0, 2000),
            changes: {
              summary: res.report.summary,
              notes: res.diff.notes,
              items: res.report.changes,
            },
          },
          { onConflict: 'household_id,source_ref' },
        );
      }
    }
  } catch (e) {
    return {
      stage: 'error',
      message: `${apply ? 'The import' : 'The preview'} could not be completed (${(e as Error).message}).${apply ? ' Run the preview again to see what was saved.' : ''}`,
    };
  }
  if (apply) {
    await recordSnapshot(supabase, householdId, 'import');
    revalidatePath('/', 'layout');
  }
  return {
    stage: apply ? 'committed' : 'previewed',
    people,
    notes: f.notes,
  };
}

/** Shows what a fund-transactions file would change, compared with what is on file, without saving anything. */
export async function previewFundCsv(_p: FundCsvState, f: FormData): Promise<FundCsvState> {
  return runFundCsv(f, false);
}

/** Writes only the items that were ticked at the preview. */
export async function commitFundCsv(_p: FundCsvState, f: FormData): Promise<FundCsvState> {
  return runFundCsv(f, true);
}
