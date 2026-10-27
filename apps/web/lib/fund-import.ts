/**
 * The shapes the Import page passes between the browser and the server for a fund statement or a fund-transactions file: what a
 * statement would change (a preview that writes nothing), the items the person ticked, and what was written. Plain data only.
 */
import type { FundChangeItem, FundImportDiff } from '@fwos/core';
import type { CasReport, Selection } from '@fwos/ingest';

/** A comparison as the browser needs it: the write sets stay on the server, and a long list of new lines is cut. */
export type ItemView = Omit<FundChangeItem, 'write'>;
export interface DiffView extends Omit<FundImportDiff, 'items'> {
  items: ItemView[];
}

/** The most new lines sent to the browser for one fund; the rest are only counted. */
export const MAX_LINES_SHOWN = 60;

export function toView(diff: FundImportDiff, maxLines = MAX_LINES_SHOWN): DiffView {
  return {
    ...diff,
    items: diff.items.map((i) => {
      const { write, ...rest } = i;
      void write;
      return {
        ...rest,
        lines: { ...rest.lines, newLines: rest.lines.newLines.slice(0, maxLines) },
      };
    }),
  };
}

export interface AppliedView {
  /** "2 funds updated: +5 transactions; 1 SIP stopped; 1 fund sold" */
  summary: string;
  /** what was written, fund by fund */
  lines: string[];
  needsReview: string[];
}

export function appliedView(report: CasReport): AppliedView {
  return { summary: report.summary, lines: report.lines, needsReview: report.needsReview };
}

export interface PersonPreview {
  ownerId: string;
  name: string;
  /** the files it was read from (a transactions file); empty for a statement */
  files: string[];
  diff: DiffView;
  /** remarks on the file itself (lines left out and why) */
  notes: string[];
  applied?: AppliedView;
}

export interface CasState {
  stage: 'idle' | 'previewed' | 'applied' | 'error';
  message?: string;
  person?: PersonPreview;
  /** what was written, once the chosen changes are applied */
  applied?: AppliedView & { name: string };
  /** the statement's own remarks (what could not be read) */
  warnings?: string[];
}

export interface FundCsvState {
  stage: 'idle' | 'previewed' | 'committed' | 'error';
  message?: string;
  people?: PersonPreview[];
  /** remarks on the files as a whole */
  notes?: string[];
}

/**
 * The items the person ticked (`take`) among those the preview showed (`seen`). Null when the form carries no preview at all: nothing
 * is applied then, so a request that skipped the preview cannot change anything.
 */
export function selectionFromForm(f: FormData): Selection | null {
  const seen = f.getAll('seen').map(String);
  if (seen.length === 0) return null;
  return { take: new Set(f.getAll('take').map(String)), seen: new Set(seen) };
}
