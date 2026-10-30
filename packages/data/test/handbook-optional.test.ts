import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { loadHandbookTicks, loadHelplines, loadNominees } from '../src/handbook';

/** A client whose every query answers with the given result, whatever filters are chained on it. */
function answering(result: { data: unknown; error: unknown }): SupabaseClient {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'not', 'eq', 'in', 'limit', 'order']) q[m] = () => q;
  q.then = (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok);
  return { from: () => q } as unknown as SupabaseClient;
}

describe('handbook reads that may run before the database update', () => {
  it('treats a missing column or table as empty instead of failing', async () => {
    const missingColumn = answering({
      data: null,
      error: { code: '42703', message: 'column assets.nominee_note does not exist' },
    });
    expect(await loadNominees(missingColumn)).toEqual({});
    expect(await loadHelplines(missingColumn, 'h1')).toEqual({});
    const missingTable = answering({
      data: null,
      error: { code: '42P01', message: 'relation "emergency_progress" does not exist' },
    });
    expect(await loadHandbookTicks(missingTable)).toEqual([]);
  });

  it('reads nominees, helplines and ticks once they exist', async () => {
    expect(
      await loadNominees(
        answering({
          data: [
            { id: 'a1', nominee_note: ' Ragini, 100% ' },
            { id: 'a2', nominee_note: '  ' },
          ],
          error: null,
        }),
      ),
    ).toEqual({ a1: 'Ragini, 100%' });
    expect(
      await loadHelplines(answering({ data: [{ id: 'b1', helpline: '1800 000' }], error: null })),
    ).toEqual({ b1: '1800 000' });
    expect(
      await loadHandbookTicks(
        answering({
          data: [{ step_key: 't:week:call', done_by: 'u1', done_at: '2026-10-30T10:00:00Z' }],
          error: null,
        }),
      ),
    ).toEqual([{ key: 't:week:call', doneBy: 'u1', doneAt: '2026-10-30T10:00:00Z' }]);
  });
});
