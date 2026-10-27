'use server';

import { revalidatePath } from 'next/cache';
import { loadHistoryExisting, historyIo, loadSettings } from '@fwos/data';
import {
  applyHistoryMonth,
  planHistory,
  type ConflictChoice,
  type HistoryPlan,
  type MonthResult,
} from '@fwos/ingest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadContext } from '@/lib/data';
import { toView, type HistoryView } from '@/lib/history-view';

export interface HistoryPreviewState {
  ok: boolean;
  message?: string;
  fileName?: string;
  view?: HistoryView;
}

export interface HistoryMonthState {
  ok: boolean;
  /** why the month was not attempted */
  message?: string;
  result?: MonthResult;
}

const MAX_BYTES = 5 * 1024 * 1024;

/** The workbook is read in memory for this one request and never stored. The page sends it again for each month it imports. */
async function readSheet(formData: FormData) {
  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0)
    return { error: 'Choose your .xlsx workbook first.' } as const;
  if (!/\.xlsx$/i.test(file.name)) return { error: 'Only .xlsx files are supported.' } as const;
  if (file.size > MAX_BYTES) return { error: 'That file is larger than 5 MB.' } as const;
  const overrides: Record<string, string> = {};
  try {
    const raw = JSON.parse(String(formData.get('overrides') ?? '{}')) as Record<string, unknown>;
    for (const [tab, ym] of Object.entries(raw))
      if (typeof ym === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(ym) && tab.length <= 100)
        overrides[tab] = ym;
  } catch {
    return {
      error: 'The chosen months could not be read. Reload the page and try again.',
    } as const;
  }
  return { bytes: Buffer.from(await file.arrayBuffer()), name: file.name, overrides } as const;
}

async function planFor(
  supabase: SupabaseClient,
  householdId: string,
  bytes: Buffer,
  overrides: Record<string, string>,
): Promise<HistoryPlan> {
  const [{ existing, owners }, settings] = await Promise.all([
    loadHistoryExisting(supabase, householdId),
    loadSettings(supabase, householdId),
  ]);
  return planHistory(bytes, {
    today: new Date().toISOString().slice(0, 10),
    ownerNames: owners,
    ...(owners[0] ? { defaultOwner: owners[0] } : {}),
    existing,
    monthOverrides: overrides,
    startsAfterDays: settings.config.estimates.historyStartsAfterDays,
  });
}

/** Reads every monthly tab and says what importing each would do. Writes nothing. */
export async function previewHistory(formData: FormData): Promise<HistoryPreviewState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first (Dashboard).' };
  const f = await readSheet(formData);
  if ('error' in f) return { ok: false, message: f.error };
  try {
    const plan = await planFor(
      supabase as unknown as SupabaseClient,
      householdId,
      f.bytes,
      f.overrides,
    );
    return { ok: true, fileName: f.name, view: toView(plan) };
  } catch {
    return { ok: false, message: 'That file could not be read as the household workbook.' };
  }
}

/**
 * Imports ONE month. The page calls this once per selected month so that no request runs long, and a failure on one month never
 * loses the others. The month is planned again here from the file and from what is on file now, so a month already imported adds
 * nothing and a second run continues where the first stopped.
 */
export async function importHistoryMonth(formData: FormData): Promise<HistoryMonthState> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first (Dashboard).' };
  const f = await readSheet(formData);
  if ('error' in f) return { ok: false, message: f.error };
  const tab = String(formData.get('tab') ?? '');
  const choices: Record<string, ConflictChoice> = {};
  try {
    const raw = JSON.parse(String(formData.get('choices') ?? '{}')) as Record<string, unknown>;
    for (const [id, v] of Object.entries(raw)) if (v === 'sheet' || v === 'keep') choices[id] = v;
  } catch {
    return { ok: false, message: 'The answers to the conflicts could not be read.' };
  }
  const db = supabase as unknown as SupabaseClient;
  try {
    const plan = await planFor(db, householdId, f.bytes, f.overrides);
    const month = plan.months.find((m) => m.tab === tab);
    if (!month) return { ok: false, message: `The tab "${tab}" is not in this workbook.` };
    if (month.doubt)
      return {
        ok: false,
        message: `Choose which month "${tab}" really is before importing it.`,
      };
    const result = await applyHistoryMonth(plan, tab, choices, historyIo(db, householdId));
    return { ok: true, result };
  } catch (e) {
    return { ok: false, message: `${tab} could not be imported (${(e as Error).message}).` };
  }
}

/** Called once after the last month, so every page shows the new history. */
export async function finishHistory(): Promise<void> {
  await loadContext();
  revalidatePath('/', 'layout');
}
