import { describe, expect, it } from 'vitest';
import {
  ageTag,
  buildSyncRows,
  lastResultText,
  progressText,
  syncChip,
  thirdPartyNotice,
  type SyncOfferRow,
  type SyncSourceRow,
} from './rates-sync-view';

const TODAY = '2026-10-27';

describe('syncChip', () => {
  it('says Not synced yet before any run', () => {
    expect(syncChip(null, null, TODAY)).toMatchObject({ status: 'never', label: 'Not synced yet' });
    expect(syncChip(TODAY, '', TODAY).status).toBe('never');
  });
  it('says Synced today for a read made today, and the day for an older one', () => {
    expect(syncChip(TODAY, '14 rates saved: 2 new, 3 changed, 9 unchanged', TODAY)).toMatchObject({
      status: 'synced',
      label: 'Synced today',
      tone: 'ok',
    });
    expect(syncChip('2026-10-20', '14 rates saved: 0 new', TODAY).label).toBe('Synced 20 Oct 2026');
    // the older wording of a saved read still counts
    expect(syncChip(TODAY, 'read 14 rates: 2 new', TODAY).status).toBe('synced');
    expect(syncChip(TODAY, 'pasted by you: 9 rates saved: 9 new', TODAY).status).toBe('synced');
  });
  it('says Unchanged for a page that was the same', () => {
    expect(
      syncChip(
        TODAY,
        'Unchanged since 2026-10-20: not read again (no AI cost); 11 rates confirmed',
        TODAY,
      ),
    ).toMatchObject({ status: 'unchanged', label: 'Unchanged' });
  });
  it('says Cannot read for every way a bank’s page could not be read', () => {
    for (const r of [
      'Cannot read: Equitas Small Finance Bank’s site refused the automated visit (503 Service Unavailable).',
      'Cannot read: the “Interest Rates” link was not found in the page’s text',
      'could not refresh: AI service: Groq answered 429',
      'pasted page not read: nothing found',
      'Not reached this run (time ran out).',
    ])
      expect(syncChip(TODAY, r, TODAY), r).toMatchObject({
        status: 'cannot',
        label: 'Cannot read',
        tone: 'bad',
      });
  });
  it('says there is no AI key, not that the bank cannot be read', () => {
    expect(
      syncChip(TODAY, 'Not read: no AI key is switched on. Add an Anthropic key', TODAY),
    ).toMatchObject({ status: 'nokey', label: 'No AI key' });
  });
});

describe('lastResultText', () => {
  it('shows the date and the result as a sentence', () => {
    expect(
      lastResultText('2026-10-20', 'Unchanged since 2026-10-20: confirmed as checked today'),
    ).toBe('20 Oct 2026: Unchanged since 2026-10-20: confirmed as checked today.');
    expect(lastResultText('2026-10-20', '14 rates saved: 2 new.')).toBe(
      '20 Oct 2026: 14 rates saved: 2 new.',
    );
  });
  it('says Not synced yet when there is no result', () => {
    expect(lastResultText(null, null)).toBe('Not synced yet.');
  });
});

