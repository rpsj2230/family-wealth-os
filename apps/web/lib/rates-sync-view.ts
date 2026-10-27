import {
  DOC_KIND_LABEL,
  isCannotReadResult,
  isDocKind,
  isThirdPartyNote,
  niceDay,
  sameBank,
  type DocKind,
} from '@fwos/core';

/** "equitas.bank.in/nri-banking/": where a page is, in a few words (kept here so the browser code does not load the readers). */
export const hostPathOf = (u: string): string => {
  try {
    const x = new URL(u);
    return `${x.host}${x.pathname === '/' ? '' : x.pathname}`;
  } catch {
    return u;
  }
};

/** A page saved for a bank in Settings, as the Sync page reads it. */
export interface SyncSourceRow {
  id: string;
  bank: string;
  url: string;
  kind: DocKind;
  lastRunOn: string | null;
  lastResult: string | null;
  /** what the last sync did with each document (the `last_docs` column) */
  lastDocs: unknown;
}

/** A rate on file, as far as the Sync page needs it. */
export interface SyncOfferRow {
  bank: string;
  checkedOn: string;
  sourceKind: 'manual' | 'ai';
  sourceNote: string | null;
}

export type SyncStatus = 'never' | 'synced' | 'unchanged' | 'cannot' | 'nokey';

export interface SyncChip {
  status: SyncStatus;
  label: string;
  tone: 'ok' | 'info' | 'bad' | 'warn' | 'idle';
}

/** One document of a bank: where it is, what it carries and how the last read of it went. */
export interface DocView {
  /** the address as it was read (the document a link led to), or the page itself when it has not been read */
  url: string;
  /** "host/path" for the screen */
  where: string;
  host: string;
  kind: DocKind;
  kindLabel: string;
  state: 'ok' | 'bad' | 'planned';
  /** "read 8,123 characters", the reason it could not be read, or "not read yet" */
  note: string;
  /** the page whose link led to this document */
  via: string | null;
  effectiveOn: string | null;
}

