import { describe, expect, it } from 'vitest';
import { demoCoverage, demoHistoryView } from './demo-history';
import {
  allIdentityLines,
  applyPins,
  asOfText,
  chooseAccount,
  identityChip,
  identityGroups,
  identityHeading,
  identityHeadline,
  sharedLines,
  sharedState,
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

  describe('lines the tabs do not identify', () => {
    it('lists the months that have some, oldest first, and counts what became of them in the sample', () => {
      expect(identityGroups(v).map((g) => [g.tab, g.lines.length])).toEqual([
        ['Sep 2021', 2],
        ['Dec 2021', 2],
        ['Mar 2022', 2],
      ]);
      expect(v.summary.identities).toEqual({
        certain: 2,
        likely: 1,
        pinned: 0,
        open: 2,
        blocked: 1,
        leftOut: 0,
      });
      expect(identityHeadline(v.summary.identities)).toBe(
        '2 savings lines identified from the other tabs; 1 to confirm; 3 still need your choice',
      );
      expect(
        identityHeadline({ certain: 0, likely: 0, pinned: 0, open: 0, blocked: 0, leftOut: 0 }),
      ).toBeNull();
    });

    it('marks how each was found with a word, not only a colour', () => {
      const word = (state: string) => identityChip({ state } as never).word;
      expect(word('certain')).toBe('inferred');
      expect(word('likely')).toBe('inferred, likely');
      expect(word('ambiguous')).toBe('which account?');
      expect(word('blocked')).toBe('not inferred');
      expect(word('pinned')).toBe('chosen by you');
    });

    it('heads a line with its cell, bank, person, label and balance', () => {
      const l = allIdentityLines(v).find((x) => x.id === 'Mar 2022|F12')!;
      expect(identityHeading(l)).toBe('F12: Sample Bank (Anil), Cash, ₹700');
    });

    it('a choice for one line is applied to that line; for its twins only when asked', () => {
      const a = allIdentityLines(v).find((x) => x.id === 'Mar 2022|F12')!;
      expect(chooseAccount({}, v, a, 'a-nro-2200', false)).toEqual({
        'Mar 2022|F12': 'a-nro-2200',
      });
      expect(chooseAccount({}, v, a, 'a-nro-2200', true)).toEqual({
        'Mar 2022|F12': 'a-nro-2200',
        'Dec 2021|F12': 'a-nro-2200',
      });
      // taking a choice back
      expect(chooseAccount({ 'Mar 2022|F12': 'a-nro-2200' }, v, a, undefined, false)).toEqual({});
      // an account that is not one of the twin's choices is not forced on it
      expect(sharedLines(v, a, 'a-nre-3300')).toEqual([]);
      expect(sharedState({ 'Mar 2022|F12': 'a-nro-2200' }, v, a)).toEqual({ count: 1, all: false });
      expect(
        sharedState({ 'Mar 2022|F12': 'a-nro-2200', 'Dec 2021|F12': 'a-nro-2200' }, v, a),
      ).toEqual({ count: 1, all: true });
    });

    it('a sure line the person unticks is left out; a chosen account is used and counted as matched', () => {
      const before = v.months.find((m) => m.tab === 'Sep 2021')!;
      const w = applyPins(v, { 'Sep 2021|F10': '', 'Mar 2022|F12': 'a-nro-2200' });
      const sep = w.months.find((m) => m.tab === 'Sep 2021')!;
      expect(sep.identities[0]).toMatchObject({
        state: 'left_out',
        accepted: false,
        account: null,
      });
      expect(sep.matched).toBe(before.matched - 1);
      expect(sep.unmatched).toBe(before.unmatched + 1);
      const mar = w.months.find((m) => m.tab === 'Mar 2022')!;
      expect(mar.identities[0]).toMatchObject({
        state: 'pinned',
        accepted: true,
        account: { id: 'a-nro-2200' },
      });
      expect(w.summary.identities).toMatchObject({ certain: 1, pinned: 1, leftOut: 1, open: 1 });
      // the view it came from is not changed
      expect(v.months.find((m) => m.tab === 'Mar 2022')!.identities[0]!.state).toBe('ambiguous');
    });

    it("ignores a choice that is not one of the line's accounts", () => {
      const w = applyPins(v, { 'Mar 2022|F12': 'a-nre-9999' });
      expect(w.months.find((m) => m.tab === 'Mar 2022')!.identities[0]!.state).toBe('ambiguous');
    });
  });
});
