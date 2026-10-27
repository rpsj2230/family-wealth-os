import { beforeEach, describe, expect, it, vi } from 'vitest';
import { demoFundPreview } from './demo-fund-import';

/**
 * The server actions behind the fund-statement and transactions-file buttons, with the data layer replaced: a preview reads and
 * compares but never writes, the apply step refuses a request that carries no preview, and it passes exactly the ticked items on.
 */
const OWNER = '11111111-1111-1111-1111-111111111111';
interface Call {
  fn: string;
  args: unknown[];
}
const calls: Call[] = [];
const db = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({
          data: { id: OWNER, display_name: 'Anil', pan_last4: '234F' },
        }),
      }),
      then: (ok: (v: unknown) => void) =>
        ok({ data: [{ id: OWNER, display_name: 'Anil' }], error: null }),
    }),
    upsert: async (row: unknown) => {
      calls.push({ fn: `upsert:${table}`, args: [row] });
      return { error: null };
    },
  }),
};
const diff = demoFundPreview()[0]!.diff;
const full = { ...diff, items: diff.items.map((i) => ({ ...i, write: null })) };

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/data', () => ({ loadContext: async () => ({ supabase: db, householdId: 'h1' }) }));
vi.mock('@/lib/portfolio-data', () => ({ recordSnapshot: vi.fn() }));
vi.mock('@fwos/data', () => ({
  previewCasPdf: async (...a: unknown[]) => {
    calls.push({ fn: 'previewCasPdf', args: a });
    return {
      ok: true,
      ownerId: OWNER,
      diff: full,
      warnings: ['a note'],
      periodFrom: '2021-01-01',
      periodTo: '2026-10-25',
    };
  },
  importCasPdf: async (...a: unknown[]) => {
    calls.push({ fn: 'importCasPdf', args: a });
    return {
      outcome: 'imported',
      ownerId: OWNER,
      detail: '',
      summary: '1 fund updated: +2 transactions',
      report: {
        summary: '1 fund updated: +2 transactions',
        lines: ['updated: Sample Flexi Cap Fund - Direct Growth (2 new transactions)'],
        needsReview: [],
        changes: [],
        statementFunds: 5,
        transactionsAdded: 2,
      },
    };
  },
  importFundCsv: async (...a: unknown[]) => {
    calls.push({ fn: 'importFundCsv', args: a });
    const apply = (a[4] as { apply: boolean }).apply;
    return {
      ownerId: OWNER,
      diff: full,
      notes: [],
      report: apply
        ? {
            summary: '1 fund updated: +2 transactions',
            lines: ['updated: x'],
            needsReview: [],
            changes: [],
            statementFunds: 5,
            transactionsAdded: 2,
          }
        : null,
    };
  },
}));

const { importCas, previewCas, previewFundCsv, commitFundCsv } =
  await import('@/app/(app)/import/fund-actions');

const pdfForm = (extra: Record<string, string[]> = {}) => {
  const fd = new FormData();
  fd.set('file', new File(['%PDF-1.7'], 'cas.pdf', { type: 'application/pdf' }));
  fd.set('owner', OWNER);
  fd.set('password', 'ABCDE1234F');
  for (const [k, v] of Object.entries(extra)) for (const x of v) fd.append(k, x);
  return fd;
};
const csvForm = (extra: Record<string, string[]> = {}) => {
  const fd = new FormData();
  fd.append(
    'files',
    new File(
      [
        'Date,Folio Number,Name of the Fund,Order,Units,NAV,Current Nav,Amount\n2026-01-05,111,Sample Fund,Buy,10,100,110,1000\n',
      ],
      'Anil.csv',
      { type: 'text/csv' },
    ),
  );
  fd.set('owner_0', OWNER);
  for (const [k, v] of Object.entries(extra)) for (const x of v) fd.append(k, x);
  return fd;
};

beforeEach(() => {
  calls.length = 0;
});

describe('previewing a fund statement', () => {
  it('shows what would change, writes nothing, and keeps the write sets on the server', async () => {
    const r = await previewCas(null, pdfForm());
    expect(r.stage).toBe('previewed');
    expect(r.person!.name).toBe('Anil');
    expect(r.person!.diff.items.length).toBeGreaterThan(3);
    expect(r.person!.diff.items.every((i) => !('write' in i))).toBe(true);
    expect(r.warnings).toEqual(['a note']);
    expect(calls.map((c) => c.fn)).toEqual(['previewCasPdf']);
    // the password is handed on to open the file and appears nowhere in what comes back
    expect(JSON.stringify(r)).not.toContain('ABCDE1234F');
  });

  it('asks for the missing pieces in plain words', async () => {
    const fd = pdfForm();
    fd.delete('file');
    expect((await previewCas(null, fd)).message).toBe('Choose the statement PDF first.');
    const bad = pdfForm();
    bad.set('owner', 'nobody');
    expect((await previewCas(null, bad)).message).toBe('Choose whose statement this is.');
  });
});

describe('applying the chosen changes of a fund statement', () => {
  it('refuses a request that skipped the preview, and changes nothing', async () => {
    const r = await importCas(null, pdfForm());
    expect(r.stage).toBe('error');
    expect(r.message).toContain('Preview the changes first');
    expect(calls).toEqual([]);
  });

  it('passes on exactly what was shown and what was ticked', async () => {
    const r = await importCas(null, pdfForm({ seen: ['a', 'b', 'c'], take: ['a', 'c'] }));
    expect(r.stage).toBe('applied');
    expect(r.applied!.summary).toBe('1 fund updated: +2 transactions');
    expect(r.applied!.lines[0]).toContain('updated: Sample Flexi Cap Fund');
    const call = calls.find((c) => c.fn === 'importCasPdf')!;
    const opts = call.args[4] as { select: { take: Set<string>; seen: Set<string> } };
    expect([...opts.select.take]).toEqual(['a', 'c']);
    expect([...opts.select.seen]).toEqual(['a', 'b', 'c']);
  });
});

describe('a transactions file', () => {
  it('previews without writing, and applies only after a preview', async () => {
    const p = await previewFundCsv({ stage: 'idle' }, csvForm());
    expect(p.stage).toBe('previewed');
    expect(p.people![0]!.name).toBe('Anil');
    expect((calls.find((c) => c.fn === 'importFundCsv')!.args[4] as { apply: boolean }).apply).toBe(
      false,
    );
    expect(calls.some((c) => c.fn === 'upsert:cas_imports')).toBe(false);

    calls.length = 0;
    const refused = await commitFundCsv({ stage: 'idle' }, csvForm());
    expect(refused.stage).toBe('error');
    expect(calls).toEqual([]);

    const done = await commitFundCsv(
      { stage: 'idle' },
      csvForm({ seen: ['k1', 'k2'], take: ['k1'] }),
    );
    expect(done.stage).toBe('committed');
    expect(done.people![0]!.applied!.summary).toBe('1 fund updated: +2 transactions');
    const logged = calls.find((c) => c.fn === 'upsert:cas_imports')!.args[0] as {
      changes: { summary: string };
      detail: string;
    };
    expect(logged.changes.summary).toBe('1 fund updated: +2 transactions');
    expect(logged.detail.split('\n')[0]).toBe('1 fund updated: +2 transactions');
  });
});
