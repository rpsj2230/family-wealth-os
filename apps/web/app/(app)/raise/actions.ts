'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { loadContext } from '@/lib/data';

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** Turns the chosen plan into reminder tasks, one per step, each due on the date its money is available (or earlier to start it). */
export async function savePlanAsTasks(f: FormData): Promise<void> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return;
  let steps: unknown;
  try {
    steps = JSON.parse(String(f.get('steps') ?? '[]'));
  } catch {
    steps = [];
  }
  const rows = (Array.isArray(steps) ? steps : [])
    .slice(0, 20)
    .map((x) => x as { title?: unknown; due?: unknown })
    .filter(
      (x): x is { title: string; due: string } =>
        typeof x.title === 'string' &&
        x.title.length > 0 &&
        typeof x.due === 'string' &&
        ISO.test(x.due),
    )
    .map((x) => ({ household_id: householdId, title: x.title.slice(0, 300), due_on: x.due }));
  if (rows.length > 0) await supabase.from('tasks').insert(rows);
  revalidatePath('/tasks');
  redirect('/tasks');
}
