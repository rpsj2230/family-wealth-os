'use server';

import { revalidatePath } from 'next/cache';
import { parseTaskLines } from '@/lib/task-lines';
import { loadContext } from '@/lib/data';

const uuid = /^[0-9a-f-]{36}$/;

export async function addTask(formData: FormData) {
  const title = String(formData.get('title') ?? '')
    .trim()
    .slice(0, 200);
  const due = String(formData.get('due') ?? '');
  const inst = String(formData.get('institution') ?? '');
  const { supabase, householdId } = await loadContext();
  if (!householdId || !title) return;
  await supabase.from('tasks').insert({
    household_id: householdId,
    title,
    due_on: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    institution_id: uuid.test(inst) ? inst : null,
  });
  revalidatePath('/tasks');
}

/** Changes a task's wording or its date (an empty date clears it). */
export async function updateTask(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  if (!uuid.test(id)) return;
  const title = String(formData.get('title') ?? '')
    .trim()
    .slice(0, 200);
  const due = String(formData.get('due') ?? '');
  const { supabase } = await loadContext();
  await supabase
    .from('tasks')
    .update({
      ...(title ? { title } : {}),
      due_on: /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    })
    .eq('id', id);
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
}

export async function setTaskStatus(formData: FormData) {
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!['open', 'done', 'dropped'].includes(status) || !/^[0-9a-f-]{36}$/.test(id)) return;
  const { supabase } = await loadContext();
  await supabase
    .from('tasks')
    .update({ status, done_at: status === 'done' ? new Date().toISOString() : null })
    .eq('id', id);
  revalidatePath('/tasks');
  revalidatePath(`/tasks/${id}`);
}

/** Adds many dated tasks at once: one per line, starting with the date. Nothing is added if any line cannot be read. */
export async function addTasksBulk(
  _p: { ok: boolean; message: string } | null,
  f: FormData,
): Promise<{ ok: boolean; message: string }> {
  const { supabase, householdId } = await loadContext();
  if (!householdId) return { ok: false, message: 'Create your household first.' };
  const { tasks, errors } = parseTaskLines(String(f.get('lines') ?? ''));
  if (errors.length > 0) return { ok: false, message: errors.slice(0, 3).join(' ') };
  if (tasks.length === 0) return { ok: false, message: 'Nothing to add.' };
  if (tasks.length > 200) return { ok: false, message: 'Add at most 200 tasks at a time.' };
  const { data } = await supabase.from('tasks').select('title, due_on');
  const have = new Set((data ?? []).map((t) => `${t.due_on ?? ''}|${t.title as string}`));
  const fresh = tasks.filter((t) => !have.has(`${t.dueOn}|${t.title}`));
  if (fresh.length > 0)
    await supabase
      .from('tasks')
      .insert(fresh.map((t) => ({ household_id: householdId, title: t.title, due_on: t.dueOn })));
  revalidatePath('/tasks');
  return {
    ok: true,
    message: `Added ${fresh.length} task${fresh.length === 1 ? '' : 's'}${tasks.length > fresh.length ? ` (${tasks.length - fresh.length} already there)` : ''}.`,
  };
}
