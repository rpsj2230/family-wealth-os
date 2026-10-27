/**
 * The questions a fund-statement preview asks, each with the answer the app thinks is most likely and the reason. Nothing here pushes
 * work back with "needs a look": every prompt is a `Proposal` (see ./suggestion): what was found, what I suggest and why, one-click
 * approval, and the other choices or the input that is missing.
 *
 * Four kinds:
 *  - ambiguous: a statement folio could be more than one of the person's funds. The candidates are ranked by evidence, strongest
 *    first, and only an unambiguous winner is suggested:
 *      1. folio: the folio on the statement is the folio on file for one fund that also has the same ISIN (or the same name);
 *      2. units: one fund with that ISIN (or name) holds exactly the units the statement closes with;
 *      3. combined: the statement's folios of this scheme together hold the units of one fund (they are one holding);
 *      4. name: exactly one of the funds has this name (the others only share the ISIN);
 *      otherwise nothing is suggested ("I cannot tell: please choose").
 *  - absent: a fund on file that a complete statement does not list;
 *  - sip: a SIP the statement could not judge;
 *  - skipped folios: folios held by someone who is not in the family list (`skippedFoliosProposal`).
 */
import { formatInr } from './money';
import { longDate } from './inbox-view';
import {
  suggestion,
  type Proposal,
  type SuggestionLink,
  type SuggestionOption,
} from './suggestion';
import type { FundChangeItem, OnFileFund, SipChange, StatementFund } from './fund-import-diff';

/** A statement folio the person has said belongs to a fund, remembered so the same question is not asked again. */
export interface FolioLink {
  folioLast4: string;
  /** the ISIN (lower case), or `name:` and the normalised name when the scheme has none */
  schemeKey: string;
}

export type PromptKind = 'ambiguous' | 'absent' | 'sip';

export interface Evidence {
  /** same ISIN (or AMFI code) */
  isin: boolean;
  /** the folio on the statement is the folio on file */
  folio: boolean;
  /** the units on file equal the statement's closing units */
  units: boolean;
  /** the units on file equal the closing units of this statement's folios of the scheme added together */
  combined: boolean;
  /** the same scheme name (the plan, direct or regular, agrees when both say it) */
  name: boolean;
}

export interface PromptCandidate {
  assetId: string;
  name: string;
  isin: string | null;
  folioLast4: string | null;
  units: number | null;
  invested: number | null;
  startedOn: string | null;
  status: string;
  evidence: Evidence;
}

export interface PromptStatement {
  name: string;
  isin: string | null;
  folioLast4: string | null;
  units: number | null;
  invested: number | null;
  startedOn: string | null;
}

/** What an item would be if an option were chosen: its changes, without the write set. */
export type PromptOutcome = Omit<FundChangeItem, 'write'>;

export interface FundPrompt {
  kind: PromptKind;
  statement: PromptStatement | null;
  candidates: PromptCandidate[];
  suggestion: Proposal;
  /** the option the page starts on: nothing is applied until the person approves or picks another */
  start: string;
  /** the fund as it would be shown after each choice, where the choice makes the folio an ordinary matched or new fund */
  outcomes: Record<string, PromptOutcome[]>;
}

// ------------------------------------------------------------------------------------------------
// Words
// ------------------------------------------------------------------------------------------------
const units3 = (n: number | null) =>
  n === null ? 'no' : n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const folioWord = (f4: string | null) => (f4 ? `folio …${f4}` : 'no folio on file');
const quote = (s: string) => `"${s}"`;
const list = (xs: string[]) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

const NOISE = new Set([
  'fund',
  'plan',
  'growth',
  'option',
  'scheme',
  'the',
  'of',
  'in',
  'a',
  'and',
  'mutual',
  'idcw',
  'dividend',
  'payout',
  'reinvestment',
]);
const ALIASES: [RegExp, string][] = [
  [/\bmid[\s-]*cap\b/g, 'midcap'],
  [/\bsmall[\s-]*cap\b/g, 'smallcap'],
  [/\blarge[\s-]*cap\b/g, 'largecap'],
  [/\bflexi[\s-]*cap\b/g, 'flexicap'],
  [/\bmulti[\s-]*cap\b/g, 'multicap'],
  [/\bblue[\s-]*chip\b/g, 'bluechip'],
];

/** A scheme name reduced to what identifies the scheme: the words without "fund", "growth" …, in order of spelling; and its plan. */
export function nameParts(name: string): { core: string; plan: 'direct' | 'regular' | null } {
  let s = name.toLowerCase().replace(/\(.*?\)/g, ' ');
  for (const [re, to] of ALIASES) s = s.replace(re, to);
  const tokens = s.split(/[^a-z0-9]+/).filter((t) => t && !NOISE.has(t));
  const plan = tokens.includes('direct') ? 'direct' : tokens.includes('regular') ? 'regular' : null;
  return {
    core: tokens
      .filter((t) => t !== 'direct' && t !== 'regular')
      .sort()
      .join(' '),
    plan,
  };
}

