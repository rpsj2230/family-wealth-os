/**
 * The prompt a person sees for a fund with no price source, in the standard four parts (docs/UI-GUIDE.md, "Suggest, do not hand back"):
 * what I found, what I suggest and why, the Approve button, the other choices. Pure: the page draws it, the tests check the words.
 */
import { suggestion, type Proposal } from '@fwos/core';
import {
  schemeLabel,
  type FundToMatch,
  type SchemeChoice,
  type SchemeSuggestion,
} from './scheme-suggest';

/** The option id for "this fund has no official scheme". */
export const NOT_LISTED = 'none';

const certaintyText: Record<SchemeChoice['certainty'], string> = {
  certain: 'certain',
  high: 'very likely',
  medium: 'likely',
  low: 'possible',
};

export const choiceName = (c: SchemeChoice) =>
  `${schemeLabel(c.scheme)} (AMFI code ${c.scheme.code})`;

export function schemeProposal(
  fund: FundToMatch & { folioLast4?: string | null },
  s: SchemeSuggestion,
): Proposal {
  const isin = fund.isins[0]?.isin;
  const found =
    `“${fund.name}”${fund.folioLast4 ? ` (folio …${fund.folioLast4})` : ''} is not matched to an official scheme, ` +
    `so it has no price source and its value is only what was last recorded.` +
    (isin ? ` Its ISIN is ${isin}.` : '');
  const rec = s.recommended;
  const options = [
    ...s.choices.map((c) => ({
      id: c.scheme.code,
      label: choiceName(c) + (c.differences.length > 0 ? `: ${c.differences.join('; ')}` : ''),
      action: `use ${choiceName(c)}`,
    })),
    {
      id: NOT_LISTED,
      label: 'This is not a listed fund: keep its last recorded value, labelled “no price source”',
      action: `keep the last recorded value of “${fund.name}” as it is, with no price source`,
    },
  ];
  return suggestion({
    found,
    suggest: rec ? `Use ${choiceName(rec)}.` : null,
    why: rec ? `${rec.reason} (${certaintyText[rec.certainty]})` : s.note,
    options,
    recommended: rec ? rec.scheme.code : null,
  });
}