describe('buildSyncRows', () => {
  const src = (
    o: Partial<SyncSourceRow> & Pick<SyncSourceRow, 'id' | 'bank' | 'url'>,
  ): SyncSourceRow => ({
    kind: 'both',
    lastRunOn: null,
    lastResult: null,
    lastDocs: null,
    ...o,
  });
  const offer = (bank: string, checkedOn: string, note: string | null = null): SyncOfferRow => ({
    bank,
    checkedOn,
    sourceKind: 'ai',
    sourceNote: note,
  });
  const build = (sources: SyncSourceRow[], offers: SyncOfferRow[] = []) =>
    buildSyncRows({ sources, offers, today: TODAY, staleDays: 30, registry: () => [] });

  it('makes one row per bank, however many pages it has, with the newest result', () => {
    const rows = build([
      src({ id: 'a', bank: 'HDFC Bank', url: 'https://www.hdfc.example.test/fd', kind: 'fd' }),
      src({
        id: 'b',
        bank: 'HDFC',
        url: 'https://www.hdfc.example.test/savings',
        kind: 'savings',
        lastRunOn: TODAY,
        lastResult: '9 rates saved: 9 new',
      }),
      src({ id: 'c', bank: 'AU Bank', url: 'https://au.example.test/r' }),
    ]);
    expect(rows.map((r) => r.bank)).toEqual(['AU Bank', 'HDFC Bank']);
    const hdfc = rows[1]!;
    expect(hdfc.sourceIds).toEqual(['a', 'b']);
    expect(hdfc.pages.map((p) => p.kind)).toEqual(['fd', 'savings']);
    expect(hdfc.chip.label).toBe('Synced today');
    expect(rows[0]!.chip.label).toBe('Not synced yet');
  });

  it('counts the rates on file with the age of the newest check', () => {
    const [row] = build(
      [src({ id: 'a', bank: 'AU Bank', url: 'https://au.example.test/r' })],
      [
        offer('AU Small Finance Bank', '2026-10-20'),
        offer('AU Bank', '2026-10-24'),
        offer('Other', '2026-10-27'),
      ],
    );
    expect(row!.rateCount).toBe(2);
    expect(row!.newestCheck).toEqual({ on: '2026-10-24', days: 3, stale: false });
    const [old] = build(
      [src({ id: 'a', bank: 'AU Bank', url: 'https://au.example.test/r' })],
      [offer('AU Bank', '2026-08-01')],
    );
    expect(old!.newestCheck?.stale).toBe(true);
  });

  it('counts rates from comparison websites', () => {
    const [row] = build(
      [src({ id: 'a', bank: 'AU Bank', url: 'https://au.example.test/r' })],
      [
        offer('AU Bank', TODAY, 'Reference only, from comparison.example.test (third party)'),
        offer('AU Bank', TODAY, 'Read from au.example.test'),
      ],
    );
    expect(row!.thirdParty).toBe(1);
  });

  it('lists each document of the last sync, and the rates document a link led to', () => {
    const [row] = build([
      src({
        id: 'a',
        bank: 'IDFC First Bank',
        url: 'https://idfc.example.test/fd',
        lastRunOn: TODAY,
        lastResult: '12 rates saved: 12 new',
        lastDocs: [
          {
            url: 'https://idfc.example.test/fd',
            kind: 'both',
            ok: false,
            chars: 0,
            note: 'Cannot read: answered 404',
            via: null,
            effectiveOn: null,
          },
          {
            url: 'https://www.idfcfirst.bank.in/content/dam/Interest-Rates-1st-September-2026.pdf',
            kind: 'fd',
            ok: true,
            chars: 3100,
            note: 'read 3,100 characters',
            via: 'https://www.idfcfirst.bank.in/interest-rate',
            effectiveOn: '2026-09-01',
          },
        ],
      }),
    ]);
    expect(row!.documents.map((d) => [d.state, d.kindLabel])).toEqual([
      ['bad', 'Savings and fixed deposits'],
      ['ok', 'Fixed deposits'],
    ]);
    expect(row!.documents[1]!.where).toBe(
      'www.idfcfirst.bank.in/content/dam/Interest-Rates-1st-September-2026.pdf',
    );
    expect(row!.rateDoc).toEqual({
      where: 'www.idfcfirst.bank.in/content/dam/Interest-Rates-1st-September-2026.pdf',
      url: 'https://www.idfcfirst.bank.in/content/dam/Interest-Rates-1st-September-2026.pdf',
    });
    expect(row!.effectiveOn).toBe('2026-09-01');
  });

  it('shows what would be read, before any sync has run', () => {
    const [row] = buildSyncRows({
      sources: [src({ id: 'a', bank: 'Sample Bank', url: 'https://bank.example.test/rates' })],
      offers: [],
      today: TODAY,
      staleDays: 30,
      registry: () => [{ url: 'https://bank.example.test/official.pdf', kind: 'fd' }],
    });
    expect(row!.documents.map((d) => [d.where, d.kind, d.state])).toEqual([
      ['bank.example.test/rates', 'both', 'planned'],
      ['bank.example.test/official.pdf', 'fd', 'planned'],
    ]);
  });
});

describe('small texts', () => {
  it('words the third-party notice as the user asked', () => {
    expect(thirdPartyNotice(0)).toBeNull();
    expect(thirdPartyNotice(7)).toBe(
      '7 saved rates came from comparison websites (third party). They are kept until the bank’s own page is synced, then replaced.',
    );
    expect(thirdPartyNotice(1)).toContain('1 saved rate came from');
  });
  it('words the progress and the age', () => {
    expect(progressText(3, 8, 'HDFC Bank')).toBe('Syncing 3 of 8: HDFC Bank…');
    expect(ageTag(0)).toBe('checked today');
    expect(ageTag(1)).toBe('checked yesterday');
    expect(ageTag(5)).toBe('checked 5 days ago');
  });
});