/** The same scheme by name: the words agree, and the plan agrees when both names state one. */
export function sameSchemeName(a: string, b: string): boolean {
  const x = nameParts(a);
  const y = nameParts(b);
  return (
    x.core !== '' && x.core === y.core && (x.plan === null || y.plan === null || x.plan === y.plan)
  );
}

/** What a statement folio is remembered under: its ISIN, or its name when it has none. */
export const schemeLinkKey = (s: { isin: string | null; name: string }) =>
  s.isin ? s.isin.toLowerCase() : `name:${nameParts(s.name).core}|${nameParts(s.name).plan ?? ''}`;

// ------------------------------------------------------------------------------------------------
// Ranking
// ------------------------------------------------------------------------------------------------
export type Tier = 'folio' | 'units' | 'combined' | 'name';
export interface RankInput {
  name: string;
  isin: string | null;
  amfiCode: string | null;
  folioLast4: string | null;
  closingUnits: number | null;
}

export function evidenceFor(
  s: RankInput,
  c: Pick<OnFileFund, 'name' | 'isin' | 'amfiCode' | 'folioLast4' | 'state'>,
  tolerance: number,
  together: number | null,
): Evidence {
  const have = c.state?.units;
  const near = (a: number | null | undefined, b: number | null) =>
    a !== null && a !== undefined && b !== null && Math.abs(a - b) <= tolerance;
  return {
    isin:
      (!!s.isin && !!c.isin && s.isin.toLowerCase() === c.isin.toLowerCase()) ||
      (!!s.amfiCode && !!c.amfiCode && s.amfiCode === c.amfiCode),
    folio: !!s.folioLast4 && !!c.folioLast4 && s.folioLast4 === c.folioLast4,
    units: near(have, s.closingUnits),
    combined: together !== null && near(have, together) && !near(have, s.closingUnits),
    name: sameSchemeName(s.name, c.name),
  };
}

/** The one candidate the evidence points to, and which kind of evidence it is; null when it points nowhere or to several. */
export function pickCandidate(
  ranked: { evidence: Evidence }[],
): { index: number; tier: Tier } | null {
  const tiers: [Tier, (e: Evidence) => boolean][] = [
    ['folio', (e) => e.folio && (e.isin || e.name)],
    ['units', (e) => (e.isin || e.name) && e.units],
    ['combined', (e) => (e.isin || e.name) && e.combined],
    ['name', (e) => e.name],
  ];
  for (const [tier, ok] of tiers) {
    const hit = ranked.map((c, index) => ({ c, index })).filter((x) => ok(x.c.evidence));
    if (hit.length === 1) return { index: hit[0]!.index, tier };
    if (hit.length > 1) {
      // strong evidence for several: only the units can still settle it
      const narrow = hit.filter((x) => x.c.evidence.units || x.c.evidence.combined);
      return narrow.length === 1 ? { index: narrow[0]!.index, tier } : null;
    }
  }
  return null;
}

const score = (e: Evidence) =>
  (e.folio ? 8 : 0) +
  (e.units ? 4 : 0) +
  (e.combined ? 3 : 0) +
  (e.name ? 2 : 0) +
  (e.isin ? 1 : 0);

const describe = (c: PromptCandidate) =>
  `${c.name}, ${folioWord(c.folioLast4)}, ${units3(c.units)} units${c.startedOn ? `, since ${longDate(c.startedOn)}` : ''}${c.status !== 'active' ? `, ${c.status}` : ''}`;

const MAX_CANDIDATES = 5;

export interface AmbiguousArgs {
  key: string;
  s: StatementFund;
  /** the funds it could be; when null every fund with the same ISIN or name is taken */
  candidates: OnFileFund[] | null;
  onFile: OnFileFund[];
  /** the other statement folios of this scheme that are also undecided, with their closing units */
  siblings: { folioLast4: string; units: number | null }[];
  tolerance: number;
}

