import { describe, expect, it } from 'vitest';
import { replaceKey, sipKey } from '@fwos/core';
import { demoFundPreview } from './demo-fund-import';
import { selectionFromForm } from './fund-import';
import {
  appendSelection,
  hasWork,
  initialAnswers,
  isTaken,
  questionsOf,
  selectableKeys,
  selectionOf,
} from './fund-import-select';

const people = demoFundPreview();
const [anil, beena, charu] = people;
const key = (p: typeof anil, name: string) => p!.diff.items.find((i) => i.name.includes(name))!.key;

describe('what can be ticked in a preview', () => {
  it('lists a tick for each changed fund and each SIP verdict, and none for an unchanged fund', () => {
    const keys = selectableKeys(people);
    expect(keys).toContain(key(anil, 'Flexi'));
    expect(keys).toContain(sipKey(key(anil, 'Large Cap')));
    expect(keys).toContain(sipKey(key(anil, 'Index')));
    expect(keys).toContain(key(anil, 'Old Fund'));
    expect(keys).toContain(key(beena, 'Mid Cap'));
    expect(keys).not.toContain(key(anil, 'Balanced'));
    expect(keys).not.toContain(key(beena, 'Gilt'));
  });

  it('starts with everything ticked', () => {
    const s = selectionOf(people, new Set());
    expect(s.take).toEqual(s.seen);
    expect(s.count).toBe(6);
  });

  it('unticking a SIP verdict leaves the fund ticked, and the other way round', () => {
    const stop = sipKey(key(anil, 'Large Cap'));
    const s = selectionOf(people, new Set([stop]));
    expect(s.take).not.toContain(stop);
    expect(s.seen).toContain(stop); // shown, not taken: remembered as overruled when applied
    const flexi = key(anil, 'Flexi');
    const t = selectionOf(people, new Set([flexi]));
    expect(t.take).not.toContain(flexi);
  });

  it('a new fund brings its SIP with it: unticking the fund unticks the SIP too', () => {
    const fund = key(beena, 'Mid Cap');
    const sip = sipKey(fund);
    expect(isTaken(people, new Set(), sip)).toBe(true);
    expect(isTaken(people, new Set([fund]), sip)).toBe(false);
    // a SIP of an ordinary fund does not depend on the fund being ticked
    const flexi = key(anil, 'Flexi');
    const large = key(anil, 'Large Cap');
    expect(isTaken(people, new Set([large]), sipKey(large))).toBe(true);
    expect(isTaken(people, new Set([flexi]), sipKey(large))).toBe(true);
  });

  it('writes the selection into a form the way the apply step reads it', () => {
    const fd = new FormData();
    appendSelection(fd, selectionOf(people, new Set([key(anil, 'Old Fund')])));
    expect(fd.getAll('seen')).toContain(key(anil, 'Old Fund'));
    expect(fd.getAll('take')).not.toContain(key(anil, 'Old Fund'));
    expect(fd.getAll('take')).toContain(key(anil, 'Flexi'));
  });

  it('gives the lines a statement replaces their own tick, which goes with the fund and not with the SIP', () => {
    const flexi = key(anil, 'Flexi');
    const r = replaceKey(flexi);
    expect(selectableKeys(people)).toContain(r);
    expect(selectionOf(people, new Set()).take).toContain(r);
    // unticking only the replace part keeps the fund ticked, so the statement's own lines are still added
    const only = selectionOf(people, new Set([r]));
    expect(only.take).toContain(flexi);
    expect(only.take).not.toContain(r);
    expect(only.seen).toContain(r);
    // unticking the fund takes the replace part with it
    expect(isTaken(people, new Set([flexi]), r)).toBe(false);
    // a fund with nothing to replace has no such tick
    expect(selectableKeys(people)).not.toContain(replaceKey(key(anil, 'Index')));
  });

  it('offers no tick for a fund the statement does not list, and no sale for it', () => {
    const keys = selectableKeys(people);
    for (const i of charu!.diff.items.filter((x) => x.kind === 'review')) {
      expect(keys).not.toContain(i.key);
      expect(i.kind).toBe('review');
    }
  });
});

