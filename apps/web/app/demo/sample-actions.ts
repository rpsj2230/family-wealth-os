'use server';

/** What every form on a public sample page runs: it says that nothing is saved. */
export async function sampleSave(): Promise<{ ok: boolean; message: string }> {
  return { ok: true, message: 'This is a sample: nothing is saved.' };
}
