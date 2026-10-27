/**
 * The shape of every "please decide" prompt in the app. Wherever the app cannot be sure, it must not hand the work back with a bare
 * "needs a look": it works out the most likely answer, says it as a concrete suggestion with the reason, and asks the person to
 * approve it, pick another answer or type the missing input. Every such prompt has the same four parts, in this order:
 *
 *   1. What I found     (`found`)
 *   2. What I suggest   (`suggest`) and why (`why`)
 *   3. Approve          (`approve`: "Approve: <action>", one click)
 *   4. Other choices    (`options`, each with an optional input field or link)
 *
 * When there is no evidence to suggest anything, `recommended` is null, `suggest` says so ("I cannot tell: please choose") and
 * there is no Approve button. Pure: the pages draw it, the tests check the words.
 */

export interface SuggestionInput {
  /** a date or free text the person types; the field is shown only while this option is the chosen one */
  kind: 'date' | 'text';
  label: string;
  /** what the field starts with (a suggested date, say) */
  value: string | null;
  required: boolean;
}

export interface SuggestionOption {
  /** stable id, carried back with the person's choice */
  id: string;
  /** the radio text: "Same as Axis Large Cap (folio …3820, 3,047.333 units)" */
  label: string;
  /** the verb phrase after "Approve: ": "link to Axis Large Cap (folio …3820)" */
  action: string;
  input?: SuggestionInput;
}

export interface SuggestionLink {
  href: string;
  text: string;
}

export interface Proposal {
  /** 1. what was found, one plain sentence */
  found: string;
  /** 2. what I suggest, as a sentence; says "I cannot tell" when nothing can be told */
  suggest: string;
  /** 2. and why (the evidence), or why nothing can be suggested */
  why: string;
  /** the option suggested; null when there is no evidence */
  recommended: string | null;
  /** 3. the text of the one-click button: "Approve: link to Axis Large Cap (folio …3820)"; null when nothing is suggested */
  approve: string | null;
  /** 4. the options, the suggested one first */
  options: SuggestionOption[];
  /** pages the person may need instead of an option ("Add this person" in Settings) */
  links: SuggestionLink[];
}

export interface SuggestionArgs {
  found: string;
  /** what to do, as a sentence ("Link folio …3820 to your fund Axis Large Cap."); null when the evidence does not point anywhere */
  suggest: string | null;
  /** the reason, in plain words */
  why: string;
  options: SuggestionOption[];
  /** which option `suggest` describes; required when `suggest` is given */
  recommended?: string | null;
  links?: SuggestionLink[];
}

/** The words used when the evidence does not point to one answer. */
export const CANNOT_TELL = 'I cannot tell which it is, so I am not guessing: please choose.';

export const approveText = (action: string) => `Approve: ${action}`;

/** Builds a prompt in the standard four parts. Throws if the suggested option is not one of the options (a programming error). */
export function suggestion(a: SuggestionArgs): Proposal {
  const rec = a.suggest !== null ? (a.recommended ?? null) : null;
  if (a.suggest !== null && rec === null)
    throw new Error('a suggestion needs the id of the option it recommends');
  const first = rec ? a.options.find((o) => o.id === rec) : null;
  if (rec && !first) throw new Error(`the recommended option "${rec}" is not among the options`);
  const ids = new Set<string>();
  for (const o of a.options) {
    if (ids.has(o.id)) throw new Error(`the option "${o.id}" is listed twice`);
    ids.add(o.id);
  }
  return {
    found: a.found,
    suggest: a.suggest ?? CANNOT_TELL,
    why: a.why,
    recommended: rec,
    approve: first ? approveText(first.action) : null,
    options: first ? [first, ...a.options.filter((o) => o !== first)] : a.options,
    links: a.links ?? [],
  };
}

/** The whole prompt as plain sentences, for a log line or an e-mail: found, suggestion with its reason, and the other choices. */
export function suggestionText(s: Proposal): string {
  const others = s.options.filter((o) => o.id !== s.recommended).map((o) => o.label);
  return [
    s.found,
    `${s.recommended ? 'I suggest: ' : ''}${s.suggest} ${s.why}`.trim(),
    others.length > 0 ? `Other choices: ${others.join('; ')}.` : '',
  ]
    .filter((x) => x.length > 0)
    .join(' ');
}
