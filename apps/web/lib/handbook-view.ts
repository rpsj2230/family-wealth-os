/**
 * Shapes the stored family handbook for reading in a hurry: the first page (what to do, who to call, where things are) is pulled
 * out of the generic sections, and the rest stays as reference. Pure, so it is tested without a page.
 */
import type { Handbook, Section } from '@fwos/core';

export interface CallRow {
  name: string;
  relation: string;
  phone: string;
  note: string;
  /** a tel: link, or null when the phone is not a number a phone can dial */
  tel: string | null;
}

export interface WhereRow {
  what: string;
  where: string;
  /** nobody has written this down yet */
  missing: boolean;
}

/** "+65 9000 0000" -> "tel:+6590000000"; text without at least six digits is not dialled. */
export function telHref(phone: string): string | null {
  const first = phone.split(/[;/,]| or /i)[0] ?? '';
  const digits = first.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
  return digits.replace(/\D/g, '').length >= 6 ? `tel:${digits}` : null;
}

const MISSING = /^(not recorded|none recorded|not recorded here)/i;

const sectionOf = (doc: Handbook, id: string): Section | undefined =>
  doc.sections.find((s) => s.id === id);

const tableOf = (s: Section | undefined, title: string) =>
  s?.tables?.find((t) => t.title === title)?.table;

export interface HandbookPages {
  /** the large "do this first" steps, with the family's own message */
  start: { message: string[]; steps: string[] };
  call: CallRow[];
  advisers: CallRow[];
  where: WhereRow[];
  /** every other section, in the order the handbook gives */
  rest: Section[];
  /** how many of the "where things are" lines nobody has filled in */
  missing: number;
  /** the family has not written down anyone to call */
  noContacts: boolean;
}

const callRows = (rows: string[][] | undefined): CallRow[] =>
  (rows ?? []).map((r) => ({
    name: r[0] ?? '',
    relation: r[1] ?? '',
    phone: r[2] ?? '',
    note: r[3] ?? '',
    tel: telHref(r[2] ?? ''),
  }));

export function handbookPages(doc: Handbook): HandbookPages {
  const start = sectionOf(doc, 'start');
  const call = sectionOf(doc, 'call');
  const where = (tableOf(call, 'Where things are')?.rows ?? []).map((r) => ({
    what: r[0] ?? '',
    where: r[1] ?? '',
    missing: MISSING.test((r[1] ?? '').trim()),
  }));
  const contacts = callRows(tableOf(call, 'Call these people first')?.rows);
  return {
    start: { message: start?.paragraphs ?? [], steps: start?.steps ?? [] },
    call: contacts,
    advisers: callRows(tableOf(call, 'Advisers (lawyer, accountant, agents)')?.rows),
    where,
    rest: doc.sections.filter((s) => s.id !== 'start' && s.id !== 'call'),
    missing: where.filter((w) => w.missing).length,
    noContacts: contacts.length === 0,
  };
}

/** What the household can still add, in one sentence for the owner's view. */
export function incompleteNote(p: Pick<HandbookPages, 'missing' | 'noContacts'>): string | null {
  const parts = [
    p.noContacts ? 'no one to call first' : '',
    p.missing > 0 ? `${p.missing} ${p.missing === 1 ? 'place' : 'places'} not written down` : '',
  ].filter(Boolean);
  return parts.length ? `Still missing: ${parts.join(' and ')}.` : null;
}
