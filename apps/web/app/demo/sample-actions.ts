'use server';

import { demoSearch } from '@/lib/demo-match';

/** What every form on a public sample page runs: it says that nothing is saved. */
export async function sampleSave(): Promise<{ ok: boolean; message: string }> {
  return { ok: true, message: 'This is a sample: nothing is saved.' };
}

/** The sample's "Approve all certain matches": nothing is saved and no prices are fetched. */
export async function sampleApproveCertain(): Promise<{
  ok: boolean;
  message: string;
  codes: string[];
}> {
  return { ok: true, message: 'This is a sample: nothing is saved.', codes: [] };
}

/** The sample's search box: the best schemes of an invented list. */
export async function sampleSearch(query: string) {
  return demoSearch(String(query ?? ''));
}

export async function sampleFinish(): Promise<void> {}