export interface SyncRowView {
  bank: string;
  /** the ids of the bank's saved pages */
  sourceIds: string[];
  pages: { id: string; url: string; kind: DocKind; host: string; where: string }[];
  documents: DocView[];
  chip: SyncChip;
  lastRunOn: string | null;
  /** the last result in plain words, or "Not synced yet" */
  lastText: string;
  /** the document a link led to, when the last sync found one: "Rates document: host/path" */
  rateDoc: { where: string; url: string } | null;
  effectiveOn: string | null;
  rateCount: number;
  /** the newest check among the bank's rates, with its age */
  newestCheck: { on: string; days: number; stale: boolean } | null;
  thirdParty: number;
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** The chip for a bank from its last result text and the day it ran. */
export function syncChip(
  lastRunOn: string | null,
  lastResult: string | null,
  today: string,
): SyncChip {
  const r = (lastResult ?? '').trim();
  if (!lastRunOn || r === '') return { status: 'never', label: 'Not synced yet', tone: 'idle' };
  const lower = r.toLowerCase();
  if (lower.startsWith('not read: no ai key'))
    return { status: 'nokey', label: 'No AI key', tone: 'warn' };
  if (isCannotReadResult(lower)) return { status: 'cannot', label: 'Cannot read', tone: 'bad' };
  if (lower.startsWith('unchanged since'))
    return { status: 'unchanged', label: 'Unchanged', tone: 'ok' };
  return {
    status: 'synced',
    label: lastRunOn === today ? 'Synced today' : `Synced ${niceDay(lastRunOn)}`,
    tone: lastRunOn === today ? 'ok' : 'info',
  };
}

/** The last result as one plain line for the row. */
export function lastResultText(lastRunOn: string | null, lastResult: string | null): string {
  const r = (lastResult ?? '').trim();
  if (!lastRunOn || r === '') return 'Not synced yet.';
  const sentence = r.charAt(0).toUpperCase() + r.slice(1);
  return `${niceDay(lastRunOn)}: ${/[.!?]$/.test(sentence) ? sentence : `${sentence}.`}`;
}

const cleanDocs = (raw: unknown): DocView[] => {
  if (!Array.isArray(raw)) return [];
  const out: DocView[] = [];
  for (const d of raw as Record<string, unknown>[]) {
    if (!d || typeof d.url !== 'string') continue;
    const kind = isDocKind(d.kind) ? d.kind : 'both';
    out.push({
      url: d.url,
      where: hostPathOf(d.url),
      host: hostPathOf(d.url).split('/')[0] ?? '',
      kind,
      kindLabel: DOC_KIND_LABEL[kind],
      state: d.ok === true ? 'ok' : 'bad',
      note: typeof d.note === 'string' ? d.note : d.ok === true ? 'read' : 'Cannot read',
      via: typeof d.via === 'string' ? d.via : null,
      effectiveOn: typeof d.effectiveOn === 'string' ? d.effectiveOn : null,
    });
  }
  return out;
};

/** What would be read for the bank, before any sync has said what happened: its saved pages and the bank's own published documents. */
function plannedDocs(
  registry: { url: string; kind: DocKind }[],
  pages: SyncRowView['pages'],
): DocView[] {
  const mk = (url: string, kind: DocKind, via: string | null): DocView => ({
    url,
    where: hostPathOf(url),
    host: hostPathOf(url).split('/')[0] ?? '',
    kind,
    kindLabel: DOC_KIND_LABEL[kind],
    state: 'planned',
    note: 'not read yet',
    via,
    effectiveOn: null,
  });
  return [
    ...pages.map((p) => mk(p.url, p.kind, null)),
    ...registry.map((d) => mk(d.url, d.kind, null)),
  ];
}

/** One row per bank listed in Settings: its pages, how the last sync went and what is on file. */
export function buildSyncRows(args: {
  sources: SyncSourceRow[];
  offers: SyncOfferRow[];
  today: string;
  staleDays: number;
  /** the bank's own published pages the app knows (the page a link is found on, or the document itself), before any sync has said what it read */
  registry: (bank: string) => { url: string; kind: DocKind }[];
}): SyncRowView[] {
  const groups: { bank: string; rows: SyncSourceRow[] }[] = [];
  for (const s of args.sources) {
    const g = groups.find((x) => sameBank(x.bank, s.bank));
    if (g) g.rows.push(s);
    else groups.push({ bank: s.bank, rows: [s] });
  }
  return groups
    .map((g) => {
      const pages = g.rows.map((r) => ({
        id: r.id,
        url: r.url,
        kind: r.kind,
        host: hostPathOf(r.url).split('/')[0] ?? '',
        where: hostPathOf(r.url),
      }));
      // the rows of a bank are written together; the newest run is the one to show
      const last = [...g.rows].sort((a, b) =>
        (b.lastRunOn ?? '').localeCompare(a.lastRunOn ?? ''),
      )[0]!;
      const seen = cleanDocs(last.lastDocs);
      const documents = seen.length > 0 ? seen : plannedDocs(args.registry(g.bank), pages);
      const found = seen.find((d) => d.via && d.state === 'ok') ?? seen.find((d) => d.via);
      const offers = args.offers.filter((o) => sameBank(o.bank, g.bank));
      const newest = offers.reduce<string | null>(
        (m, o) => (!m || o.checkedOn > m ? o.checkedOn : m),
        null,
      );
      const days = newest ? Math.max(0, daysBetween(newest, args.today)) : 0;
      return {
        bank: g.bank,
        sourceIds: g.rows.map((r) => r.id),
        pages,
        documents,
        chip: syncChip(last.lastRunOn, last.lastResult, args.today),
        lastRunOn: last.lastRunOn,
        lastText: lastResultText(last.lastRunOn, last.lastResult),
        rateDoc: found ? { where: found.where, url: found.url } : null,
        effectiveOn: seen.find((d) => d.effectiveOn)?.effectiveOn ?? null,
        rateCount: offers.length,
        newestCheck: newest ? { on: newest, days, stale: days > args.staleDays } : null,
        thirdParty: offers.filter((o) => o.sourceKind === 'ai' && isThirdPartyNote(o.sourceNote))
          .length,
      } satisfies SyncRowView;
    })
    .sort((a, b) => a.bank.localeCompare(b.bank));
}

/** "3 days ago", "today": the age tag of a check. */
export function ageTag(days: number): string {
  if (days <= 0) return 'checked today';
  if (days === 1) return 'checked yesterday';
  return `checked ${days} days ago`;
}

/** The notice about rates saved from comparison websites, or null when there are none. */
export function thirdPartyNotice(n: number): string | null {
  if (n <= 0) return null;
  return `${n} saved rate${n === 1 ? '' : 's'} came from comparison websites (third party). They are kept until the bank’s own page is synced, then replaced.`;
}

/** The sentence over the progress bar of "Sync all banks". */
export const progressText = (n: number, of: number, bank: string): string =>
  `Syncing ${n} of ${of}: ${bank}…`;