describe('the questions in a preview', () => {
  const ask = (p: typeof anil, name: string) =>
    questionsOf([p!]).find((q) =>
      p!.diff.items.find((i) => i.key === q.itemKey)!.name.includes(name),
    )!;
  const valueKeys = () =>
    questionsOf([beena!])
      .filter((q) => q.prompt.kind === 'ambiguous' && q.prompt.statement?.name.includes('Core'))
      .map((q) => q.key);

  it('finds each question: a folio that could be several funds, a fund the statement does not list, a SIP it could not judge', () => {
    const kinds = questionsOf(people).map((q) => q.prompt.kind);
    expect(kinds.filter((k) => k === 'ambiguous')).toHaveLength(3);
    expect(kinds.filter((k) => k === 'absent')).toHaveLength(3); // Anil's sold fund, Charu's two funds it may not list
    expect(kinds.filter((k) => k === 'sip')).toHaveLength(1);
    expect(
      questionsOf([charu!])
        .find((q) => q.prompt.kind === 'sip')!
        .key.endsWith('#sip'),
    ).toBe(true);
  });

  it('every question starts on its starting answer; a folio waits for the person to approve it', () => {
    const a = initialAnswers(people);
    for (const k of valueKeys()) {
      expect(a[k]).toMatchObject({ option: 'leave', confirmed: false });
    }
    // a fund the statement does not list starts on the suggestion, with its date
    const old = ask(anil, 'Old Fund');
    expect(a[old.key]).toEqual({ option: 'sold', input: '2026-10-25', confirmed: false });
    const dividend = ask(charu, 'Dividend');
    expect(a[dividend.key]).toMatchObject({ option: 'keep' });
    expect(a[ask(charu, 'Bond').key]).toBeDefined();
  });

  it('a fund the statement may not list has no tick: the answer decides, and selling it counts as work', () => {
    const dividend = ask(charu, 'Dividend');
    expect(selectableKeys(people)).not.toContain(dividend.itemKey);
    const idle = selectionOf([charu!], new Set(), initialAnswers([charu!]));
    expect(idle.choices.find((c) => c.key === dividend.key)).toMatchObject({ option: 'keep' });
    expect(hasWork(idle)).toBe(idle.take.length > 0);
    const sold = {
      ...initialAnswers([charu!]),
      [dividend.key]: { option: 'sold', input: '2026-10-20', confirmed: true },
    };
    const sel = selectionOf([charu!], new Set(), sold);
    expect(sel.choices.find((c) => c.key === dividend.key)).toEqual({
      key: dividend.key,
      option: 'sold',
      input: '2026-10-20',
    });
    expect(hasWork(sel)).toBe(true);
    expect(sel.count).toBe(idle.count + 1);
  });

  it('an approved folio counts as work; unanswered questions are not work', () => {
    const none = selectionOf([beena!], new Set(), initialAnswers([beena!]));
    // Beena's new fund is ticked, so there is work; take it away and only questions are left
    const noTicks = selectionOf([beena!], new Set(none.take), initialAnswers([beena!]));
    expect(hasWork(noTicks)).toBe(false);
    const k = valueKeys()[0]!;
    const answered = {
      ...initialAnswers([beena!]),
      [k]: { option: 'link:v1', input: null, confirmed: true },
    };
    const sel = selectionOf([beena!], new Set(none.take), answered);
    expect(hasWork(sel)).toBe(true);
    expect(sel.choices.find((c) => c.key === k)).toEqual({
      key: k,
      option: 'link:v1',
      input: null,
    });
    expect(sel.count).toBe(1);
  });

  it('writes the answers into the form, and the server reads them back', () => {
    const k = valueKeys()[0]!;
    const answers = {
      ...initialAnswers(people),
      [k]: { option: 'link:v1', input: null, confirmed: true },
      [ask(anil, 'Old Fund').key]: { option: 'sold', input: '2026-10-20', confirmed: true },
    };
    const fd = new FormData();
    appendSelection(fd, selectionOf(people, new Set(), answers));
    const sel = selectionFromForm(fd)!;
    expect(sel.choices!.get(k)).toEqual({ option: 'link:v1', input: null });
    expect(sel.choices!.get(ask(anil, 'Old Fund').key)).toEqual({
      option: 'sold',
      input: '2026-10-20',
    });
  });

  it('a form that carries only answers is still a preview; one with nothing is not', () => {
    const fd = new FormData();
    fd.append('choice', JSON.stringify(['k', 'leave', null]));
    expect(selectionFromForm(fd)!.seen.size).toBe(0);
    expect(selectionFromForm(new FormData())).toBeNull();
  });

  it('ignores an answer that is not well formed', () => {
    const fd = new FormData();
    for (const bad of [
      'not json',
      '[1,2,3]',
      '["k"]',
      '["k","o",5]',
      JSON.stringify(['k', 'x'.repeat(200), null]),
    ])
      fd.append('choice', bad);
    fd.append('choice', JSON.stringify(['ok', 'leave', null]));
    expect([...selectionFromForm(fd)!.choices!.keys()]).toEqual(['ok']);
  });

  it('every folio question offers what the fund would become, so the choice can be seen', () => {
    const q = ask(beena, 'Hybrid');
    expect(Object.keys(q.prompt.outcomes).sort()).toEqual(['link:h1', 'link:h2', 'new']);
    expect(q.prompt.outcomes['link:h1']![0]!.units).toEqual({ before: 100, after: 410.5 });
    expect(JSON.stringify(q.prompt.outcomes)).not.toContain('"write"');
  });
});
