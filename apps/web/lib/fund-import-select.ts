/**
 * Which items of a preview can be ticked, which are ticked, and what is sent back. Plain functions, so the rules (a new or sold fund
 * and its SIP go together; an item that is shown and not ticked is remembered as overruled; a question has a suggested answer that
 * only counts once approved, except where the suggestion is the way things already go) are tested without a browser.
 */
import { sipIsChange, sipKey, type FundPrompt } from '@fwos/core';
import type { ItemView, PersonPreview } from './fund-import';

/** The fund part is something to apply. */
export const fundSelectable = (i: ItemView) => i.changed;
/** The SIP part is something to apply (and can be ticked on its own). */
export const sipSelectable = (i: ItemView) => sipIsChange(i.sip);
/** A new or sold fund brings its SIP with it: the SIP cannot be applied without the fund. */
export const sipDependsOnFund = (i: ItemView) => i.kind === 'new' || i.kind === 'sold';
/** The fund is asked about, not ticked: the answer to the question decides (a fund the statement does not list). */
export const tickedByAnswer = (i: ItemView) => i.changed && i.prompt?.kind === 'absent';

/** Everything shown to tick, in order. */
export function selectableKeys(people: Pick<PersonPreview, 'diff'>[]): string[] {
  return people.flatMap((p) =>
    p.diff.items.flatMap((i) => [
      ...(fundSelectable(i) ? [i.key] : []),
      ...(sipSelectable(i) ? [sipKey(i.key)] : []),
    ]),
  );
}

/** Whether a key is taken: it is not unticked, and a SIP that depends on its fund is taken only with the fund. */
export function isTaken(
  people: Pick<PersonPreview, 'diff'>[],
  off: ReadonlySet<string>,
  key: string,
): boolean {
  if (off.has(key)) return false;
  if (!key.endsWith('#sip')) return true;
  const itemKey = key.slice(0, -'#sip'.length);
  for (const p of people) {
    const i = p.diff.items.find((x) => x.key === itemKey);
    if (i) return !sipDependsOnFund(i) || !off.has(i.key);
  }
  return true;
}

// ------------------------------------------------------------------------------------------------
// Questions
// ------------------------------------------------------------------------------------------------
/** What the person has chosen for a question, and whether they pressed Approve (or picked it themselves). */
export interface Answer {
  option: string;
  /** what they typed for the option (a date); null when the option takes no input */
  input: string | null;
  confirmed: boolean;
}
export type Answers = Readonly<Record<string, Answer>>;

/** The options that do nothing: a question answered with one of these changes nothing. */
const QUIET = new Set(['leave', 'skip', 'keep']);
export const isQuiet = (option: string) => QUIET.has(option);

/** A question with the key its answer is filed under: the item's, or its SIP's. */
export function questionsOf(
  people: Pick<PersonPreview, 'diff'>[],
): { key: string; itemKey: string; prompt: FundPrompt }[] {
  return people.flatMap((p) =>
    p.diff.items.flatMap((i) => [
      ...(i.prompt ? [{ key: i.key, itemKey: i.key, prompt: i.prompt }] : []),
      ...(i.sipPrompt ? [{ key: sipKey(i.key), itemKey: i.key, prompt: i.sipPrompt }] : []),
    ]),
  );
}

/** The value an option's input starts on. */
export function inputOf(prompt: FundPrompt, option: string): string | null {
  return prompt.suggestion.options.find((o) => o.id === option)?.input?.value ?? null;
}

/** Every question starts on its own starting answer: nothing happens until the person approves, unless that is how things already go. */
export function initialAnswers(people: Pick<PersonPreview, 'diff'>[]): Answers {
  const out: Record<string, Answer> = {};
  for (const q of questionsOf(people))
    out[q.key] = {
      option: q.prompt.start,
      input: inputOf(q.prompt, q.prompt.start),
      confirmed: false,
    };
  return out;
}

/** A fund the statement does not list starts unticked when the suggestion is to leave it. */
export function initialOff(people: Pick<PersonPreview, 'diff'>[]): ReadonlySet<string> {
  const off = new Set<string>();
  for (const p of people)
    for (const i of p.diff.items)
      if (tickedByAnswer(i) && i.prompt!.start !== 'sold') off.add(i.key);
  return off;
}

export interface FundSelection {
  /** what was shown to tick, and which of it is ticked */
  seen: string[];
  take: string[];
  /** the answers to the questions shown */
  choices: { key: string; option: string; input: string | null }[];
  /** funds with something ticked or approved (the fund, its SIP, or an answer that does something) */
  count: number;
}

export function selectionOf(
  people: Pick<PersonPreview, 'diff'>[],
  off: ReadonlySet<string>,
  answers: Answers = {},
): FundSelection {
  const seen = selectableKeys(people);
  const take = seen.filter((k) => isTaken(people, off, k));
  const qs = questionsOf(people);
  const choices = qs.map((q) => {
    const a = answers[q.key];
    return {
      key: q.key,
      option: a?.option ?? q.prompt.start,
      input: a ? a.input : inputOf(q.prompt, q.prompt.start),
    };
  });
  const funds = new Set([
    ...take.map((k) => k.replace(/#sip$/, '')),
    ...qs
      .filter((q, n) => !isQuiet(choices[n]!.option) && choices[n]!.option !== 'sold')
      .map((q) => q.itemKey),
  ]);
  return { seen, take, choices, count: funds.size };
}

/** Whether the selection has anything to apply. */
export const hasWork = (s: FundSelection) =>
  s.take.length > 0 || s.choices.some((c) => !isQuiet(c.option));

/** Adds the selection to a form, the way the apply step reads it. */
export function appendSelection(fd: FormData, sel: FundSelection): void {
  for (const k of sel.seen) fd.append('seen', k);
  for (const k of sel.take) fd.append('take', k);
  for (const c of sel.choices) fd.append('choice', JSON.stringify([c.key, c.option, c.input]));
}
