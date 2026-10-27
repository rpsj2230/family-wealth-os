import { describe, expect, it } from 'vitest';
import { demoCoverage, demoHistoryView } from './demo-history';
import {
  asOfText,
  checkText,
  conflictsOf,
  conflictText,
  dateChoices,
  defaultSelection,
  headline,
  historicalText,
  importOrder,
  resultText,
} from './history-view';

describe('history view', () => {
  const v = demoHistoryView();

  it('says in one line what was found', () => {
    expect(headline(v.summary)).toBe(
      '6 months found, Jun 2021 to Oct 2026; 1 month does not add up; 1 tab to date; 2 closed deposits would be added; 1 closed account; 1 conflict',
    );
    expect(
      headline({ ...v.summary, notAdding: 0, doubtful: 0, closedAccounts: 0, conflicts: 5 }),
    ).toBe(
      '6 months found, Jun 2021 to Oct 2026; every month adds up; 2 closed deposits would be added; 5 conflicts',
    );
    expect(headline({ ...v.summary, months: 0, from: null, to: null })).toMatch(
      /No tab named like a month/,
    );
  });

  it("shows the check against the tab's own total with a tick or a cross and the difference", () => {
    const jun = v.months.find((m) => m.tab === 'June 2021')!;
    const dec = v.months.find((m) => m.tab === 'Dec 2021')!;
    expect(checkText(jun)).toMatchObject({ mark: '✓', word: 'Adds up' });
    expect(checkText(dec)).toMatchObject({ mark: '✗', word: 'Off by ₹1,000' });
    expect(checkText({ verdict: 'unchecked', difference: null, checks: [] }).mark).toBe('–');
  });

  it('says which date a tab was given and where it came from', () => {
    const t = asOfText({ asOf: '2021-09-12', asOfSource: 'summary' });
    expect(t.date).toMatch(/^12 Sep/);
    expect(t.source).toBe("Summary tab's date of checking");
  });

  it('selects the months that add up and are not in doubt, and imports oldest first with a copy after its original', () => {
    expect(defaultSelection(v)).toEqual(['June 2021', 'Sep 2021', 'Mar 2022', 'Oct 2026']);
    expect(importOrder(v, ['Oct 2026', 'Copy of Oct 2026', 'June 2021']).join()).toBe(
      'June 2021,Oct 2026,Copy of Oct 2026',
    );
  });

  it('only asks about the conflicts of the months that will be imported', () => {
    expect(conflictsOf(v, ['Mar 2022'])).toHaveLength(1);
    expect(conflictsOf(v, ['June 2021'])).toHaveLength(0);
    expect(conflictText(v.conflicts[0]!)).toMatch(
      /Sample Bank Cash-NRE-1100, .*on file ₹18,500 \(entered by hand\); the sheet says ₹18,000/,
    );
  });

  it('offers the months a doubtful tab could be, "not yet" first', () => {
    const jan = v.months.find((m) => m.tab === 'Jan 2023')!;
    expect(dateChoices(jan).map((c) => c.value)).toEqual(['', '2024-01', '2023-01']);
    expect(dateChoices(v.months[0]!)).toEqual([]);
  });

  it("lets the person's month turn a doubtful tab into an ordinary one", () => {
    const w = demoHistoryView({ 'Jan 2023': '2024-01' });
    const jan = w.months.find((m) => m.tab === 'Jan 2023')!;
    expect(jan).toMatchObject({
      month: '2024-01',
      overridden: true,
      doubt: null,
      defaultSelected: true,
    });
    expect(w.summary.doubtful).toBe(0);
    // a person can still choose a tab by its title: the choice stays offered
    expect(dateChoices(jan).length).toBeGreaterThan(1);
  });

  it('describes closed records and the result of an import in plain words', () => {
    expect(historicalText(v.historical[0]!)).toMatch(
      /Sample Bank \(Anil\): ₹5,00,000 deposit, listed Jun 2021 to Mar 2022, matured about .*estimated/,
    );
    expect(historicalText(v.historical[1]!)).toMatch(/closed early.*and so is its start/);
    expect(
      resultText({
        months: 4,
        failed: 1,
        observations: 20,
        addedAssets: 2,
        checks: 3,
        identical: 5,
        conflictsReplaced: 1,
        conflictsKept: 0,
      }),
    ).toBe(
      '3 months imported, 1 to run again. 20 balances added, 2 closed records added, 5 values already on file, 3 fund values kept for checking, 1 value replaced as you chose.',
    );
  });

  it('builds a coverage grid for the sample with gaps and a closed account', () => {
    const c = demoCoverage();
    expect(c.totals.accounts).toBe(6);
    expect(c.totals.withGaps).toBeGreaterThan(0);
    expect(c.rows.find((r) => r.label === 'Cash-NRE-1100')!.gapMonths).toContain('2021-08');
  });
});
