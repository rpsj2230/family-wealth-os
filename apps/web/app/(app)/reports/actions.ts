'use server';

import { revalidatePath } from 'next/cache';
import { configFromJson, savedReportsFrom, type SavedReport } from '@fwos/core';
import { loadContext } from '@/lib/data';

const text = (f: FormData, k: string) => String(f.get(k) ?? '').trim();

/** The saved reports change inside the household's settings; every other setting is kept as it is. */
async function writeSaved(change: (list: SavedReport[]) => SavedReport[]): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  const r = await supabase.from('household_config').select('config').maybeSingle();
  const prior = ((r.data as { config?: unknown } | null)?.config ?? null) as Record<
    string,
    unknown
  > | null;
  const list = change(configFromJson(prior).reports.saved);
  const doc = { ...(prior ?? {}), reports: { saved: savedReportsFrom(list) } };
  await supabase
    .from('household_config')
    .upsert({ household_id: householdId, config: doc, updated_at: new Date().toISOString() });
  revalidatePath('/reports');
}

/** Saves the report as it is set up (template, period and filters) under a name; it reruns against the data of the day it is opened. */
export async function saveReport(f: FormData): Promise<void> {
  const name = text(f, 'name').slice(0, 80);
  let params: Record<string, string> = {};
  try {
    const raw = JSON.parse(text(f, 'params')) as unknown;
    if (raw && typeof raw === 'object') params = raw as Record<string, string>;
  } catch {
    return;
  }
  if (!name || !params.t) return;
  const id = `r-${Date.now().toString(36)}`;
  await writeSaved((list) => [
    ...list,
    { id, name, params, favourite: false, savedAt: new Date().toISOString() },
  ]);
}

export async function toggleFavouriteReport(f: FormData): Promise<void> {
  const id = text(f, 'id');
  await writeSaved((list) =>
    list.map((s) => (s.id === id ? { ...s, favourite: !s.favourite } : s)),
  );
}

export async function deleteReport(f: FormData): Promise<void> {
  const id = text(f, 'id');
  await writeSaved((list) => list.filter((s) => s.id !== id));
}