/** The prompt for a statement folio that could be more than one fund. */
export function ambiguousPrompt(a: AmbiguousArgs): FundPrompt {
  const { s } = a;
  const pool =
    a.candidates ??
    a.onFile.filter(
      (f) =>
        (!!s.isin && !!f.isin && s.isin.toLowerCase() === f.isin.toLowerCase()) ||
        (!!s.amfiCode && f.amfiCode === s.amfiCode) ||
        sameSchemeName(s.name, f.name),
    );
  const together =
    a.siblings.length > 0
      ? a.siblings.reduce<number | null>(
          (t, x) => (t === null || x.units === null ? null : t + x.units),
          s.closingUnits,
        )
      : null;
  const ranked: PromptCandidate[] = pool
    .map((f) => ({
      assetId: f.assetId,
      name: f.name,
      isin: f.isin,
      folioLast4: f.folioLast4,
      units: f.state?.units ?? null,
      invested: f.state?.invested ?? null,
      startedOn: f.startedOn,
      status: f.status,
      evidence: evidenceFor(s, f, a.tolerance, together),
    }))
    .sort((x, y) => score(y.evidence) - score(x.evidence))
    .slice(0, MAX_CANDIDATES);
  const pick = pickCandidate(ranked);
  const best = pick ? ranked[pick.index]! : null;
  const f4 = s.folioLast4 || null;
  const folio = f4 ? `folio …${f4}` : 'this folio';
  const statement: PromptStatement = {
    name: s.name,
    isin: s.isin,
    folioLast4: f4,
    units: s.closingUnits,
    invested: s.invested,
    startedOn: s.startedOn,
  };
  const found = `The statement has ${quote(s.name)}, ${folio}, ${units3(s.closingUnits)} units${s.invested !== null ? `, ${formatInr(s.invested)} invested` : ''}. ${
    ranked.length > 1
      ? `${ranked.length} of your funds could be this one`
      : ranked.length === 1
        ? 'One of your funds could be this one'
        : 'None of your funds is a clear match'
  }, so nothing is changed until you decide.`;

  const options: SuggestionOption[] = [
    ...ranked.map((c) => ({
      id: `link:${c.assetId}`,
      label: `Same as ${describe(c)}`,
      action: `link ${folio} to ${quote(c.name)}${c.folioLast4 && c.folioLast4 !== f4 ? ` (${folioWord(c.folioLast4)})` : ''}`,
    })),
    { id: 'new', label: 'A new fund', action: `add ${folio} as a new fund` },
    { id: 'leave', label: 'Leave it alone for now', action: 'leave it alone for now' },
  ];

  let suggest: string | null = null;
  let why: string;
  let recommended: string | null = null;
  if (best && pick) {
    recommended = `link:${best.assetId}`;
    const sameIsin = ranked.filter((c) => c.evidence.isin).length;
    if (pick.tier === 'folio') {
      suggest = `Apply ${folio} to your fund ${quote(best.name)}.`;
      why =
        sameIsin > 1
          ? `${sameIsin === 2 ? 'Both' : 'All'} of your funds with this ISIN could be it, but only ${quote(best.name)} has ${folio} on file.`
          : `${folio.charAt(0).toUpperCase()}${folio.slice(1)} is the folio on file for ${quote(best.name)}, and it has the same ${best.evidence.isin ? 'ISIN' : 'name'}.`;
    } else if (pick.tier === 'units') {
      suggest = `Link ${folio} to your fund ${quote(best.name)}.`;
      why = `${f4 ? `Folio …${f4} is ${best.folioLast4 ? `not the folio on file (…${best.folioLast4})` : 'not on file yet'}` : 'This folio is not on file yet'}, but your fund ${quote(best.name)} has ${units3(best.units)} units, which equal the statement's closing units.`;
    } else if (pick.tier === 'combined') {
      const others = a.siblings.map((x) => `…${x.folioLast4}`);
      suggest = `Combine them into one holding: link ${folio} to ${quote(best.name)}${others.length > 0 ? `, and so the other folio${others.length === 1 ? '' : 's'} (${list(others)})` : ''}.`;
      why = `Folios ${list([`…${f4 ?? '?'}`, ...a.siblings.map((x) => `…${x.folioLast4}`)])} on this statement are one scheme and hold ${units3(together)} units together, which equal the ${units3(best.units)} units of your fund ${quote(best.name)}.`;
    } else {
      suggest = `Link ${folio} to your fund ${quote(best.name)}.`;
      why = `Only ${quote(best.name)} has this scheme's name; ${sameIsin > 1 ? 'the others only share its ISIN' : 'no other fund of yours is called that'}.`;
    }
  } else {
    why =
      ranked.length === 0
        ? 'No fund of yours has this ISIN or name.'
        : `${list(ranked.slice(0, 3).map((c) => `${quote(c.name)}${c.folioLast4 ? ` (folio …${c.folioLast4})` : ''}`))} ${ranked.length === 1 ? 'is' : 'are'} possible, and nothing (the folio, the units or the name) points to just one of them.`;
  }

  return {
    kind: 'ambiguous',
    statement,
    candidates: ranked,
    suggestion: suggestion({ found, suggest, why, recommended, options }),
    start: 'leave',
    outcomes: {},
  };
}

