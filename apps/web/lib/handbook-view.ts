/**
 * Shapes the stored family handbook for the page. A copy stored before the guide existed has plain sections: its first page (what to
 * do, who to call, where things are) is pulled out of them and the rest stays as reference. A guide needs only a few helpers: who
 * ticked a step, the first person to call, the cards in groups. Pure, so it is tested without a page.
 */
import type { CardKind, Guide, GuideCard, Handbook, Section } from '@fwos/core';

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
  doc.sections?.find((s) => s.id === id);

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
    rest: (doc.sections ?? []).filter((s) => s.id !== 'start' && s.id !== 'call'),
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

// ------------------------------------------------------------------------------------------------
// The guide (handbooks written from 30 Oct 2026 on)
// ------------------------------------------------------------------------------------------------

/** Who ticked a step, in words the page can translate. */
export type TickWho = 'you' | 'viewer' | 'member';
export interface TickState {
  who: TickWho;
  /** when it was ticked (ISO) */
  at: string;
}

/** "you" for the person reading, "the family login" for a read-only login, otherwise "a family member". */
export function tickWho(
  doneBy: string | null,
  me: string | null,
  viewers: ReadonlySet<string>,
): TickWho {
  if (doneBy && me && doneBy === me) return 'you';
  if (doneBy && viewers.has(doneBy)) return 'viewer';
  return 'member';
}

/** The ticks by key, as the page keeps them. */
export function tickMap(
  rows: { key: string; doneBy: string | null; doneAt: string }[],
  me: string | null,
  viewers: ReadonlySet<string>,
): Record<string, TickState> {
  return Object.fromEntries(
    rows.map((r) => [r.key, { who: tickWho(r.doneBy, me, viewers), at: r.doneAt }]),
  );
}

/** The first person to call, with a number a phone can dial (null when nobody is written down). */
export function firstToCall(
  g: Pick<Guide, 'contacts'>,
): { name: string; phone: string; tel: string | null } | null {
  const c = g.contacts.find((x) => x.name.trim());
  return c ? { name: c.name, phone: c.phone, tel: telHref(c.phone) } : null;
}

/** The cards in their groups, banks first, leaving out a group with no card. */
export function cardGroups(cards: GuideCard[]): { kind: CardKind; cards: GuideCard[] }[] {
  return (['bank', 'funds', 'insurer'] as const)
    .map((kind) => ({ kind, cards: cards.filter((c) => c.kind === kind) }))
    .filter((g) => g.cards.length > 0);
}

/** The people a child can turn to: the adults who look after the children, then the people to call, each once. */
export function carers(
  g: Pick<Guide, 'people' | 'contacts'>,
): { name: string; relation: string; phone: string; tel: string | null }[] {
  const seen = new Set<string>();
  const out: { name: string; relation: string; phone: string; tel: string | null }[] = [];
  const add = (name: string, relation: string, phone: string) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ name, relation, phone, tel: telHref(phone) });
  };
  for (const p of g.people) if (p.isMinor && p.guardian) add(p.guardian, '', '');
  for (const c of g.contacts) add(c.name, c.relation, c.phone);
  return out;
}

/** Reading choices remembered per browser: language, simple words and larger text. */
export interface ReadingPrefs {
  lang: 'en' | 'hi';
  plain: boolean;
  large: boolean;
}
export const DEFAULT_PREFS: ReadingPrefs = { lang: 'en', plain: false, large: false };

/** Reads the remembered choices defensively: anything unexpected is the default. */
export function readPrefs(raw: string | null): ReadingPrefs {
  try {
    const o = JSON.parse(raw ?? '{}') as Record<string, unknown>;
    return {
      lang: o.lang === 'hi' ? 'hi' : 'en',
      plain: o.plain === true,
      large: o.large === true,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}