// ------------------------------------------------------------------------------------------------
// A fund the statement does not list
// ------------------------------------------------------------------------------------------------
export function absentPrompt(a: {
  f: OnFileFund;
  asOf: string;
  /** why a missing fund is not taken as sold (an e-mail-keyed statement, a scheme read unclearly, too many missing); null when the statement lists all */
  doubt: { kind: 'basis' | 'unclear' | 'many'; reason: string } | null;
}): FundPrompt {
  const { f, asOf } = a;
  const st = f.state;
  const keep = a.doubt !== null;
  const on = f.folioLast4 ? `folio …${f.folioLast4}, ` : '';
  const found = `${quote(f.name)} (${on}${units3(st?.units ?? null)} units${st?.invested ? `, ${formatInr(st.invested)} invested` : ''}) is on file, but is not on the statement dated ${longDate(asOf)}.`;
  const options: SuggestionOption[] = [
    {
      id: 'sold',
      label: 'Mark as sold',
      action: `mark ${quote(f.name)} as sold on ${longDate(asOf)}`,
      input: { kind: 'date', label: 'Sold on', value: asOf, required: true },
    },
    { id: 'keep', label: 'Leave as it is', action: 'leave it as it is' },
  ];
  const s = a.doubt
    ? suggestion({
        found,
        suggest: 'Leave it as it is.',
        why: a.doubt.reason,
        recommended: 'keep',
        options,
      })
    : suggestion({
        found,
        suggest: `Mark it as sold on ${longDate(asOf)}.`,
        why: 'The statement lists all your funds, and this one is not among them.',
        recommended: 'sold',
        options,
      });
  return {
    kind: 'absent',
    statement: null,
    candidates: [],
    suggestion: s,
    start: keep ? 'keep' : 'sold',
    outcomes: {},
  };
}

// ------------------------------------------------------------------------------------------------
// A SIP the statement could not judge
// ------------------------------------------------------------------------------------------------
export function sipPrompt(a: {
  name: string;
  sip: SipChange;
  /** the date a stop would be dated from: the first instalment that did not come, or else the statement date */
  stopFrom: string;
}): FundPrompt {
  const m = a.sip.before !== null ? `${formatInr(a.sip.before)} a month` : 'as recorded';
  const found = `${quote(a.name)}: ${a.sip.why}`;
  const s = suggestion({
    found,
    suggest: `Keep the SIP as recorded (${m}).`,
    why: 'Nothing on the statement shows that it stopped, and stopping it changes your plan and the estimates built on it.',
    recommended: 'keep',
    options: [
      { id: 'keep', label: 'Keep the SIP as recorded', action: 'keep the SIP as recorded' },
      {
        id: 'stop',
        label: 'Mark the SIP as stopped',
        action: `mark the SIP stopped from ${longDate(a.stopFrom)}`,
        input: { kind: 'date', label: 'Stopped from', value: a.stopFrom, required: true },
      },
    ],
  });
  return {
    kind: 'sip',
    statement: null,
    candidates: [],
    suggestion: s,
    start: 'keep',
    outcomes: {},
  };
}

// ------------------------------------------------------------------------------------------------
// Folios of someone who is not in the family list
// ------------------------------------------------------------------------------------------------
export const PEOPLE_LINK: SuggestionLink = {
  href: '/settings?tab=people',
  text: 'Add this person in Settings > People',
};

/**
 * Folios on a statement keyed on an e-mail address that belong to someone who is not in the family list. They are never applied;
 * the suggestion is to skip them, and to add the person in Settings > People if they should be in the household.
 */
export function skippedFoliosProposal(g: {
  panLast4: string | null;
  holder: string | null;
  schemes: string[];
}): Proposal {
  const n = g.schemes.length;
  const who = g.holder ?? (g.panLast4 ? `the holder of PAN ending ${g.panLast4}` : 'someone else');
  return suggestion({
    found: `The statement has ${n} folio${n === 1 ? '' : 's'} held by ${who}${g.holder && g.panLast4 ? ` (PAN ending ${g.panLast4})` : ''}: ${list(g.schemes.slice(0, 4).map(quote))}${n > 4 ? `, and ${n - 4} more` : ''}. That PAN is not any person in your family list.`,
    suggest: `Skip ${n === 1 ? 'this folio' : 'these folios'}.`,
    why: "They are not yours, so adding them would put someone else's money in this household. If this person should be in the family list, add them in Settings and import the statement again.",
    recommended: 'skip',
    options: [
      {
        id: 'skip',
        label: `Skip ${n === 1 ? 'this folio' : 'these folios'}`,
        action: `skip ${n === 1 ? 'this folio' : `these ${n} folios`}`,
      },
    ],
    links: [PEOPLE_LINK],
  });
}
